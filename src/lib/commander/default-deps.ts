// Fork（almanac ALMNC-54.6）：把指揮官分析流程接到 App 裡既有的工具——資料源與領域表（#109）、角色名單與記憶（#110／#111）、
// 截圖辨識（VLM → OCR）、網頁抓全文、錄音轉逐字稿、編輯器 AI，以及工作台（收集項目）。
// 這個檔案需要 Tauri 才跑得起來，所以不寫單元測試；流程本身的測試用 pipeline.test.ts 的假依賴。
// 用法（給 ALMNC-54.10／54.14）：
//   const queue = createAnalysisQueue(await createDefaultCommanderDeps())
//   queue.kick()                                   // R2 新增資料源後、R1 Scott 選「處理」後
//   analyzeSource(id, deps, { conversationId })    // 從處理對話送來分析時
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import { askCollectModel } from '@/lib/collect/ai'
import { ROLE_INSTRUCTIONS } from '@/lib/agents/instructions'
import { agentDisplayName } from '@/lib/agents/display'
import { DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, loadMessagesWithFallback, normalizeLocale } from '@/i18n/config'
import { createAnalysisQueue } from './pipeline'
import { ConverterUnavailableError, type CommanderDeps, type CommanderLabels, type Converters, type RosterAgent } from './types'

const TEXT_FILE = /\.(md|markdown|txt|csv|tsv|json|html?|xml|ya?ml|log)$/i

async function translators(): Promise<{ labels: CommanderLabels, role: (key: string, values?: Record<string, string>) => string }> {
  let locale = DEFAULT_LOCALE
  let messages: AbstractIntlMessages = {}
  try {
    locale = normalizeLocale(typeof window === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY))
    messages = await loadMessagesWithFallback(locale)
  } catch (error) {
    console.warn('[commander] messages unavailable', error)
  }
  const t = createTranslator({ locale, messages, namespace: 'commander' })
  const roles = createTranslator({ locale, messages, namespace: 'agents.roles' })
  return {
    labels: {
      origin: values => t('origin', values),
      unconverted: values => t('unconverted', values),
    },
    role: (key, values) => roles(key, values),
  }
}

export function createDefaultConverters(): Converters {
  return {
    ocrImage: async ref => {
      const { recognizeImageWithFallback } = await import('@/lib/image-recognition')
      const isDataUrl = /^data:/i.test(ref)
      const result = await recognizeImageWithFallback(isDataUrl ? { base64: ref } : { imagePath: ref })
      if (result.method === 'none') throw new ConverterUnavailableError('no vision model or OCR provider')
      return result.content
    },
    fetchWeb: async url => {
      const { capturePublicWebPage } = await import('@/lib/web-capture/service')
      const page = await capturePublicWebPage(url)
      if (page.status === 'failed' || page.status === 'blocked') throw new Error(page.errorMessage || page.errorCode || page.status)
      return [page.title, page.contentMarkdown || page.plainText].filter(Boolean).join('\n\n')
    },
    transcribe: async ref => {
      const [{ default: useSettingStore }, { fetchAudioTranscription }, { readFile }] = await Promise.all([
        import('@/stores/setting'),
        import('@/lib/audio'),
        import('@tauri-apps/plugin-fs'),
      ])
      if (!useSettingStore.getState().sttModel) throw new ConverterUnavailableError('no speech recognition model')
      const bytes = await readFile(ref)
      return fetchAudioTranscription(new Blob([bytes]))
    },
    readFileText: async ref => {
      if (!TEXT_FILE.test(ref)) throw new ConverterUnavailableError('no text converter for this file type')
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      return readTextFile(ref)
    },
  }
}

export async function createDefaultCommanderDeps(): Promise<CommanderDeps> {
  const [sourcesDb, domainsDb, agentsDb, memoryDb, { labels, role }] = await Promise.all([
    import('@/db/v3-sources'),
    import('@/db/v3-domains'),
    import('@/db/agents'),
    import('@/db/agent-memory'),
    translators(),
  ])
  const roster = async (): Promise<RosterAgent[]> => agentsDb.listAgentSettings()
  return {
    sources: {
      get: sourcesDb.getSource,
      setStatus: (id, to) => sourcesDb.setSourceStatus(id, to),
      list: options => sourcesDb.listSources(options),
    },
    converters: createDefaultConverters(),
    ask: prompt => askCollectModel(prompt, undefined, { silent: true }),
    roster,
    domains: domainsDb.listDomains,
    agentPrompt: async (agent, fallbackRole) => {
      const instructions = ROLE_INSTRUCTIONS[agent?.role ?? fallbackRole]
      if (!agent) return instructions
      try {
        return [instructions, await memoryDb.loadAgentMemoryPrompt(agent)].filter(Boolean).join('\n\n')
      } catch (error) {
        console.warn('[commander] memory unavailable', error)
        return instructions
      }
    },
    submitProposals: async batch => {
      const { default: useCollectStore } = await import('@/stores/collect')
      // 先讀回保存的項目，之後的變動才會存檔。
      await useCollectStore.getState().hydrate()
      useCollectStore.getState().addProposals(batch.id, batch.origin, batch.proposals, { conversationId: batch.conversationId })
    },
    logActivity: async entry => {
      const commander = (await roster()).find(agent => agent.role === 'commander')
      await memoryDb.appendActivity('system', {
        actorId: commander?.id ?? 'commander',
        actorRole: 'commander',
        action: entry.batchId ? 'proposed' : 'rejected',
        targetLink: `source:${entry.sourceId}`,
        source: { kind: 'proposal', ref: entry.batchId ?? `commander:${entry.sourceId}` },
        note: Array.from(entry.note).slice(0, 60).join(''),
      })
    },
    // Fork（almanac ALMNC-54.10）：照建議處理（R1）時把初步判斷交給指揮官。
    sourceHint: async sourceId => {
      const [{ getSourceJudgement }, { judgementHint }] = await Promise.all([import('@/db/v3-source-judgements'), import('@/lib/workbench/judgement')])
      return judgementHint(await getSourceJudgement(sourceId))
    },
    labels: {
      ...labels,
      origin: values => labels.origin({ ...values, agent: values.agent ? agentDisplayName({ name: values.agent, role: 'commander' }, role) : role('commander') }),
    },
  }
}

let sharedQueue: ReturnType<typeof createAnalysisQueue> | undefined

/** App 內共用的一條分析佇列（第一次呼叫時建立）。 */
export async function commanderQueue(): Promise<ReturnType<typeof createAnalysisQueue>> {
  sharedQueue ??= createAnalysisQueue(await createDefaultCommanderDeps())
  return sharedQueue
}

/** Scott 接受領域提案後的寫入：領域表、專家設定、soul／rules、筆記 frontmatter 的 domains。畫面在 ALMNC-54.8。 */
export async function createDefaultDomainWriter(): Promise<import('./domain-proposal').DomainProposalWriter> {
  const [domainsDb, agentsDb, memoryDb, settings, noteIo, note] = await Promise.all([
    import('@/db/v3-domains'),
    import('@/db/agents'),
    import('@/db/agent-memory'),
    import('@/lib/agents/settings'),
    import('@/lib/daily/note-io'),
    import('@/lib/v3-model/note'),
  ])
  return {
    addDomain: input => domainsDb.addDomain(input),
    createExpert: input => agentsDb.createAgentSettings({
      name: input.name, role: 'expert', domain: input.domain, enabled: true, allowedTools: [...settings.ROLE_TOOLS.expert],
    }),
    saveMemory: async (agentId, input) => {
      const agent = { id: agentId, name: input.name, role: 'expert' as const, domain: input.domain }
      await memoryDb.writeAgentMemory('scott', agent, 'soul', input.soul)
      await memoryDb.writeAgentMemory('scott', agent, 'rules', input.rules)
    },
    addNoteDomain: async (path, domainId) => {
      const raw = await noteIo.readNote(path)
      if (raw === null) return
      const { fields } = note.parseV3Note(raw)
      if (fields.domains.includes(domainId)) return
      await noteIo.writeNote(path, note.writeV3NoteFields(raw, { domains: [...fields.domains, domainId] }))
    },
  }
}

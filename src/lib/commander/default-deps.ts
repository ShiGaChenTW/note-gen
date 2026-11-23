// Fork（almanac ALMNC-54.6）：把指揮官分析流程接到 App 裡既有的工具——資料源與領域表（#109）、角色名單與記憶（#110／#111）、
// 截圖辨識（VLM → OCR）、網頁抓全文、錄音轉逐字稿、編輯器 AI，以及工作台（收集項目）。
// 這個檔案需要 Tauri 才跑得起來，所以不寫單元測試；流程本身的測試用 pipeline.test.ts 的假依賴。
// 用法（給 ALMNC-54.10／54.14）：
//   const queue = createAnalysisQueue(await createDefaultCommanderDeps())
//   queue.kick()                                   // R2 新增資料源後、R1 Scott 選「處理」後
//   analyzeSource(id, deps, { conversationId })    // 從處理對話送來分析時
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import { askCollectModel } from '@/lib/collect/ai'
import { rememberCompletedRoleWork } from '@/lib/agent-memory/runtime'
import { ROLE_INSTRUCTIONS } from '@/lib/agents/instructions'
import { agentDisplayName } from '@/lib/agents/display'
import { DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, loadMessagesWithFallback, normalizeLocale } from '@/i18n/config'
import { bytesToBase64 } from '@/lib/screenshot-editor'
import { createAnalysisQueue } from './pipeline'
import { createFileTextReader, type FileReasonKey } from './file-route'
import { ConverterUnavailableError, type CommanderDeps, type CommanderLabels, type Converters, type RosterAgent } from './types'

type FileReason = (key: FileReasonKey) => string

async function translators(): Promise<{ labels: CommanderLabels, role: (key: string, values?: Record<string, string>) => string, fileReason: FileReason }> {
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
      unconverted: ({ origin, reason }) => (reason ? t('unconvertedReason', { origin, reason }) : t('unconverted', { origin })),
    },
    role: (key, values) => roles(key, values),
    fileReason: key => t(`fileReason.${key}`),
  }
}

/** fileReason：讀不出檔案文字時的原因文字（依語系）；沒給就用原因鍵本身。 */
export function createDefaultConverters(fileReason: FileReason = key => key): Converters {
  return {
    ocrImage: async ref => {
      const { recognizeImageWithFallback } = await import('@/lib/image-recognition')
      const isDataUrl = /^data:/i.test(ref)
      const asset = /^(?:image|screenshot)\/[a-z0-9-]+\.(png|jpe?g|gif|webp|bmp)$/i.exec(ref)
      let base64 = isDataUrl ? ref : undefined
      if (asset) {
        const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
        const bytes = await readFile(ref, { baseDir: BaseDirectory.AppData }).catch(() => undefined)
        const format = /^jpe?g$/i.test(asset[1]) ? 'jpeg' : asset[1].toLowerCase()
        if (bytes) base64 = `data:image/${format};base64,${bytesToBase64(bytes)}`
      }
      const result = await recognizeImageWithFallback({ base64, imagePath: isDataUrl ? undefined : ref })
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
    // Fork（almanac ALMNC-54.19）：文字檔直接讀，PDF／Office 交給 anydoc；分流與錯誤原因在 file-route.ts。
    readFileText: createFileTextReader({
      readText: async path => (await import('@tauri-apps/plugin-fs')).readTextFile(path),
      parseDocument: async (path, name) => (await import('@/lib/document-parser')).parseLocalDocument(path, name),
      reason: fileReason,
    }),
    // Fork（almanac ALMNC-54.14）：舊筆記資料源（R3）只存 vault 相對路徑，這裡讀檔；只讀不寫。
    readVaultNote: async path => {
      const { readNote } = await import('@/lib/daily/note-io')
      const raw = await readNote(path)
      if (raw === null) throw new Error(`note not found: ${path}`)
      return raw
    },
  }
}

export async function createDefaultCommanderDeps(): Promise<CommanderDeps> {
  const [sourcesDb, domainsDb, agentsDb, memoryDb, { labels, role, fileReason }] = await Promise.all([
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
    converters: createDefaultConverters(fileReason),
    ask: prompt => askCollectModel(prompt, undefined, { silent: true }),
    roster,
    rememberWork: rememberCompletedRoleWork,
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
    // Fork（almanac ALMNC-54.12）：專家撰寫前依領域找類似筆記（筆記庫索引＋知識搜尋），比對重複與衝突。
    findSimilarNotes: async (domainId, fragment) => {
      const { defaultSimilarFinder } = await import('@/lib/cleanup/runtime')
      const find = await defaultSimilarFinder()
      return (await find(domainId, { title: fragment.title, body: fragment.body })).map(({ path, title }) => ({ path, title }))
    },
    submitProposals: async (batch, options) => {
      const { default: useCollectStore } = await import('@/stores/collect')
      // 先讀回保存的項目，之後的變動才會存檔。
      const collect = useCollectStore.getState()
      await collect.hydrate()
      await collect.addProposals(batch.id, batch.origin, batch.proposals, { conversationId: batch.conversationId, recordId: options?.recordId })
      if (options?.durable) {
        try {
          await collect.persist()
        } catch (error) {
          collect.remove(batch.id)
          throw error
        }
      }
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

/** Scott 接受領域提案後的寫入：領域表、專家設定、soul／rules、把筆記收進新領域的 MOC（ALMNC-69.7）。畫面在 ALMNC-54.8。 */
export async function createDefaultDomainWriter(): Promise<import('./domain-proposal').DomainProposalWriter> {
  const [domainsDb, agentsDb, memoryDb, settings] = await Promise.all([
    import('@/db/v3-domains'),
    import('@/db/agents'),
    import('@/db/agent-memory'),
    import('@/lib/agents/settings'),
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
    // Fork（almanac ALMNC-69.7）：收進新領域的 MOC（找不到就先建骨架，放「尚未分章」），再由重建更新 domains。
    addNoteDomain: async (path, domainId) => {
      const { assignNoteToDomains } = await import('@/lib/moc/runtime')
      await assignNoteToDomains(path, [domainId])
    },
  }
}

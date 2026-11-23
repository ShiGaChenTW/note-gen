// Fork（almanac ALMNC-54.12）：把衝突偵測接到 App 裡既有的工具——筆記庫索引（vault-index）、知識搜尋（RAG／關鍵字）、
// 領域表、角色名單與記憶（專家的 rules.md 與工作指示）、指揮官用的模型、研究員的網路搜尋、工作台（收集項目）。
// 這個檔案需要 Tauri 才跑得起來，所以不寫單元測試；流程本身的測試用 check.test.ts 的假依賴。
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import { DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, loadMessagesWithFallback, normalizeLocale } from '@/i18n/config'
import type { RosterAgent } from '@/lib/commander/types'
import type { CheckDeps } from './check'
import { intervalsByDomain, type ReconfirmInterval } from './interval'
import type { CleanupLabels } from './plan'
import { storeQueue, type CleanupQueue } from './queue'
import { createSimilarFinder } from './similar'
import type { CleanupAction, ExternalEvidence } from './types'

async function translator(namespace: string) {
  let locale = DEFAULT_LOCALE
  let messages: AbstractIntlMessages = {}
  try {
    locale = normalizeLocale(typeof window === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY))
    messages = await loadMessagesWithFallback(locale)
  } catch (error) {
    console.warn('[cleanup] messages unavailable', error)
  }
  return createTranslator({ locale, messages, namespace: namespace as 'cleanup' })
}

export async function cleanupLabels(): Promise<CleanupLabels> {
  const t = await translator('cleanup')
  return {
    action: (action: CleanupAction) => t(`actions.${action}`),
    bundleTitle: values => t('bundleTitle', values),
    singleTitle: values => t('singleTitle', values),
    item: values => t('item', values),
    origin: values => (values.agent ? t('origin', values) : t('originSystem')),
    confirmTitle: values => t('confirmTitle', values),
    confirmBody: values => (values.evidence ? t('confirmBody', values) : t('confirmBodyNoExternal', values)),
  }
}

/** 共用的 store.json 鍵值存取。 */
export async function appStore() {
  const { Store } = await import('@tauri-apps/plugin-store')
  const store = await Store.load('store.json')
  return {
    get: (key: string) => store.get(key),
    set: async (key: string, value: unknown) => {
      await store.set(key, value)
      await store.save()
    },
  }
}

export async function defaultCleanupQueue(): Promise<CleanupQueue> {
  return storeQueue(await appStore())
}

/** 依領域找類似筆記：筆記庫索引＋既有的知識搜尋（索引沒建好或沒設定時只用索引）。 */
export async function defaultSimilarFinder() {
  const [{ default: useVaultIndexStore }] = await Promise.all([import('@/stores/vault-index')])
  return createSimilarFinder({
    notes: () => useVaultIndexStore.getState().notes.values(),
    search: async query => {
      const { searchKnowledge } = await import('@/lib/knowledge-search')
      const hits = await searchKnowledge(query, { sourceTypes: ['article'], sourceMode: 'only', limit: 8 })
      return hits.flatMap(hit => {
        const path = hit.locator.filePath ?? (hit.sourceType === 'article' ? hit.sourceId : '')
        return path ? [{ path, score: Math.max(0, Math.min(1, hit.relevanceScore)) }] : []
      })
    },
  })
}

/** 研究員／指揮官查外部資料：既有的網路搜尋（src/lib/web-search）。沒開網路搜尋時丟錯，呼叫端改成只比對筆記庫。 */
export async function defaultLookup(query: string): Promise<ExternalEvidence[]> {
  const { searchWeb } = await import('@/lib/web-search/service')
  const result = await searchWeb(query)
  return result.sources.slice(0, 5).map(source => ({ title: source.title, url: source.url, snippet: source.snippet ?? '' }))
}

async function roster(): Promise<RosterAgent[]> {
  const { listAgentSettings } = await import('@/db/agents')
  return listAgentSettings()
}

function normalize(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

/** 各領域的重新確認期限：讀負責專家的 rules.md。資料庫讀不到時回傳空的（全部用預設）。 */
export async function loadReconfirmIntervals(): Promise<Map<string, ReconfirmInterval>> {
  try {
    const [{ listDomains }, memory, agents] = await Promise.all([import('@/db/v3-domains'), import('@/db/agent-memory'), roster()])
    const domains = await listDomains()
    const experts = await Promise.all(agents.filter(agent => agent.role === 'expert' && agent.enabled).map(async agent => ({
      domain: agent.domain,
      rules: (await memory.getAgentMemory(agent)).rules.content,
    })))
    return intervalsByDomain(domains, experts)
  } catch (error) {
    console.debug('[cleanup] reconfirm intervals unavailable:', error)
    return new Map()
  }
}

export async function createDefaultCheckDeps(): Promise<CheckDeps> {
  const [noteIo, { listDomains }, memory, { askCollectModel }, { ROLE_INSTRUCTIONS }, labels, queue, similar, { createConflictDetector }] = await Promise.all([
    import('@/lib/daily/note-io'),
    import('@/db/v3-domains'),
    import('@/db/agent-memory'),
    import('@/lib/collect/ai'),
    import('@/lib/agents/instructions'),
    cleanupLabels(),
    defaultCleanupQueue(),
    defaultSimilarFinder(),
    import('./detect'),
  ])
  const agents = await roster().catch(() => [] as RosterAgent[])
  const commander = agents.find(agent => agent.role === 'commander' && agent.enabled)
  const domains = await listDomains().catch(() => [])
  return {
    readNote: noteIo.readNote,
    similar,
    // 比對可以用較便宜的模型（規格「模型等級」）；目前 App 只有一個編輯器 AI，所以和指揮官同一個。
    detect: createConflictDetector(prompt => askCollectModel(prompt, undefined, { silent: true })),
    domains: async () => domains,
    expertFor: async domainId => {
      const domain = domains.find(item => item.id === domainId)
      const expert = agents.find(agent => agent.role === 'expert' && agent.enabled && normalize(agent.domain) === normalize(domain?.name))
      if (!expert) return undefined
      const prompt = [ROLE_INSTRUCTIONS.expert, await memory.loadAgentMemoryPrompt(expert).catch(() => '')].filter(Boolean).join('\n\n')
      return { agentId: expert.id, prompt }
    },
    commanderPrompt: async () => [ROLE_INSTRUCTIONS.commander, commander ? await memory.loadAgentMemoryPrompt(commander).catch(() => '') : ''].filter(Boolean).join('\n\n'),
    lookup: defaultLookup,
    submit: async batch => {
      const { default: useCollectStore } = await import('@/stores/collect')
      await useCollectStore.getState().hydrate()
      await useCollectStore.getState().addProposals(batch.id, batch.origin, batch.proposals, { conversationId: batch.conversationId })
    },
    queue,
    labels,
    commanderName: commander?.name,
  }
}

/** 時機 1、2：新筆記寫入、親手寫的筆記存檔之後在背景比對；失敗只記錄，不影響寫入。 */
export async function checkAfterWrite(path: string, trigger: 'written' | 'handwritten'): Promise<void> {
  try {
    const { isUiV3 } = await import('@/lib/fork-ui')
    if (!isUiV3()) return
    const { checkNote } = await import('./check')
    await checkNote(path, trigger, await createDefaultCheckDeps())
  } catch (error) {
    console.warn('[cleanup] conflict check skipped:', error)
  }
}

/** 確認卡「交給指揮官」：重新確認（比對＋查外部資料），結果一律變成提案。 */
export async function recheckFromCard(path: string): Promise<void> {
  const { recheckNote } = await import('./check')
  await recheckNote(path, await createDefaultCheckDeps())
}

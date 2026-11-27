// Fork（almanac ALMNC-92）：發現時機「指揮官在處理對話中查到新資料」（fetched）。
// 指揮官在處理對話用網路工具（web_search、web_read_page）查到的外部資料，沒寫成筆記也要和相關領域的既有筆記比對。
// 這裡只放純函式：從工具結果取出外部證據、記住比對過的資料（同一份資料不重複比對）、包裝工具收集證據。
// 比對流程本身在 check.ts checkFetched；接到 App 的部分在 runtime.ts checkFetchedEvidence。
import type { AgentTool, AgentToolResult } from '@/lib/agent/types'
import type { ExternalEvidence } from './types'

/** 只有真的取得外部新資料的工具才觸發（MCP 工具可能是本機筆記庫自己，先不算，見 PR「待 Scott 確認」）。 */
export const FETCH_TOOL_NAMES: ReadonlySet<string> = new Set(['web_search', 'web_read_page'])

/** 一次比對最多帶幾份外部資料（同確認卡「交給指揮官」的上限）。 */
export const FETCHED_EVIDENCE_LIMIT = 5
const SNIPPET_MAX = 1500

export const FETCHED_SEEN_KEY = 'almanacFetchedEvidenceSeen'
/** 記住的資料數上限：超過時丟掉最舊的。 */
export const FETCHED_SEEN_CAP = 500

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clip(value: string): string {
  return Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, SNIPPET_MAX).join('')
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/** 從網路工具的成功結果取出外部證據；失敗、沒網址、不是取得外部資料的工具一律回傳空的。 */
export function evidenceFromToolResult(toolName: string, result: AgentToolResult | undefined): ExternalEvidence[] {
  if (!result?.ok || !FETCH_TOOL_NAMES.has(toolName) || !result.data || typeof result.data !== 'object') return []
  const data = result.data as Record<string, unknown>
  if (toolName === 'web_search') {
    const sources = Array.isArray(data.sources) ? data.sources : []
    return sources.flatMap(source => {
      if (!source || typeof source !== 'object') return []
      const record = source as Record<string, unknown>
      const url = text(record.url)
      if (!isHttpUrl(url)) return []
      return [{ title: text(record.title) || url, url, snippet: clip(text(record.snippet)) }]
    })
  }
  const url = text(data.url)
  if (!isHttpUrl(url)) return []
  return [{ title: text(data.title) || url, url, snippet: clip(text(data.content)) }]
}

/** 同一份資料的識別：網址（去掉 #片段與結尾斜線）。 */
export function evidenceKey(evidence: Pick<ExternalEvidence, 'url'>): string {
  return evidence.url.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
}

/** 這一輪查到的一份資料；read＝讀過全文（web_read_page），比搜尋摘要完整。 */
export interface FetchedItem {
  evidence: ExternalEvidence
  read: boolean
}

/**
 * 同一輪裡的資料合併：同一網址只留一份（讀過全文的取代搜尋摘要）。
 * 讀過全文的排前面（Scott 的問題真正用到的資料），其餘照查到的順序，最多 limit 份。
 */
export function mergeEvidence(items: readonly FetchedItem[], limit = FETCHED_EVIDENCE_LIMIT): ExternalEvidence[] {
  const byKey = new Map<string, FetchedItem>()
  for (const item of items) {
    const key = evidenceKey(item.evidence)
    const known = byKey.get(key)
    if (!known || (item.read && !known.read)) byKey.set(key, item)
  }
  const merged = [...byKey.values()]
  return [...merged.filter(item => item.read), ...merged.filter(item => !item.read)].slice(0, limit).map(item => item.evidence)
}

/** 比對過的資料。claim 回傳這次才要比對的（同時記下，避免兩輪同時比對同一份）；比對失敗用 release 放回。 */
export interface FetchedSeen {
  claim: (keys: readonly string[]) => Promise<string[]>
  release: (keys: readonly string[]) => Promise<void>
}

function remember(list: readonly string[], keys: readonly string[], cap: number): string[] {
  const next = [...list.filter(key => !keys.includes(key)), ...keys]
  return next.slice(Math.max(0, next.length - cap))
}

/** 存在記憶體（測試用）。 */
export function memorySeen(initial: readonly string[] = [], cap = FETCHED_SEEN_CAP): FetchedSeen & { keys: () => string[] } {
  let list = [...initial]
  return {
    claim: async keys => {
      const fresh = Array.from(new Set(keys)).filter(key => !list.includes(key))
      list = remember(list, fresh, cap)
      return fresh
    },
    release: async keys => { list = list.filter(key => !keys.includes(key)) },
    keys: () => [...list],
  }
}

let pending = Promise.resolve()
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.then(operation)
  pending = next.then(() => undefined, () => undefined)
  return next
}

/** 存在 store.json；同一個鍵的讀改寫依序執行。 */
export function storeSeen(store: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> }, key = FETCHED_SEEN_KEY, cap = FETCHED_SEEN_CAP): FetchedSeen {
  const read = async () => {
    const raw = await store.get(key)
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
  }
  return {
    claim: keys => serialize(async () => {
      const list = await read()
      const fresh = Array.from(new Set(keys)).filter(item => !list.includes(item))
      if (fresh.length) await store.set(key, remember(list, fresh, cap))
      return fresh
    }),
    release: keys => serialize(async () => {
      if (!keys.length) return
      const list = await read()
      await store.set(key, list.filter(item => !keys.includes(item)))
    }),
  }
}

/** 包裝取得外部資料的工具：成功的結果照常回給模型，同時把外部證據交給 collect。其他工具原樣回傳。 */
export function collectFetchedEvidence(tools: AgentTool[], collect: (items: FetchedItem[]) => void): AgentTool[] {
  return tools.map(tool => {
    if (!FETCH_TOOL_NAMES.has(tool.name)) return tool
    return {
      ...tool,
      execute: async (input, context) => {
        const result = await tool.execute(input, context)
        try {
          const evidence = evidenceFromToolResult(tool.name, result)
          if (evidence.length) collect(evidence.map(item => ({ evidence: item, read: tool.name === 'web_read_page' })))
        } catch (error) {
          console.warn('[cleanup] fetched evidence skipped:', error)
        }
        return result
      },
    }
  })
}

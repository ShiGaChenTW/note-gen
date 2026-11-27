// Fork（almanac ALMNC-88）：專家回顧領域（每週整理，trigger: 'review'）時，發現同一主題的零散片段太多，
// 產生一張「建議你親手整理」卡（工作台「要你親手整理」一組，攤到檯面整理）。這裡是門檻與去重的純函式。
// 門檻：預設 5 則；專家的 rules.md 可以寫「- 零散片段門檻：8 則」調整（和「重新確認頻率」同一個地方）。
// 去重：同一群筆記（一半以上已在某張卡裡）已有未處理的卡、或 30 天內才整理好過，就不再產生。

/** 同一主題至少幾則零散片段才建議親手整理。 */
export const DEFAULT_FRAGMENT_THRESHOLD = 5
/** rules.md 寫得比這個小就不採用（兩三則不算「太多」）。 */
export const MIN_FRAGMENT_THRESHOLD = 3
/** 整理好之後多久內，同一群筆記不再產生卡片。 */
export const FRAGMENT_COOLDOWN_DAYS = 30

/** 專家回顧產生的一張「建議你親手整理」卡（一包筆記）。 */
export interface ReviewHandPack {
  id: string
  /** 回顧的是哪個領域（MOC id）與名稱（卡片說明用）。 */
  domainId: string
  domainName: string
  /** 那個主題（卡片標題）。 */
  topic: string
  /** 專家說的理由（展開後顯示）。 */
  reason: string
  /** 那群筆記（依專家列的順序）。 */
  paths: string[]
  /** 誰提的（專家本名；沒有專家時是指揮官）。 */
  by?: string
  createdAt: number
}

export interface FragmentGroup {
  topic: string
  reason: string
  paths: string[]
}

const RULE_LINE = /(?:零散片段|零碎片段|fragment)\s*(?:門檻|门槛|threshold)\s*[:：]?\s*(\d+)/i

/** 從 rules.md 找「零散片段門檻：8」；找不到或小於 MIN_FRAGMENT_THRESHOLD 回傳 undefined。 */
export function parseFragmentThreshold(rules: string | undefined | null): number | undefined {
  if (!rules) return undefined
  for (const line of rules.split(/\r?\n/)) {
    const match = line.match(RULE_LINE)
    if (!match) continue
    const value = Number(match[1])
    if (Number.isInteger(value) && value >= MIN_FRAGMENT_THRESHOLD) return value
  }
  return undefined
}

/** 一半以上的筆記已經在某一包裡：算同一群。 */
export function overlapsExisting(paths: readonly string[], existing: ReadonlyArray<{ paths: readonly string[] }>): boolean {
  return existing.some(pack => {
    const known = new Set(pack.paths)
    return paths.filter(path => known.has(path)).length * 2 >= paths.length
  })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim().slice(0, 200) : ''
}

/**
 * 模型回的 fragments（[{ topic, reason, notes: [索引] }]）→ 要產生的卡片。
 * 只收存在的筆記（索引重複、超出範圍不算），達門檻才算；和既有的包、同一次前面的組重疊的不算。
 */
export function fragmentGroups(
  input: unknown,
  notes: ReadonlyArray<{ path: string }>,
  threshold: number,
  existing: ReadonlyArray<{ paths: readonly string[] }>,
): FragmentGroup[] {
  if (!Array.isArray(input)) return []
  const out: FragmentGroup[] = []
  for (const item of input) {
    const value = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const topic = text(value.topic)
    if (!topic || !Array.isArray(value.notes)) continue
    const paths = [...new Set(value.notes.flatMap(index => typeof index === 'number' && Number.isInteger(index) && index >= 0 ? notes[index]?.path ?? [] : []))]
    if (paths.length < threshold || overlapsExisting(paths, [...existing, ...out])) continue
    out.push({ topic, reason: text(value.reason), paths })
  }
  return out
}

/** 每週整理的提示詞多一個欄位（只在這個領域的筆記數達門檻時加）。 */
export function fragmentPrompt(threshold: number): string {
  return `fragments: [{"topic":"short topic name","reason":"why these should be consolidated by hand","notes":[0,1]}]. Only list a topic when at least ${threshold} short, scattered notes fragment the same topic and would read better merged or rewritten by the owner. Most weeks this should be empty.`
}

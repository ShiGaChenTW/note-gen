// Fork（almanac ALMNC-54.12）：依領域找類似筆記——專家撰寫草稿（C1）和衝突偵測都用這裡。
// 先從筆記庫索引挑同一個領域的知識筆記（已被取代、封存的不算），用標題、摘要、標題列做字元雙字組相似度排序；
// 有既有的知識搜尋（RAG／關鍵字，src/lib/knowledge-search.ts）時，命中的筆記再加分。純函式＋注入，預設實作在 runtime.ts。
import type { SimilarNote } from '@/lib/commander/types'

/** 字元雙字組（中文沒有空白，雙字組比斷詞穩）；英數字以整個詞計。 */
export function textGrams(text: string): Set<string> {
  const grams = new Set<string>()
  const lower = text.toLowerCase()
  for (const word of lower.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []) grams.add(word)
  const han = lower.replace(/[a-z0-9_\-\s\p{P}\p{S}]+/gu, ' ')
  for (const chunk of han.split(' ')) {
    const chars = Array.from(chunk)
    if (chars.length === 1) grams.add(chars[0])
    for (let i = 0; i + 1 < chars.length; i++) grams.add(chars[i] + chars[i + 1])
  }
  return grams
}

/** Dice 係數：兩段文字的相似度，0～1。 */
export function similarity(a: string | Set<string>, b: string | Set<string>): number {
  const x = typeof a === 'string' ? textGrams(a) : a
  const y = typeof b === 'string' ? textGrams(b) : b
  if (!x.size || !y.size) return 0
  let shared = 0
  for (const gram of x) if (y.has(gram)) shared++
  return (2 * shared) / (x.size + y.size)
}

/** a 有多少比例出現在 b 裡（0～1）；短句被長文包含時用這個，不受長文長度影響。 */
export function containment(a: string | Set<string>, b: string | Set<string>): number {
  const x = typeof a === 'string' ? textGrams(a) : a
  const y = typeof b === 'string' ? textGrams(b) : b
  if (!x.size) return 0
  let shared = 0
  for (const gram of x) if (y.has(gram)) shared++
  return shared / x.size
}

export interface IndexedNoteForSimilar {
  path: string
  frontmatter: Record<string, unknown> | null
  tags?: readonly string[]
  headings?: ReadonlyArray<{ text: string }>
}

export interface SimilarCandidate extends SimilarNote {
  score: number
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function titleOf(note: IndexedNoteForSimilar): string {
  const title = note.frontmatter?.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  return (note.path.split('/').pop() ?? note.path).replace(/\.md$/i, '')
}

function describe(note: IndexedNoteForSimilar): string {
  const summary = typeof note.frontmatter?.summary === 'string' ? note.frontmatter.summary : ''
  return [titleOf(note), summary, ...(note.headings ?? []).map(heading => heading.text), ...strings(note.frontmatter?.tags)].join(' ')
}

export interface RankOptions {
  /** 只看這個領域（沒給就看沒有領域的知識筆記）。 */
  domainId?: string
  /** Fork（almanac ALMNC-69.4）：這個領域在筆記 domains 裡可能的寫法（領域名稱、舊 dom_ id）；沒給就只比 domainId。 */
  domainRefs?: readonly string[]
  /** 不分領域（親手寫的筆記還沒有領域時用）。 */
  allDomains?: boolean
  /** 排除的路徑（例如筆記自己）。 */
  exclude?: readonly string[]
  limit?: number
  minScore?: number
  /** 知識搜尋命中的路徑與分數（0～1），加權併入。 */
  searchHits?: ReadonlyMap<string, number>
}

/** 同領域、還有效（或待查證）的知識筆記，依相似度由高到低。 */
export function rankSimilarNotes(query: string, notes: Iterable<IndexedNoteForSimilar>, options: RankOptions = {}): SimilarCandidate[] {
  const queryGrams = textGrams(query)
  const exclude = new Set(options.exclude ?? [])
  const out: SimilarCandidate[] = []
  for (const note of notes) {
    const fm = note.frontmatter
    if (!fm || fm.type !== 'knowledge' || exclude.has(note.path)) continue
    if (fm.status === 'superseded' || fm.status === 'archived') continue
    const domains = strings(fm.domains)
    const refs = options.domainRefs?.length ? options.domainRefs : options.domainId ? [options.domainId] : []
    if (!options.allDomains && (options.domainId ? !domains.some(entry => refs.includes(entry)) : domains.length > 0)) continue
    const lexical = similarity(queryGrams, textGrams(describe(note)))
    const hit = options.searchHits?.get(note.path) ?? 0
    const score = Math.min(1, lexical + hit * 0.5)
    if (score < (options.minScore ?? 0.08)) continue
    out.push({ path: note.path, title: titleOf(note), score })
  }
  return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, options.limit ?? 5)
}

export interface SimilarFinderDeps {
  notes: () => Iterable<IndexedNoteForSimilar>
  /** 既有的知識搜尋；失敗或沒有就只用索引。回傳筆記路徑與 0～1 的分數。 */
  search?: (query: string) => Promise<Array<{ path: string, score: number }>>
}

/** 包成指揮官 C1 用的 findSimilarNotes（domainId 沒給就看沒有領域的知識筆記）。 */
export function createSimilarFinder(deps: SimilarFinderDeps, options: Pick<RankOptions, 'limit' | 'minScore'> = {}) {
  return async (domainId: string | undefined, query: { title: string, body: string }, exclude: readonly string[] = [], scope: { allDomains?: boolean, domainRefs?: readonly string[] } = {}): Promise<SimilarCandidate[]> => {
    const text = `${query.title}\n${query.body}`.slice(0, 2000)
    let searchHits: Map<string, number> | undefined
    if (deps.search) {
      try {
        searchHits = new Map((await deps.search(text.slice(0, 300))).map(hit => [hit.path, Math.max(0, Math.min(1, hit.score))]))
      } catch {
        searchHits = undefined
      }
    }
    return rankSimilarNotes(text, deps.notes(), { domainId, domainRefs: scope.domainRefs, exclude, searchHits, allDomains: scope.allDomains, ...options })
  }
}

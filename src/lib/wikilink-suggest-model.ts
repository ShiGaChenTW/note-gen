/**
 * L2：`[[` 自動完成的純函式。排名與子序列比對沿用 markdown-file-link 的寫法；
 * 那個檔案沒有 export 的小函式複製在下面，避免改共用模組。
 */
import { noteKeyOf, wikilinkTargetFor } from '@/lib/markdown/wikilink'

export interface WikilinkInputContext {
  /** `[[` 與游標之間的文字，不含括號 */
  query: string
  /** `[[` 在 textBeforeCursor 裡的起點（不是編輯器 position） */
  from: number
}

export interface WikilinkSuggestNote {
  path: string
  aliases: string[]
  /** 同分時最近修改優先；索引還沒有時間時可省略 */
  mtime?: number
}

export interface WikilinkSuggestion {
  path: string
  /** 不含路徑與 .md 的筆記名稱 */
  label: string
  /** 資料夾；在 vault 根目錄時為空字串 */
  folder: string
  /** 用別名命中時是那個別名，用名稱或路徑命中時為 null */
  matchedAlias: string | null
  score: number
}

/** 名稱前綴 > 別名前綴 > 名稱子序列 > 別名子序列 > 路徑子序列 */
const SCORE = {
  namePrefix: 500,
  aliasPrefix: 400,
  nameSubsequence: 300,
  aliasSubsequence: 200,
  pathSubsequence: 100,
} as const

/**
 * 游標前最後一個 `[[`（前面不是 `\`；`![[` 也算）。
 * 到游標之間若出現 `]]`、換行、`[` 或 `]`，代表不是未完成的 wikilink。
 */
export function findWikilinkInputContext(textBeforeCursor: string): WikilinkInputContext | null {
  const marker = textBeforeCursor.lastIndexOf('[[')
  if (marker < 0) return null
  if (marker > 0 && textBeforeCursor[marker - 1] === '\\') return null
  const query = textBeforeCursor.slice(marker + 2)
  if (query.includes(']]') || query.includes('\n') || query.includes('[') || query.includes(']')) return null
  return { query, from: marker }
}

export function rankWikilinkSuggestions(options: {
  query: string
  notes: WikilinkSuggestNote[]
  currentPath: string
  /** 空 query 時依這個順序排列；沒對到筆記時改依修改時間 */
  recentPaths?: string[]
  limit?: number
}): WikilinkSuggestion[] {
  const { query, notes, currentPath, recentPaths, limit = 8 } = options
  const currentKey = pathKey(currentPath)
  const prepared = prepareNotes(notes).filter(note => pathKey(note.path) !== currentKey)

  if (query === '') {
    return rankEmptyQuery(prepared, recentPaths).slice(0, limit)
  }

  const needle = query.toLowerCase()
  return prepared
    .flatMap(note => {
      const matched = scoreNote(note, needle)
      if (!matched) return []
      return [{ ...toSuggestion(note, matched.score, matched.matchedAlias), mtime: note.mtime }]
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (right.mtime !== left.mtime) return right.mtime - left.mtime
      if (left.path.length !== right.path.length) return left.path.length - right.path.length
      return left.path.localeCompare(right.path, 'zh-Hant')
    })
    .slice(0, limit)
    .map(({ path, label, folder, matchedAlias, score }) => ({ path, label, folder, matchedAlias, score }))
}

export function buildWikilinkInsertion(options: {
  suggestion: Pick<WikilinkSuggestion, 'path' | 'matchedAlias'>
  allPaths: Iterable<string>
  /** 游標後面已經是 `]]` 時不重複補上 */
  hasClosingBrackets: boolean
}): string {
  const target = wikilinkTargetFor(options.suggestion.path, options.allPaths)
  const alias = options.suggestion.matchedAlias ?? ''
  const body = alias ? `${target}|${alias}` : target
  return options.hasClosingBrackets ? `[[${body}` : `[[${body}]]`
}

export function buildCreateInsertion(query: string): string {
  return `[[${query}]]`
}

/**
 * 建立列要隱藏的「完全同名」：沒有資料夾時比筆記名稱，有資料夾時比完整路徑。
 * 結尾的 `.md` 可有可無，比較前 `toLowerCase()`。
 */
export function isExactNoteName(query: string, path: string): boolean {
  const normalizedQuery = normalizePath(query).replace(/\.md$/i, '').toLowerCase()
  if (!normalizedQuery) return false
  const normalized = normalizePath(path)
  const full = normalized.replace(/\.md$/i, '').toLowerCase()
  if (normalizedQuery.includes('/')) return normalizedQuery === full
  return normalizedQuery === noteKeyOf(normalized).toLowerCase()
}

// --- 從 markdown-file-link.ts 複製的未 export 小函式（那個檔案不能改） ---

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

function isSubsequence(query: string, value: string): boolean {
  let queryIndex = 0
  for (const character of value) {
    if (character === query[queryIndex]) queryIndex++
    if (queryIndex === query.length) return true
  }
  return query.length === 0
}

interface PreparedNote {
  path: string
  label: string
  folder: string
  aliases: string[]
  mtime: number
}

function prepareNotes(notes: WikilinkSuggestNote[]): PreparedNote[] {
  const byPath = new Map<string, PreparedNote>()
  for (const note of notes) {
    const path = normalizePath(note.path)
    if (!path.toLowerCase().endsWith('.md')) continue
    const key = path.toLowerCase()
    const mtime = note.mtime ?? 0
    const existing = byPath.get(key)
    if (existing && existing.mtime > mtime) continue
    const slash = path.lastIndexOf('/')
    byPath.set(key, {
      path,
      label: noteKeyOf(path),
      folder: slash < 0 ? '' : path.slice(0, slash),
      aliases: (note.aliases ?? []).filter(alias => alias.trim() !== ''),
      mtime,
    })
  }
  return [...byPath.values()]
}

function pathKey(path: string): string {
  return normalizePath(path).toLowerCase()
}

function scoreNote(note: PreparedNote, needle: string): { score: number, matchedAlias: string | null } | null {
  const label = note.label.toLowerCase()
  if (label.startsWith(needle)) return { score: SCORE.namePrefix, matchedAlias: null }

  const aliasPrefix = firstAlias(note.aliases, alias => alias.toLowerCase().startsWith(needle), needle)
  if (aliasPrefix) return { score: SCORE.aliasPrefix, matchedAlias: aliasPrefix }

  if (isSubsequence(needle, label)) return { score: SCORE.nameSubsequence, matchedAlias: null }

  const aliasSubsequence = firstAlias(note.aliases, alias => isSubsequence(needle, alias.toLowerCase()), needle)
  if (aliasSubsequence) return { score: SCORE.aliasSubsequence, matchedAlias: aliasSubsequence }

  if (isSubsequence(needle, note.path.toLowerCase())) return { score: SCORE.pathSubsequence, matchedAlias: null }
  return null
}

/** 同一個層級有多個別名時，完全相符優先，否則用清單裡的第一個。 */
function firstAlias(aliases: string[], matches: (alias: string) => boolean, needle: string): string | null {
  let first: string | null = null
  for (const alias of aliases) {
    if (!matches(alias)) continue
    if (alias.toLowerCase() === needle) return alias
    if (!first) first = alias
  }
  return first
}

function toSuggestion(note: PreparedNote, score: number, matchedAlias: string | null): WikilinkSuggestion {
  return {
    path: note.path,
    label: note.label,
    folder: note.folder,
    matchedAlias,
    score,
  }
}

function rankEmptyQuery(notes: PreparedNote[], recentPaths: string[] | undefined): WikilinkSuggestion[] {
  const order = new Map<string, number>()
  for (const [index, path] of (recentPaths ?? []).entries()) {
    const key = pathKey(path)
    if (!order.has(key)) order.set(key, index)
  }
  if (order.size > 0) {
    const recent = notes
      .filter(note => order.has(pathKey(note.path)))
      .sort((left, right) => order.get(pathKey(left.path))! - order.get(pathKey(right.path))!)
    if (recent.length > 0) return recent.map(note => toSuggestion(note, 1, null))
  }
  return [...notes]
    .sort((left, right) => {
      if (right.mtime !== left.mtime) return right.mtime - left.mtime
      if (left.path.length !== right.path.length) return left.path.length - right.path.length
      return left.path.localeCompare(right.path, 'zh-Hant')
    })
    .map(note => toSuggestion(note, 1, null))
}

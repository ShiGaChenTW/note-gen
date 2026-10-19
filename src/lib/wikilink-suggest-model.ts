/**
 * L2：`[[` 自動完成的純函式。排名與子序列比對沿用 markdown-file-link 的寫法；
 * 那個檔案沒有 export 的小函式複製在下面，避免改共用模組。
 */
import { noteKeyOf, wikilinkTargetFor } from '@/lib/markdown/wikilink'

export type WikilinkSuggestMode = 'note' | 'heading' | 'block'

export interface WikilinkInputContext {
  /**
   * 筆記模式是 `[[` 與游標之間的文字。
   * 標題模式是第一個 `#` 之後；區塊模式是 `#^` 之後。
   */
  query: string
  /** `[[` 在 textBeforeCursor 裡的起點（不是編輯器 position） */
  from: number
  mode: WikilinkSuggestMode
  /** `#` 前的筆記名。沒有 `#`，或 `[[#` 這種本篇寫法，都是空字串 */
  noteQuery: string
}

export interface SuggestHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6
  text: string
  line: number
}

export interface SuggestBlock {
  id: string
  line: number
  context: string
}

export interface WikilinkSuggestNote {
  path: string
  aliases: string[]
  /** 同分時最近修改優先；索引還沒有時間時可省略 */
  mtime?: number
  headings?: SuggestHeading[]
  blockIds?: SuggestBlock[]
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

export interface WikilinkHeadingSuggestion {
  path: string
  /** 寫進 `[[ ]]` 的目標。本篇 `[[#標題]]` 時為空字串 */
  target: string
  level: 1 | 2 | 3 | 4 | 5 | 6
  text: string
  line: number
  score: number
}

export interface WikilinkBlockSuggestion {
  path: string
  /** 寫進 `[[ ]]` 的目標。本篇 `[[#^id]]` 時為空字串 */
  target: string
  id: string
  line: number
  context: string
  score: number
}

export interface WikilinkAnchorResult<T> {
  /** 對到的筆記；筆記名對不到唯一一篇時為 null */
  notePath: string | null
  /** 過濾前的標題或區塊數（空白標題不算） */
  total: number
  suggestions: T[]
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
 * 第一個 `#` 進入標題模式；`#^` 進入區塊模式。
 */
export function findWikilinkInputContext(textBeforeCursor: string): WikilinkInputContext | null {
  const marker = textBeforeCursor.lastIndexOf('[[')
  if (marker < 0) return null
  if (marker > 0 && textBeforeCursor[marker - 1] === '\\') return null
  const inner = textBeforeCursor.slice(marker + 2)
  if (inner.includes(']]') || inner.includes('\n') || inner.includes('[') || inner.includes(']')) return null
  const hash = inner.indexOf('#')
  if (hash < 0) return { query: inner, from: marker, mode: 'note', noteQuery: '' }
  const noteQuery = inner.slice(0, hash)
  const afterHash = inner.slice(hash + 1)
  if (afterHash.startsWith('^')) {
    return { query: afterHash.slice(1), from: marker, mode: 'block', noteQuery }
  }
  return { query: afterHash, from: marker, mode: 'heading', noteQuery }
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

const ANCHOR_SCORE = { prefix: 500, subsequence: 300, listed: 1 } as const

/**
 * 用筆記名對到唯一一篇（或本篇），再列出它的標題。
 * 筆記名空白（`[[#`）就是目前這篇。完全同名優先；否則沿用筆記排名，最高分必須只有一篇。
 */
export function rankHeadingSuggestions(options: {
  noteQuery: string
  query: string
  notes: WikilinkSuggestNote[]
  currentPath: string
}): WikilinkAnchorResult<WikilinkHeadingSuggestion> {
  const resolved = resolveSuggestNote(options.noteQuery, options.notes, options.currentPath)
  if (!resolved) return { notePath: null, total: 0, suggestions: [] }
  const headings = resolved.note.headings.filter(heading => heading.text.trim() !== '')
  const suggestions = rankByText(headings, options.query).map(item => ({
    path: resolved.note.path,
    target: resolved.target,
    level: item.level,
    text: item.text,
    line: item.line,
    score: item.score,
  }))
  return { notePath: resolved.note.path, total: headings.length, suggestions }
}

/** 與標題相同的對筆記規則，列出區塊 id。比對的是 id，不是那一行的內文。 */
export function rankBlockSuggestions(options: {
  noteQuery: string
  query: string
  notes: WikilinkSuggestNote[]
  currentPath: string
}): WikilinkAnchorResult<WikilinkBlockSuggestion> {
  const resolved = resolveSuggestNote(options.noteQuery, options.notes, options.currentPath)
  if (!resolved) return { notePath: null, total: 0, suggestions: [] }
  const blocks = resolved.note.blockIds
  const suggestions = rankByText(blocks.map(block => ({ ...block, text: block.id })), options.query).map(item => ({
    path: resolved.note.path,
    target: resolved.target,
    id: item.text,
    line: item.line,
    context: item.context ?? '',
    score: item.score,
  }))
  return { notePath: resolved.note.path, total: blocks.length, suggestions }
}

export function buildWikilinkInsertion(options: {
  suggestion: Pick<WikilinkSuggestion, 'path' | 'matchedAlias'>
  allPaths: Iterable<string>
  /** 游標後面已經是 `]]` 時不重複補上 */
  hasClosingBrackets: boolean
  /** 標題文字。標題裡的 `|` 會寫成 `\|`，避免被當成別名 */
  heading?: string
  blockId?: string
  /** 本篇：輸出 `[[#標題]]` 或 `[[#^id]]` */
  self?: boolean
}): string {
  const target = options.self ? '' : wikilinkTargetFor(options.suggestion.path, options.allPaths)
  const alias = options.suggestion.matchedAlias ?? ''
  let anchor = ''
  if (options.blockId) anchor = `#^${options.blockId}`
  else if (options.heading) anchor = `#${options.heading.replace(/\|/g, '\\|')}`
  const body = `${target}${anchor}`
  const withAlias = alias ? `${body}|${alias}` : body
  return options.hasClosingBrackets ? `[[${withAlias}` : `[[${withAlias}]]`
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
  headings: SuggestHeading[]
  blockIds: SuggestBlock[]
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
      headings: note.headings ?? [],
      blockIds: note.blockIds ?? [],
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

/** `#` 前的筆記名。`|` 之後的別名不拿來對筆記；空白代表本篇。 */
function noteNameFromQuery(noteQuery: string): string {
  const trimmed = noteQuery.trim()
  const pipe = trimmed.search(/\\?\|/)
  return (pipe >= 0 ? trimmed.slice(0, pipe) : trimmed).trim()
}

function isExactNoteQuery(note: PreparedNote, needle: string): boolean {
  if (!needle.includes('/') && note.label.toLowerCase() === needle) return true
  if (note.aliases.some(alias => alias.toLowerCase() === needle)) return true
  const full = note.path.toLowerCase()
  return full === needle || full.replace(/\.md$/i, '') === needle
}

function resolveSuggestNote(
  noteQuery: string,
  notes: WikilinkSuggestNote[],
  currentPath: string,
): { note: PreparedNote, target: string } | null {
  const prepared = prepareNotes(notes)
  const name = noteNameFromQuery(noteQuery)
  if (!name) {
    if (!pathKey(currentPath)) return null
    const current = prepared.find(item => pathKey(item.path) === pathKey(currentPath))
    return current ? { note: current, target: '' } : null
  }

  const needle = name.toLowerCase()
  const exact = prepared.filter(item => isExactNoteQuery(item, needle))
  if (exact.length > 1) return null
  let note = exact[0]
  if (!note) {
    const matched = prepared.flatMap(item => {
      const scored = scoreNote(item, needle)
      return scored ? [{ item, score: scored.score, mtime: item.mtime }] : []
    })
    if (matched.length === 0) return null
    matched.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (right.mtime !== left.mtime) return right.mtime - left.mtime
      if (left.item.path.length !== right.item.path.length) return left.item.path.length - right.item.path.length
      return left.item.path.localeCompare(right.item.path, 'zh-Hant')
    })
    if (matched.length > 1 && matched[0].score === matched[1].score) return null
    note = matched[0].item
  }
  return { note, target: wikilinkTargetFor(note.path, prepared.map(item => item.path)) }
}

function anchorScore(text: string, query: string): number | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return ANCHOR_SCORE.listed
  const haystack = text.toLowerCase()
  if (haystack.startsWith(needle)) return ANCHOR_SCORE.prefix
  if (isSubsequence(needle, haystack)) return ANCHOR_SCORE.subsequence
  return null
}

function rankByText<T extends { text: string, line: number }>(items: T[], query: string): Array<T & { score: number }> {
  const ranked: Array<T & { score: number }> = []
  for (const item of items) {
    const score = anchorScore(item.text, query)
    if (score === null) continue
    ranked.push({ ...item, score })
  }
  ranked.sort((left, right) => right.score - left.score || left.line - right.line || left.text.localeCompare(right.text, 'zh-Hant'))
  return ranked
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

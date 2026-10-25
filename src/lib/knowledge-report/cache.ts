// Fork（#34）：知識報告的增量快取。存在 app 資料目錄（不進 vault）：
// 每篇筆記的分析結果與修改日、PDF 字數、主題摘要。以索引的 mtime 判斷要不要重讀。
import { dayKey } from '@/lib/home/activity'
import type { NoteAnalysis, SummaryCounts } from './note-signals'

export const CACHE_VERSION = 1
/** 每篇筆記最多記幾個修改日（給「改寫過幾次」與回顧間隔用） */
export const EDIT_DAYS_KEEP = 60

export interface CachedNote {
  mtime: number
  analysis?: NoteAnalysis
  summary?: SummaryCounts
  /** 觀察到 mtime 變新的日子（YYYY-MM-DD，取 mtime 當天），由舊到新 */
  editDays: string[]
}

export interface CachedPdf {
  mtime: number
  words: number
}

export interface TopicSummaryCache {
  /** 主題內筆記與 mtime 的指紋；不同就要重做摘要 */
  fingerprint: string
  summary: string
  at: number
}

export interface ReportCache {
  version: number
  workspace: string
  notes: Record<string, CachedNote>
  pdfs: Record<string, CachedPdf>
  topicSummaries: Record<string, TopicSummaryCache>
}

export function emptyCache(workspace: string): ReportCache {
  return { version: CACHE_VERSION, workspace, notes: {}, pdfs: {}, topicSummaries: {} }
}

/** 版本或工作區不符、格式壞掉時整份重建。 */
export function normalizeCache(raw: unknown, workspace: string): ReportCache {
  const value = raw as Partial<ReportCache> | null
  if (!value || value.version !== CACHE_VERSION || value.workspace !== workspace) return emptyCache(workspace)
  const obj = (input: unknown) => (input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, never> : {})
  return { version: CACHE_VERSION, workspace, notes: obj(value.notes), pdfs: obj(value.pdfs), topicSummaries: obj(value.topicSummaries) }
}

export interface RefreshPlan {
  /** 沒有快取、或 mtime 不同，要重讀 */
  stale: string[]
  /** 快取裡有、索引已經沒有 */
  removed: string[]
}

export function planRefresh(cache: ReportCache, current: ReadonlyMap<string, number>): RefreshPlan {
  const stale: string[] = []
  for (const [path, mtime] of current) {
    const entry = cache.notes[path]
    if (!entry || entry.mtime !== mtime) stale.push(path)
  }
  const removed = Object.keys(cache.notes).filter(path => !current.has(path))
  return { stale, removed }
}

export interface NoteUpdate {
  path: string
  mtime: number
  analysis?: NoteAnalysis
  summary?: SummaryCounts
}

export function applyRefresh(cache: ReportCache, updates: NoteUpdate[], removed: string[]): ReportCache {
  const notes = { ...cache.notes }
  for (const path of removed) delete notes[path]
  for (const update of updates) {
    const before = notes[update.path]
    let editDays = before?.editDays ?? []
    if (update.mtime > 0 && (!before || update.mtime > before.mtime)) {
      const day = dayKey(new Date(update.mtime))
      if (!editDays.includes(day)) editDays = [...editDays, day].sort().slice(-EDIT_DAYS_KEEP)
    }
    notes[update.path] = { mtime: update.mtime, analysis: update.analysis, summary: update.summary, editDays }
  }
  return { ...cache, notes }
}

export function editDaysOf(cache: ReportCache): Map<string, string[]> {
  return new Map(Object.entries(cache.notes).map(([path, entry]) => [path, entry.editDays]))
}

/** 指紋：排序後的「路徑:mtime」做字串雜湊。 */
export function topicFingerprint(paths: Iterable<string>, mtimeOf: (path: string) => number): string {
  const text = [...paths].sort().map(path => `${path}:${mtimeOf(path)}`).join('\n')
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0
  return `${hash.toString(36)}-${text.length.toString(36)}`
}

export function getTopicSummary(cache: ReportCache, topic: string, fingerprint: string): string | null {
  const entry = cache.topicSummaries[topic]
  return entry && entry.fingerprint === fingerprint ? entry.summary : null
}

export function setTopicSummary(cache: ReportCache, topic: string, fingerprint: string, summary: string, now = Date.now()): ReportCache {
  return { ...cache, topicSummaries: { ...cache.topicSummaries, [topic]: { fingerprint, summary, at: now } } }
}

/** 上一期之後有變動的筆記（增量分析的範圍）。 */
export function changedSince(notes: Iterable<{ path: string; mtime: number }>, since: number): string[] {
  const out: string[] = []
  for (const note of notes) if (note.mtime > since) out.push(note.path)
  return out.sort()
}

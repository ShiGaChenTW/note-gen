/**
 * F3 vault 索引的狀態運算：比對快取與目前檔案、快取格式檢查、任務查詢。
 * 另含索引服務的讀檔並行數，以及快取寫入的 idle／timer 排程（不讀檔）。
 */

import { INDEX_SCHEMA_VERSION, type IndexedNote, type IndexedTask } from './index-note'

export interface ListedFile {
  path: string
  mtime: number
}

export interface ScanPlan {
  /** 新檔或 mtime 改變，需要讀檔重新索引 */
  toIndex: string[]
  /** 快取裡有、但 vault 已沒有 */
  toRemove: string[]
}

/** 只重新索引新增或修改過的檔案；mtime 為 0（取不到）時一律重讀。 */
export function planScan(cached: ReadonlyMap<string, IndexedNote>, listed: readonly ListedFile[]): ScanPlan {
  const seen = new Set<string>()
  const toIndex: string[] = []
  for (const file of listed) {
    seen.add(file.path)
    const prev = cached.get(file.path)
    if (!prev || file.mtime === 0 || prev.mtime !== file.mtime) toIndex.push(file.path)
  }
  const toRemove = [...cached.keys()].filter(path => !seen.has(path))
  return { toIndex, toRemove }
}

export interface IndexCacheFile {
  version: number
  workspace: string
  savedAt: number
  notes: IndexedNote[]
}

export function serializeIndexCache(workspace: string, notes: Iterable<IndexedNote>, now: number): IndexCacheFile {
  return { version: INDEX_SCHEMA_VERSION, workspace, savedAt: now, notes: [...notes] }
}

/** 版本或工作區不符、格式壞掉時回傳空表，讓呼叫端整份重建。 */
export function restoreIndexCache(raw: unknown, workspace: string): Map<string, IndexedNote> {
  const out = new Map<string, IndexedNote>()
  if (!raw || typeof raw !== 'object') return out
  const file = raw as Partial<IndexCacheFile>
  if (file.version !== INDEX_SCHEMA_VERSION || file.workspace !== workspace || !Array.isArray(file.notes)) return out
  for (const note of file.notes) {
    if (note && typeof note.path === 'string' && typeof note.mtime === 'number' && Array.isArray(note.tasks)) {
      out.set(note.path, note)
    }
  }
  return out
}

export interface TaskRef extends IndexedTask {
  path: string
}

/** 攤平所有筆記的任務，依路徑、行號排序，方便呈現與比對。 */
export function collectTasks(notes: Iterable<IndexedNote>): TaskRef[] {
  const out: TaskRef[] = []
  for (const note of notes) {
    for (const task of note.tasks) out.push({ ...task, path: note.path })
  }
  return out.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1))
}

/** 讀內容重建索引的並行數：50 篇以內用 4，再多才用 8。 */
export function indexReadConcurrency(fileCount: number): number {
  if (fileCount <= 0) return 0
  return Math.min(fileCount, fileCount <= 50 ? 4 : 8)
}

/** 列出檔案後補 mtime 的並行數。不讀檔案內容。 */
export function listStatConcurrency(fileCount: number): number {
  if (fileCount <= 0) return 0
  return Math.min(32, fileCount)
}

/**
 * 有 requestIdleCallback 就等閒置（最遲 timeoutMs）再寫快取；沒有就用 setTimeout。
 * 回傳取消函式。
 */
export function scheduleVaultIndexSave(run: () => void, timeoutMs: number): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(() => run(), { timeout: timeoutMs })
    return () => cancelIdleCallback(handle)
  }
  const timer = setTimeout(run, timeoutMs)
  return () => clearTimeout(timer)
}

/** 監看事件的路徑整理：只留 vault 內、非隱藏的 .md 相對路徑。 */
export function toIndexablePath(absolutePath: string, workspaceRoot: string): string | null {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = absolutePath.replace(/\\/g, '/')
  if (!path.startsWith(`${root}/`)) return null
  const relative = path.slice(root.length + 1)
  if (!relative.toLowerCase().endsWith('.md')) return null
  if (relative.split('/').some(part => part.startsWith('.'))) return null
  return relative
}

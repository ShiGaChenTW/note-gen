// Fork (F3): in-memory vault index. Filled by src/lib/vault-index/service.ts.
import { create } from 'zustand'
import { collectTasks, type TaskRef } from '@/lib/vault-index/index-core'
import { collectBacklinks, collectOutgoingLinks, type BacklinkRef, type OutgoingLink } from '@/lib/vault-index/links'
import { buildTagTree, type TagNode } from '@/lib/vault-index/tags'
import type { IndexedNote } from '@/lib/vault-index/index-note'

export type VaultIndexStatus = 'idle' | 'scanning' | 'ready' | 'error'

export interface VaultScanStats {
  /** 從開始到可查詢的毫秒數 */
  ms: number
  files: number
  /** 實際讀檔重新索引的數量（其餘來自快取） */
  indexed: number
  fromCache: boolean
}

interface VaultIndexState {
  status: VaultIndexStatus
  workspace: string
  notes: Map<string, IndexedNote>
  /** 每次內容變動加一，讓 selector 判斷要不要重算 */
  revision: number
  lastScan: VaultScanStats | null
  error: string | null
  /** 由索引服務設定；今日頁的「重新掃描」使用 */
  rescan: (() => Promise<void>) | null

  reset: (workspace: string) => void
  setStatus: (status: VaultIndexStatus, error?: string | null) => void
  replaceAll: (notes: Map<string, IndexedNote>) => void
  upsert: (notes: IndexedNote[]) => void
  remove: (paths: string[]) => void
  setLastScan: (stats: VaultScanStats) => void
  setRescan: (rescan: (() => Promise<void>) | null) => void
}

const useVaultIndexStore = create<VaultIndexState>((set, get) => ({
  status: 'idle',
  workspace: '',
  notes: new Map(),
  revision: 0,
  lastScan: null,
  error: null,
  rescan: null,

  reset: (workspace) => set({
    status: 'idle',
    workspace,
    notes: new Map(),
    revision: get().revision + 1,
    lastScan: null,
    error: null,
  }),
  setStatus: (status, error = null) => set({ status, error }),
  replaceAll: (notes) => set({ notes, revision: get().revision + 1 }),
  upsert: (notes) => {
    if (notes.length === 0) return
    const next = new Map(get().notes)
    for (const note of notes) next.set(note.path, note)
    set({ notes: next, revision: get().revision + 1 })
  },
  remove: (paths) => {
    const current = get().notes
    if (!paths.some(path => current.has(path))) return
    const next = new Map(current)
    for (const path of paths) next.delete(path)
    set({ notes: next, revision: get().revision + 1 })
  },
  setLastScan: (lastScan) => set({ lastScan }),
  setRescan: (rescan) => set({ rescan }),
}))

let taskCache: { revision: number, tasks: TaskRef[] } | null = null

/** 全 vault 的任務（依路徑、行號排序）；同一個 revision 只算一次。 */
export function selectAllTasks(state: Pick<VaultIndexState, 'notes' | 'revision'>): TaskRef[] {
  if (taskCache?.revision !== state.revision) {
    taskCache = { revision: state.revision, tasks: collectTasks(state.notes.values()) }
  }
  return taskCache.tasks
}

let linkRevision = -1
let linkNotes: Map<string, IndexedNote> | null = null
const backlinkCache = new Map<string, BacklinkRef[]>()
const outgoingCache = new Map<string, OutgoingLink[]>()

type LinkState = Pick<VaultIndexState, 'notes' | 'revision'>

function refreshLinkCache(state: LinkState) {
  if (linkRevision === state.revision && linkNotes === state.notes) return
  linkRevision = state.revision
  linkNotes = state.notes
  backlinkCache.clear()
  outgoingCache.clear()
}

export function selectBacklinks(state: LinkState, targetPath: string): BacklinkRef[] {
  refreshLinkCache(state)
  if (!backlinkCache.has(targetPath)) backlinkCache.set(targetPath, collectBacklinks(targetPath, state.notes.values()))
  return backlinkCache.get(targetPath)!
}

export function selectOutgoingLinks(state: LinkState, path: string): OutgoingLink[] {
  refreshLinkCache(state)
  if (!outgoingCache.has(path)) outgoingCache.set(path, collectOutgoingLinks(path, state.notes.values()))
  return outgoingCache.get(path)!
}

let tagCache: { revision: number, tree: TagNode[] } | null = null

/** 全 vault 的標籤樹（依名稱排序）；同一個 revision 只算一次。 */
export function selectTagTree(state: Pick<VaultIndexState, 'notes' | 'revision'>): TagNode[] {
  if (tagCache?.revision !== state.revision) {
    tagCache = { revision: state.revision, tree: buildTagTree(state.notes.values()) }
  }
  return tagCache.tree
}

export default useVaultIndexStore

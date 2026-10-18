// Fork (F3): in-memory vault index. Filled by src/lib/vault-index/service.ts.
import { create } from 'zustand'
import { collectTasks, type TaskRef } from '@/lib/vault-index/index-core'
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

  reset: (workspace: string) => void
  setStatus: (status: VaultIndexStatus, error?: string | null) => void
  replaceAll: (notes: Map<string, IndexedNote>) => void
  upsert: (notes: IndexedNote[]) => void
  remove: (paths: string[]) => void
  setLastScan: (stats: VaultScanStats) => void
}

const useVaultIndexStore = create<VaultIndexState>((set, get) => ({
  status: 'idle',
  workspace: '',
  notes: new Map(),
  revision: 0,
  lastScan: null,
  error: null,

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
}))

let taskCache: { revision: number, tasks: TaskRef[] } | null = null

/** 全 vault 的任務（依路徑、行號排序）；同一個 revision 只算一次。 */
export function selectAllTasks(state: Pick<VaultIndexState, 'notes' | 'revision'>): TaskRef[] {
  if (taskCache?.revision !== state.revision) {
    taskCache = { revision: state.revision, tasks: collectTasks(state.notes.values()) }
  }
  return taskCache.tasks
}

export default useVaultIndexStore

// Fork (F3): in-memory vault index. Filled by src/lib/vault-index/service.ts.
import { create } from 'zustand'
import { collectTasks, type TaskRef } from '@/lib/vault-index/index-core'
import { buildLinkLookup, buildVaultLinkIndex, type BacklinkRef, type OutgoingLink } from '@/lib/vault-index/links'
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

type LinkState = Pick<VaultIndexState, 'notes' | 'revision'>

interface RevisionLinkIndex {
  revision: number
  notes: Map<string, IndexedNote>
  backlinks: Map<string, BacklinkRef[]>
  outgoing: Map<string, OutgoingLink[]>
  /** 查詢字串原文 → 結果，讓同一個路徑重複呼叫回傳同一個陣列 */
  backlinkHits: Map<string, BacklinkRef[]>
  outgoingHits: Map<string, OutgoingLink[]>
}

let linkIndex: RevisionLinkIndex | null = null

/** 同一個 revision、同一份 notes 只建一次對照表與反向索引，兩個 selector 共用。 */
function ensureLinkIndex(state: LinkState): RevisionLinkIndex {
  if (linkIndex && linkIndex.revision === state.revision && linkIndex.notes === state.notes) return linkIndex
  const lookup = buildLinkLookup(state.notes.keys())
  const built = buildVaultLinkIndex(state.notes.values(), lookup)
  linkIndex = {
    revision: state.revision,
    notes: state.notes,
    backlinks: built.backlinks,
    outgoing: built.outgoing,
    backlinkHits: new Map(),
    outgoingHits: new Map(),
  }
  return linkIndex
}

/** Fork（#32）：沒有任何進出連結的筆記（排除指定資料夾，例如每日筆記、Inbox）。 */
export function selectLinklessPaths(state: LinkState, excludeFolders: string[] = []): string[] {
  const index = ensureLinkIndex(state)
  const prefixes = excludeFolders.map(folder => folder.replace(/^\/+|\/+$/g, '')).filter(Boolean).map(folder => `${folder}/`)
  const out: string[] = []
  for (const path of state.notes.keys()) {
    if (!path.toLowerCase().endsWith('.md') || prefixes.some(prefix => path.startsWith(prefix))) continue
    const outgoing = index.outgoing.get(path) ?? []
    if (outgoing.some(link => link.resolved)) continue
    if ((index.backlinks.get(path.toLowerCase()) ?? []).length > 0) continue
    out.push(path)
  }
  return out
}

export function selectBacklinks(state: LinkState, targetPath: string): BacklinkRef[] {
  const index = ensureLinkIndex(state)
  const hit = index.backlinkHits.get(targetPath)
  if (hit) return hit
  const found = index.backlinks.get(targetPath.toLowerCase()) ?? []
  index.backlinkHits.set(targetPath, found)
  return found
}

export function selectOutgoingLinks(state: LinkState, path: string): OutgoingLink[] {
  const index = ensureLinkIndex(state)
  const hit = index.outgoingHits.get(path)
  if (hit) return hit
  const found = index.outgoing.get(path) ?? []
  index.outgoingHits.set(path, found)
  return found
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

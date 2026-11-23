// Fork（almanac ALMNC-69.3，Q9）：從「新增資料源」對話框的「新增文件」打開的文件。
// 這些文件的編輯器工具列把「送給指揮官」換成「完成」：存檔不送，按「完成」才交給指揮官（勾了「這是日誌」就帶日誌標籤）。
// 只記在這次開著的 App 裡（不寫進 store.json）；重開 App 後這篇就是一般筆記，照常有「送給指揮官」。
// 標題欄位改名、檔案樹改名都走 renameWorkspaceFile，那裡會呼叫 rename 讓記錄跟著新路徑。
import { create } from 'zustand'

export interface PendingDoneEntry {
  /** Scott 在對話框勾了「這是日誌」。 */
  journal: boolean
}

export type PendingDoneMap = Readonly<Record<string, PendingDoneEntry>>

/** 改名或搬移（含資料夾改名）後，把記錄搬到新路徑；沒有相關的記錄就回傳原物件。 */
export function renamePendingPaths(pending: PendingDoneMap, from: string, to: string): PendingDoneMap {
  let changed = false
  const next: Record<string, PendingDoneEntry> = {}
  for (const [path, entry] of Object.entries(pending)) {
    const moved = path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path
    if (moved !== path) changed = true
    next[moved] = entry
  }
  return changed ? next : pending
}

interface PendingDoneState {
  pending: PendingDoneMap
  mark: (path: string, entry: PendingDoneEntry) => void
  rename: (from: string, to: string) => void
  clear: (path: string) => void
}

export const usePendingDoneStore = create<PendingDoneState>(set => ({
  pending: {},
  mark: (path, entry) => set(state => ({ pending: { ...state.pending, [path]: entry } })),
  rename: (from, to) => set(state => {
    const pending = renamePendingPaths(state.pending, from, to)
    return pending === state.pending ? state : { pending }
  }),
  clear: path => set(state => {
    if (!(path in state.pending)) return state
    const rest = { ...state.pending }
    delete rest[path]
    return { pending: rest }
  }),
}))

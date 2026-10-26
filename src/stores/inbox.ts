// Fork（#46）：Inbox 頁的顯示狀態。Inbox 頁與首頁同一時間只開一個。
import { create } from 'zustand'
import { getMarkPreviews, getTrashMarkPreviews, type Mark } from '@/db/marks'
import { getProcessedRecords, type RecordProcessed } from '@/db/record-processed'
import useHomeStore from './home'

interface InboxState {
  visible: boolean
  /** 沒刪除的記錄（含已整理），新的在前。 */
  records: Mark[]
  trashRecords: Mark[]
  processed: Map<number, RecordProcessed>
  loaded: boolean
  refresh: () => Promise<void>
  /** 看垃圾桶裡的記錄。 */
  trash: boolean
  setTrash: (value: boolean) => void
  /** 是否連已整理的記錄一起列出。 */
  showProcessed: boolean
  /** 右欄展開的記錄。 */
  focusedMarkId: number | null
  show: (options?: { focusMarkId?: number, showProcessed?: boolean }) => void
  hide: () => void
  setShowProcessed: (value: boolean) => void
  setFocusedMarkId: (id: number | null) => void
}

let refreshing: Promise<void> | null = null
let refreshAgain = false

const useInboxStore = create<InboxState>(set => ({
  visible: false,
  records: [],
  trashRecords: [],
  processed: new Map(),
  loaded: false,
  refresh: async () => {
    // 連續觸發時合併成一次，結束後再補跑一次拿到最新狀態
    if (refreshing) {
      refreshAgain = true
      return refreshing
    }
    refreshing = (async () => {
      do {
        refreshAgain = false
        try {
          const [records, trashRecords, processed] = await Promise.all([getMarkPreviews(), getTrashMarkPreviews(), getProcessedRecords()])
          set({ records, trashRecords, processed, loaded: true })
        } catch (error) {
          console.error('[inbox] failed to load records:', error)
        }
      } while (refreshAgain)
    })().finally(() => { refreshing = null })
    return refreshing
  },
  trash: false,
  setTrash: value => set({ trash: value }),
  showProcessed: false,
  focusedMarkId: null,
  show: options => {
    useHomeStore.getState().hide()
    set(state => ({
      visible: true,
      trash: options?.focusMarkId !== undefined ? false : state.trash,
      focusedMarkId: options?.focusMarkId ?? state.focusedMarkId,
      showProcessed: options?.showProcessed ? true : state.showProcessed,
    }))
  },
  hide: () => set({ visible: false }),
  setShowProcessed: value => set({ showProcessed: value }),
  setFocusedMarkId: id => set({ focusedMarkId: id }),
}))

// 首頁打開時收起 Inbox 頁
useHomeStore.subscribe((state, previous) => {
  if (state.visible && !previous.visible) useInboxStore.getState().hide()
})

/** 還沒整理的記錄。 */
export function selectUnprocessedRecords(state: Pick<InboxState, 'records' | 'processed'>): Mark[] {
  return state.records.filter(record => !state.processed.has(record.id))
}

/** 放超過 staleDays 天還沒整理的記錄（「Inbox 積壓」連記錄一起算）。 */
export function selectStaleRecords(state: Pick<InboxState, 'records' | 'processed'>, staleDays: number, now: Date): Mark[] {
  const cutoff = now.getTime() - staleDays * 24 * 60 * 60 * 1000
  return selectUnprocessedRecords(state).filter(record => record.createdAt > 0 && record.createdAt < cutoff)
}

export default useInboxStore

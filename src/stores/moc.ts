// Fork（almanac ALMNC-69.7）：MOC 解析結果的快取（MOC 是筆記屬於哪些領域的唯一依據）。
// 由 MocRebuildService（app/core/main/moc）在 App 啟動與檔案變動後重建時更新；領域頁讀成員與五區塊、工作台讀超過上限的筆記。
import { create } from 'zustand'
import type { NoteDomainChange } from '@/lib/moc/membership'
import type { ParsedMoc } from '@/lib/moc/parse'

/** 超過上限的筆記＋第一次發現的時間（工作台卡片排序用，重建時沿用）。 */
export type OverLimitNote = NoteDomainChange & { at: number }

interface MocState {
  /** 筆記庫裡的 MOC（kind: domain）解析結果。 */
  mocs: ParsedMoc[]
  /** 收錄超過 3 個領域的筆記（after 是全部收錄，等 Scott 在工作台選要拿掉哪個）。 */
  overLimit: OverLimitNote[]
  /** 至少重建過一次（成功或失敗都算；領域頁用來決定要不要顯示載入中）。 */
  loaded: boolean
  setResult: (result: { mocs: ParsedMoc[], overLimit: NoteDomainChange[] }) => void
  markLoaded: () => void
}

const useMocStore = create<MocState>(set => ({
  mocs: [],
  overLimit: [],
  loaded: false,
  setResult: ({ mocs, overLimit }) => set(state => {
    const now = Date.now()
    const seen = new Map(state.overLimit.map(item => [item.path, item.at]))
    return { mocs, overLimit: overLimit.map(item => ({ ...item, at: seen.get(item.path) ?? now })), loaded: true }
  }),
  markLoaded: () => set({ loaded: true }),
}))

export default useMocStore

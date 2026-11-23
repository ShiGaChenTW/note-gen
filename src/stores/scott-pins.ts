// Fork（almanac ALMNC-69.11）：有效的「Scott 指定」標記（記憶體一份，畫面用）。來源是 note.db 的 scott_pins（db/scott-pins.ts），
// 由 lib/moc/scott-pins-runtime 在記下新標記、換筆記庫或 MOC 重建後更新；提案卡讀它標出「這是 Scott 指定的位置」。
import { create } from 'zustand'
import type { ScottPin } from '@/lib/moc/scott-pins'

interface ScottPinsState {
  pins: ScottPin[]
  /** 這份標記屬於哪個筆記庫。 */
  workspace: string | null
  setPins: (workspace: string, pins: ScottPin[]) => void
}

const useScottPinsStore = create<ScottPinsState>(set => ({
  pins: [],
  workspace: null,
  setPins: (workspace, pins) => set({ workspace, pins }),
}))

export default useScottPinsStore

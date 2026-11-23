// Fork（almanac ALMNC-69.10）：Obsidian 手動編輯 MOC 的整批檢查（等 Scott 確認的那一批）。由 reconcile-runtime 每次比對後更新，
// 工作台讀它出「整批檢查」卡；卡上逐條取消的選擇記在 cancelled（重新比對後同一條差異的鍵不變，選擇保留）。
import { create } from 'zustand'
import type { BatchReason, EffectiveDiff, PlannedMoc, ReconcileDiff } from '@/lib/moc/reconcile'

export interface PendingMocBatch {
  /** 這一批的鍵（卡片鍵；同一批重新比對時沿用）。 */
  id: string
  /** 第一次出現的時間。 */
  at: number
  reasons: BatchReason[]
  removals: number
  mocs: PlannedMoc[]
  /** 會生效的差異（卡片逐條列出）。 */
  diffs: EffectiveDiff[]
  /** 只提醒的（斷鏈、格式壞了）。 */
  notices: ReconcileDiff[]
}

interface MocReconcileState {
  pending: PendingMocBatch | null
  /** 卡片上取消的差異鍵。 */
  cancelled: string[]
  setPending: (batch: PendingMocBatch | null) => void
  toggleCancelled: (id: string) => void
}

const useMocReconcileStore = create<MocReconcileState>(set => ({
  pending: null,
  cancelled: [],
  setPending: batch => set(state => {
    if (!batch) return { pending: null, cancelled: [] }
    const ids = new Set(batch.diffs.map(diff => diff.id))
    const keep = state.pending ? { id: state.pending.id, at: state.pending.at } : {}
    return { pending: { ...batch, ...keep }, cancelled: state.cancelled.filter(id => ids.has(id)) }
  }),
  toggleCancelled: id => set(state => ({
    cancelled: state.cancelled.includes(id) ? state.cancelled.filter(item => item !== id) : [...state.cancelled, id],
  })),
}))

export default useMocReconcileStore

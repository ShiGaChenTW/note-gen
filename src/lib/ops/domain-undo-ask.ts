// Fork（almanac ALMNC-72）：撤回成立領域提案時的詢問——非同步問答（呼叫端 await askDomainUndo），
// 畫面由 components/ops/domain-undo-dialog.tsx 的 DomainUndoAskHost 讀這個 store 顯示。同時只問一則；新的詢問會把舊的當成取消。
import { create } from 'zustand'
import type { DomainUndoChoice, ProposalExpert } from './domain-undo'

interface DomainUndoAskState {
  pending: ProposalExpert | null
}

export const useDomainUndoAsk = create<DomainUndoAskState>(() => ({ pending: null }))

let resolver: ((choice: DomainUndoChoice | null) => void) | null = null

/** 問 Scott 要「只撤回 MOC」還是「一起撤回新建的專家」；null＝取消。 */
export function askDomainUndo(expert: ProposalExpert): Promise<DomainUndoChoice | null> {
  resolver?.(null)
  return new Promise(resolve => {
    resolver = resolve
    useDomainUndoAsk.setState({ pending: expert })
  })
}

export function answerDomainUndo(choice: DomainUndoChoice | null): void {
  const resolve = resolver
  resolver = null
  useDomainUndoAsk.setState({ pending: null })
  resolve?.(choice)
}

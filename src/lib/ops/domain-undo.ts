// Fork（almanac ALMNC-72）：撤回「成立領域」提案時，當下問 Scott 要「只撤回 MOC」還是「一起撤回新建的專家」。
// MOC 檔與收錄照原本 ops 撤回（domains 表那一列是 MOC 的索引快取，撤回 MOC 時 reconcileDomainIndexes 已一併清掉）；
// 這裡只判斷「這次提案新建的專家（與其記憶）能不能安全撤回」，以及問答後的流程。I/O 全部注入，App 接線在 domain-undo-runtime.ts。
import { normalizeDomainName } from '@/lib/commander/assign'
import type { OpRecord } from './types'

/** 接受領域提案時真的新建的專家（沿用既有同領域專家的不算）；以那次接受的 batch 為鍵。 */
export interface ProposalExpert {
  batchId: string
  proposalId?: string
  agentId: string
  name: string
  domain: string
  /** 專家與記憶寫完的時間；之後的修改都算「後續」。 */
  at: number
  removedAt?: number | null
}

export type DomainUndoChoice = 'moc-only' | 'with-expert'

/** 不刪專家的原因。 */
export type ExpertKeepReason =
  /** 專家已經不在（被刪過）。 */
  | 'missing'
  /** 專家的領域被改成別的（已被其他領域使用）。 */
  | 'domain-changed'
  /** 撤回後還有同名的領域在用這位專家。 */
  | 'domain-in-use'
  /** 接受之後改過專家設定或記憶，或已有工作筆記。 */
  | 'edited'
  /** 專家已有活動紀錄或任務。 */
  | 'activity'

/** 判斷要用的現況（App 從 note.db 讀）。 */
export interface ExpertSnapshot {
  agent: { id: string, role: string, domain?: string, updatedAt: number } | null
  /** 存過的記憶（沒存過、還是範本的不列）。 */
  memory: ReadonlyArray<{ kind: 'soul' | 'rules' | 'work_notes', updatedAt: number }>
  /** 這位專家當發起者的活動紀錄筆數。 */
  activityCount: number
  /** 交給這位專家的任務筆數。 */
  taskCount: number
  /** 撤回 MOC 之後仍存在的領域名稱。 */
  domainNames: readonly string[]
}

/** 有登記新建專家、還沒撤回過，且這批裡有尚未復原的成立領域，才需要問。 */
export function needsDomainUndoChoice(records: ReadonlyArray<Pick<OpRecord, 'kind' | 'undoneAt'>>, expert: ProposalExpert | null | undefined): expert is ProposalExpert {
  if (!expert || expert.removedAt) return false
  return records.some(record => record.kind === 'domain.create' && record.undoneAt === null)
}

/** 可以安全撤回時回傳空陣列；否則列出所有原因（不刪，告知 Scott）。 */
export function expertKeepReasons(expert: ProposalExpert, snapshot: ExpertSnapshot): ExpertKeepReason[] {
  const { agent } = snapshot
  if (!agent || agent.id !== expert.agentId || agent.role !== 'expert') return ['missing']
  const reasons: ExpertKeepReason[] = []
  const domain = normalizeDomainName(expert.domain)
  if (normalizeDomainName(agent.domain) !== domain) reasons.push('domain-changed')
  else if (snapshot.domainNames.some(name => normalizeDomainName(name) === domain)) reasons.push('domain-in-use')
  if (agent.updatedAt > expert.at || snapshot.memory.some(doc => doc.kind === 'work_notes' || doc.updatedAt > expert.at)) {
    reasons.push('edited')
  }
  if (snapshot.activityCount > 0 || snapshot.taskCount > 0) reasons.push('activity')
  return reasons
}

export type ExpertUndoOutcome =
  | { status: 'removed', expert: ProposalExpert }
  | { status: 'kept', expert: ProposalExpert, reasons: ExpertKeepReason[] }

export type DomainUndoOutcome<R> =
  | { status: 'cancelled' }
  | { status: 'done', choice: DomainUndoChoice, result: R, expert?: ExpertUndoOutcome }

export interface DomainUndoDeps<R> {
  /** 這次撤回對應的新建專家；沒有就不問，直接撤回。 */
  expert: ProposalExpert | null
  /** 問 Scott；null＝取消。 */
  ask: (expert: ProposalExpert) => Promise<DomainUndoChoice | null>
  /** 原本的撤回（MOC 檔與收錄）。 */
  undo: () => Promise<R>
  /** 撤回結果是否成功（衝突、過期時不動專家）。 */
  succeeded: (result: R) => boolean
  removeExpert: (expert: ProposalExpert) => Promise<ExpertUndoOutcome>
  /** 已經問過（例如比較卡「仍要復原」再跑一次）就不再問。 */
  choice?: DomainUndoChoice
}

/** 問 → 撤回 MOC → 選「一起撤回」且撤回成功才移除專家。取消時什麼都不動。 */
export async function runDomainUndo<R>(deps: DomainUndoDeps<R>): Promise<DomainUndoOutcome<R>> {
  let choice: DomainUndoChoice = deps.choice ?? 'moc-only'
  if (deps.expert && !deps.choice) {
    const answer = await deps.ask(deps.expert)
    if (!answer) return { status: 'cancelled' }
    choice = answer
  }
  const result = await deps.undo()
  if (choice !== 'with-expert' || !deps.expert || !deps.succeeded(result)) return { status: 'done', choice, result }
  return { status: 'done', choice, result, expert: await deps.removeExpert(deps.expert) }
}

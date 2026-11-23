// Fork（almanac ALMNC-72）：撤回成立領域提案時的 App 接線——查這次提案有沒有新建專家、問 Scott、安全時刪專家與記憶並記活動紀錄。
// 判斷規則與流程在 domain-undo.ts（純函式）；詢問的對話框在 components/ops/domain-undo-dialog.tsx（掛在 app/layout）。
import type { ActivityEntryInput } from '@/lib/agent-memory/activity'
import {
  expertKeepReasons, needsDomainUndoChoice, runDomainUndo,
  type DomainUndoChoice, type DomainUndoOutcome, type ExpertUndoOutcome, type ProposalExpert,
} from './domain-undo'
import { askDomainUndo } from './domain-undo-ask'
import type { OpRecord } from './types'

/** 工作台立即復原時 Scott 在詢問按了取消：什麼都沒動，復原要放回堆疊。 */
export class DomainUndoCancelled extends Error {
  constructor() {
    super('DOMAIN_UNDO_CANCELLED')
    this.name = 'DomainUndoCancelled'
  }
}

/** 接受領域提案時真的新建了專家（沿用既有的不登記）：記下這次接受的 batch 與專家。記不成只記錯，不讓接受失敗。 */
export async function registerProposalExpert(expert: Omit<ProposalExpert, 'at' | 'removedAt'>): Promise<void> {
  try {
    const { recordProposalExpert } = await import('@/db/proposal-experts')
    await recordProposalExpert({ ...expert, at: Date.now() })
  } catch (error) {
    console.error('[ops] proposal expert not recorded:', error)
  }
}

/** 這批操作若是一則成立領域提案、而且新建了專家，回傳那位專家（要問）；否則 null。 */
export async function proposalExpertForRecords(records: readonly OpRecord[]): Promise<ProposalExpert | null> {
  const batchId = records.find(record => record.batchId)?.batchId
  if (!batchId || !records.some(record => record.kind === 'domain.create')) return null
  try {
    const { getProposalExpert } = await import('@/db/proposal-experts')
    const expert = await getProposalExpert(batchId)
    return needsDomainUndoChoice(records, expert) ? expert : null
  } catch (error) {
    console.debug('[ops] proposal expert unavailable:', error)
    return null
  }
}

/** 設定頁活動紀錄的復原目標（單筆或整批）→ 那一批的操作 → 要不要問。 */
export async function proposalExpertForTarget(target: { opId: string, batchId?: string }): Promise<ProposalExpert | null> {
  try {
    const { opsStore } = await import('@/db/ops')
    const record = await opsStore.get(target.opId)
    const batchId = target.batchId ?? record?.batchId
    const records = batchId ? await opsStore.listBatch(batchId) : record ? [record] : []
    return proposalExpertForRecords(records)
  } catch (error) {
    console.debug('[ops] proposal expert lookup failed:', error)
    return null
  }
}

function clip(text: string): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, 60).join('')
}

/** 撤回新建的專家記一筆 undone（Scott 按的；對象是那位專家）。 */
export function expertUndoneEntry(expert: ProposalExpert): ActivityEntryInput {
  return {
    actorId: 'scott',
    actorRole: 'scott',
    action: 'undone',
    targetLink: `agent:${encodeURIComponent(expert.agentId)}`,
    source: { kind: 'proposal', ref: expert.proposalId ?? `batch:${expert.batchId}` },
    note: clip(`${expert.name} · ${expert.domain}`),
  }
}

/** 撤回 MOC 之後：安全才刪專家與記憶（同一個交易）並記活動紀錄；不安全就保留並回傳原因。 */
export async function removeProposalExpert(expert: ProposalExpert): Promise<ExpertUndoOutcome> {
  const [db, { listDomains }, { appendActivity }] = await Promise.all([
    import('@/db/proposal-experts'), import('@/db/v3-domains'), import('@/db/agent-memory'),
  ])
  const domainNames = (await listDomains()).map(domain => domain.name)
  const snapshot = await db.readExpertSnapshot(expert.agentId, domainNames)
  const reasons = expertKeepReasons(expert, snapshot)
  if (reasons.length || !snapshot.agent) return { status: 'kept', expert, reasons: reasons.length ? reasons : ['missing'] }
  try {
    await db.deleteExpertAndMemory(expert.agentId, snapshot.agent.updatedAt)
  } catch (error) {
    // 判斷完到刪除之間設定被改過：交易整筆不做。
    console.warn('[ops] expert not removed:', error)
    return { status: 'kept', expert, reasons: ['edited'] }
  }
  const at = Date.now()
  await db.markProposalExpertRemoved(expert.batchId, at).catch(error => console.warn('[ops] proposal expert not marked:', error))
  await appendActivity('system', expertUndoneEntry(expert)).catch(error => console.error('[ops] activity not logged:', error))
  return { status: 'removed', expert: { ...expert, removedAt: at } }
}

/** 工作台立即復原（Z）：一則成立領域提案若新建了專家，先問；取消時丟 DomainUndoCancelled（什麼都沒動）。 */
export function domainAwareUndo(records: readonly OpRecord[], undo: () => Promise<boolean>): () => Promise<DomainUndoOutcome<boolean>> {
  return async () => {
    const outcome = await runDomainUndo({
      expert: await proposalExpertForRecords(records),
      ask: askDomainUndo,
      undo,
      succeeded: done => done,
      removeExpert: removeProposalExpert,
    })
    if (outcome.status === 'cancelled') throw new DomainUndoCancelled()
    return outcome
  }
}

/** 立即復原的回傳值帶專家撤回結果時取出來（給 toast）。 */
export function expertOutcomeOf(value: unknown): ExpertUndoOutcome | undefined {
  if (!value || typeof value !== 'object') return undefined
  const outcome = value as Partial<DomainUndoOutcome<unknown>>
  return outcome.status === 'done' ? outcome.expert : undefined
}

export type { DomainUndoChoice }

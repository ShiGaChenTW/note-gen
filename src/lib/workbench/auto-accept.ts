// ALMNC-65.3：在送審前，只自動接受補一則一般連結。
import { idOfContent, titleOfPath } from '@/lib/ops/refs'
import type { LoggedContext } from '@/lib/ops/runtime'
import type { NoteEditOp, OpActor, OpRecord } from '@/lib/ops/types'
import { safeNotePath } from '@/lib/organize/detect'
import { riskOf, type ContentChange, type RiskSubject } from './risk'

export interface AutoAcceptCandidate extends RiskSubject {
  key: string
  actor: Exclude<OpActor, 'scott' | 'system'>
  actorId?: string
}

/** ALMNC-69.11 在此接入標記查詢。前後文一起傳入，讓查詢能判斷受影響的位置。 */
export type IsScottPinned = (change: Readonly<ContentChange>) => Promise<boolean> | boolean
export const isScottPinned: IsScottPinned = () => false

export function linkEditOf(candidate: RiskSubject): NoteEditOp | undefined {
  const change = candidate.changes?.[0]
  if (!change || change.before === null || change.after === null || !safeNotePath(change.path) || riskOf(candidate) !== 'low') return
  const { path, before, after } = change
  return { kind: 'note.edit', path, before, after, noteId: idOfContent(before), title: titleOfPath(path) }
}

export async function tryAutoAcceptLink(candidate: AutoAcceptCandidate, deps: {
  enabled: boolean
  isScottPinned: IsScottPinned
  applyOps: (specs: readonly [NoteEditOp], context: LoggedContext, options: { requireBefore: true }) => Promise<OpRecord[]>
}): Promise<boolean> {
  if (!deps.enabled) return false
  const edit = linkEditOf(candidate)
  if (!edit) return false
  try {
    if (await deps.isScottPinned({ target: 'note', path: edit.path, before: edit.before, after: edit.after })) return false
    const records = await deps.applyOps([edit], {
      actor: candidate.actor, actorId: candidate.actorId, proposalId: candidate.key, logActivity: true, autoAccepted: true,
    }, { requireBefore: true })
    return records.length === 1
  } catch (error) {
    console.debug('[workbench] auto-accept deferred to review:', error)
    return false
  }
}

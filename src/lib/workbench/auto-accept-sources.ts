import type { AgentTask, DraftChange } from '@/lib/agent-tasks/types'
import type { Proposal } from '@/lib/collect/types'
import { proposalChanges } from '@/lib/decide/project'
import { ORGANIZE_KIND, planOf } from '@/lib/organize/drafts'
import type { AutoAcceptCandidate } from './auto-accept'

export function collectLinkCandidate(itemId: string, proposal: Proposal): AutoAcceptCandidate | undefined {
  // 這些欄位可能同時寫入資料源、時段或領域。完整筆記差異以外的動作留給 Scott。
  if (proposal.kind !== 'note' || proposal.slot || proposal.journalTag || proposal.sourceIds?.length
    || proposal.membershipTransfers?.length || (proposal.change && (proposal.change.kind !== 'update'
      || proposal.change.toolName !== 'note_update_file' || proposal.change.targetPath))) return
  return {
    key: `collect:${itemId}:${proposal.id}`,
    verb: proposal.card?.verb ?? (proposal.change?.kind === 'update' ? 'modify' : 'add'),
    changes: proposalChanges(proposal),
    actor: proposal.drafter?.role ?? 'commander',
    actorId: proposal.drafter?.agentId,
  }
}

export function draftLinkCandidate(task: Pick<AgentTask, 'id' | 'kind'>, draft: DraftChange): AutoAcceptCandidate | undefined {
  if (draft.state !== 'pending' || draft.kind !== 'update') return
  const args = planOf(draft)
  if (task.kind === ORGANIZE_KIND ? args?.plan.kind !== 'link' : draft.toolName !== 'note_update_file') return
  // 自動整理用完整計畫，不用畫面預覽的單檔摘要。
  const changes = args?.plan.changes ?? [{ path: draft.path, before: draft.baseContent, after: draft.content ?? null }]
  return {
    key: `draft:${task.id}:${draft.id}`,
    verb: 'modify',
    changes: changes.map(change => ({ ...change, target: 'note' })),
    actor: 'commander',
  }
}

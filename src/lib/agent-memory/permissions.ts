// Fork（almanac ALMNC-54.3）：記憶的寫入權限。規格見 almanac/2026-11-19_proposal_role-data-model.md 第二節「記憶」。
// - soul.md：只有 Scott 能改。
// - rules.md：Scott 直接改；agent 只能產生提案（不會直接寫入，提案介面在 ALMNC-54.5）。
// - 工作筆記：agent 自己或 Scott。
// - 目前脈絡：指揮官或 Scott；其他 agent 發現有誤要寫一筆活動紀錄回報。
// - 活動紀錄：只有系統能寫，而且只能新增。
// - Scott 的偏好：只有 Scott 能改。
import { isAgentActor, type MemoryActor } from './actor'

export const MEMORY_KINDS = ['soul', 'rules', 'work_notes'] as const
export type MemoryKind = typeof MEMORY_KINDS[number]

export function isMemoryKind(value: unknown): value is MemoryKind {
  return MEMORY_KINDS.some(kind => kind === value)
}

/** agent 想改 rules.md 時產生的提案內容；交給提案流程（ALMNC-54.5），不在這裡寫入。 */
export interface RulesChangeProposal {
  kind: 'rules-change'
  agentId: string
  proposedBy: string
  before: string
  after: string
}

export type MemoryDenialReason =
  | 'SOUL_SCOTT_ONLY'
  | 'RULES_NOT_YOURS'
  | 'WORK_NOTES_NOT_YOURS'
  | 'CONTEXT_COMMANDER_ONLY'
  | 'ACTIVITY_SYSTEM_ONLY'
  | 'PREFERENCES_SCOTT_ONLY'

export type MemoryWriteDecision =
  | { decision: 'allow' }
  | { decision: 'propose', proposal: RulesChangeProposal }
  | { decision: 'deny', reason: MemoryDenialReason }

const allow = { decision: 'allow' } as const
const deny = (reason: MemoryDenialReason) => ({ decision: 'deny', reason }) as const

/** 個別記憶（soul、rules、工作筆記）的寫入判斷。before／after 只用來組 rules 的提案。 */
export function decideAgentMemoryWrite(
  actor: MemoryActor,
  target: { agentId: string, kind: MemoryKind },
  before: string,
  after: string,
): MemoryWriteDecision {
  if (actor === 'scott') return allow
  if (!isAgentActor(actor)) {
    return deny(target.kind === 'soul' ? 'SOUL_SCOTT_ONLY' : target.kind === 'rules' ? 'RULES_NOT_YOURS' : 'WORK_NOTES_NOT_YOURS')
  }
  const own = actor.agentId === target.agentId
  switch (target.kind) {
    case 'soul':
      return deny('SOUL_SCOTT_ONLY')
    case 'rules':
      // 自己的 rules 可以提案；指揮官也能替其他角色起草（例如提案新增專家時一併起草 rules.md）。
      if (!own && actor.role !== 'commander') return deny('RULES_NOT_YOURS')
      return {
        decision: 'propose',
        proposal: { kind: 'rules-change', agentId: target.agentId, proposedBy: actor.agentId, before, after },
      }
    case 'work_notes':
      return own ? allow : deny('WORK_NOTES_NOT_YOURS')
  }
}

export function decideContextWrite(actor: MemoryActor): MemoryWriteDecision {
  if (actor === 'scott') return allow
  if (isAgentActor(actor) && actor.role === 'commander') return allow
  return deny('CONTEXT_COMMANDER_ONLY')
}

export function decideActivityWrite(actor: MemoryActor): MemoryWriteDecision {
  return actor === 'system' ? allow : deny('ACTIVITY_SYSTEM_ONLY')
}

export function decidePreferencesWrite(actor: MemoryActor): MemoryWriteDecision {
  return actor === 'scott' ? allow : deny('PREFERENCES_SCOTT_ONLY')
}

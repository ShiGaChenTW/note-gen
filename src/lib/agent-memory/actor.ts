// Fork（almanac ALMNC-54.3）：寫入記憶時一定要說明是誰在寫。
// 'scott' 是 Scott 本人（設定頁上的操作都算 Scott）；'system' 是系統自動寫入（只用在活動紀錄）；其他是某個 agent。
import type { AgentRole } from '@/lib/agents/settings'

export interface AgentActor {
  agentId: string
  role: AgentRole
}

export type MemoryActor = 'scott' | 'system' | AgentActor

export function isAgentActor(actor: MemoryActor): actor is AgentActor {
  return typeof actor === 'object' && actor !== null
}

/** 存進 updated_by 欄位的字串：scott、system 或 agent:<id>。 */
export function actorLabel(actor: MemoryActor): string {
  return isAgentActor(actor) ? `agent:${actor.agentId}` : actor
}

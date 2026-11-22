// Fork（almanac ALMNC-54.2）：角色顯示成「本名 · 角色」，專家的角色名稱固定是「領域＋專家」。
import type { AgentRole } from './settings'

type RoleTranslator = (key: string, values?: Record<string, string>) => string

export interface DisplayableAgent {
  name: string
  role: AgentRole
  domain?: string
}

/** 角色名稱：指揮官／秘書／研究員；專家顯示「工業工程專家」，沒有領域時只顯示「專家」。 */
export function agentRoleLabel(agent: Pick<DisplayableAgent, 'role' | 'domain'>, t: RoleTranslator): string {
  if (agent.role === 'expert' && agent.domain?.trim()) return t('expertOf', { domain: agent.domain.trim() })
  return t(agent.role)
}

/** 「Mia · 指揮官」「Alex · 工業工程專家」。 */
export function agentDisplayName(agent: DisplayableAgent, t: RoleTranslator): string {
  return `${agent.name} · ${agentRoleLabel(agent, t)}`
}

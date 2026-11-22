export const AGENT_TOOL_NAMES = [
  'note_list_files',
  'note_read_file',
  'calendar_read_day',
  'note_create_file',
  'note_update_file',
] as const

export type AgentToolName = typeof AGENT_TOOL_NAMES[number]

// Fork（almanac ALMNC-54.2）：角色改成定案的四個——指揮官（一位）、專家（多位，各負責領域）、秘書（一位）、研究員（一位）。
// 規格見 almanac/2026-11-19_proposal_role-data-model.md 第二節。id 是固定編號，本名（name）只是顯示用，改名不影響過去的對話和提案。
export const AGENT_ROLES = ['commander', 'expert', 'secretary', 'researcher'] as const
export type AgentRole = typeof AGENT_ROLES[number]

/** 只能有一位的角色；專家可以有多位。 */
export const SINGLE_ROLES: readonly AgentRole[] = ['commander', 'secretary', 'researcher']

/** 舊版五個角色（ALMNC-12）對應到新角色；只在資料表升級時用。 */
export const LEGACY_AGENT_ROLES = ['organizer', 'scheduler', 'researcher', 'reviewer', 'custom'] as const
export type LegacyAgentRole = typeof LEGACY_AGENT_ROLES[number]
const LEGACY_ROLE_MAP: Record<LegacyAgentRole, AgentRole> = {
  organizer: 'commander',
  scheduler: 'secretary',
  researcher: 'researcher',
  reviewer: 'expert',
  custom: 'expert',
}

export interface AgentSettingsInput {
  /** 本名，例如 Mia。 */
  name: string
  role: AgentRole
  /** 專家負責的領域，例如「工業工程」；其他角色不用。 */
  domain?: string
  enabled: boolean
  allowedTools: AgentToolName[]
}

export interface AgentSettings extends AgentSettingsInput {
  id: string
  createdAt: number
  updatedAt: number
}

export const ROLE_TOOLS: Record<AgentRole, readonly AgentToolName[]> = {
  commander: ['note_list_files', 'note_read_file', 'note_create_file', 'note_update_file'],
  expert: ['note_list_files', 'note_read_file', 'note_create_file'],
  secretary: ['note_list_files', 'note_read_file', 'calendar_read_day', 'note_update_file'],
  researcher: ['note_list_files', 'note_read_file', 'note_create_file'],
}

/** 第一次使用時提供的預設本名（可修改）；專家由指揮官之後提案新增，不預設。 */
export const DEFAULT_ROSTER: readonly AgentSettingsInput[] = [
  { name: 'Mia', role: 'commander', enabled: true, allowedTools: [...ROLE_TOOLS.commander] },
  { name: 'Leo', role: 'secretary', enabled: true, allowedTools: [...ROLE_TOOLS.secretary] },
  { name: 'Nora', role: 'researcher', enabled: true, allowedTools: [...ROLE_TOOLS.researcher] },
]

export function isAgentToolName(value: unknown): value is AgentToolName {
  return AGENT_TOOL_NAMES.some(name => name === value)
}

export function isAgentRole(value: unknown): value is AgentRole {
  return AGENT_ROLES.some(role => role === value)
}

export function isLegacyAgentRole(value: unknown): value is LegacyAgentRole {
  return LEGACY_AGENT_ROLES.some(role => role === value)
}

/** 專家的領域去掉空白；其他角色一律沒有領域。 */
export function normalizeDomain(role: AgentRole, domain: string | undefined): string | undefined {
  if (role !== 'expert') return undefined
  const trimmed = domain?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * 儲存前檢查名單規則，回傳錯誤代碼或 null。
 * - 指揮官、秘書、研究員各只能一位（編輯自己不算重複）
 * - 專家一定要有領域
 */
export function rosterError(
  existing: readonly Pick<AgentSettings, 'id' | 'role'>[],
  input: Pick<AgentSettingsInput, 'role' | 'domain'>,
  editingId?: string,
): 'ROLE_TAKEN' | 'DOMAIN_REQUIRED' | null {
  if (SINGLE_ROLES.includes(input.role) && existing.some(agent => agent.role === input.role && agent.id !== editingId)) {
    return 'ROLE_TAKEN'
  }
  if (input.role === 'expert' && !normalizeDomain('expert', input.domain)) return 'DOMAIN_REQUIRED'
  return null
}

/** 新增時可選的角色：已經有人擔任的單一角色不能再選。 */
export function availableRoles(existing: readonly Pick<AgentSettings, 'id' | 'role'>[], editingId?: string): AgentRole[] {
  return AGENT_ROLES.filter(role => !SINGLE_ROLES.includes(role) || !existing.some(agent => agent.role === role && agent.id !== editingId))
}

/** 舊資料升級：依建立順序對應新角色；單一角色已被占用時改成專家（領域待指定）並停用，等 Scott 處理。 */
export interface LegacyAgentRow { id: string, role: string, enabled: number, createdAt: number }
export interface MigratedAgentRow { id: string, role: AgentRole, domain: string | null, enabled: number }
export const LEGACY_EXPERT_DOMAIN = '待指定'

export function planLegacyRoleMigration(rows: readonly LegacyAgentRow[]): MigratedAgentRow[] {
  const taken = new Set<AgentRole>()
  return [...rows].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(row => {
    const mapped: AgentRole = isAgentRole(row.role) && !isLegacyAgentRole(row.role)
      ? row.role
      : isLegacyAgentRole(row.role) ? LEGACY_ROLE_MAP[row.role] : 'expert'
    if (SINGLE_ROLES.includes(mapped)) {
      if (!taken.has(mapped)) {
        taken.add(mapped)
        return { id: row.id, role: mapped, domain: null, enabled: row.enabled }
      }
      return { id: row.id, role: 'expert', domain: LEGACY_EXPERT_DOMAIN, enabled: 0 }
    }
    return { id: row.id, role: 'expert', domain: LEGACY_EXPERT_DOMAIN, enabled: row.enabled }
  })
}

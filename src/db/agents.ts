// Fork (ALMNC-12): device-local agent settings and permission audit.
import { executeRecordTransaction, getDb } from './index'
import { initAgentTaskDb } from './agent-tasks'
import { AGENT_SCHEMA, migrateAgentRoles } from '@/lib/agents/schema'
import {
  DEFAULT_ROSTER, isAgentRole, isAgentToolName, normalizeDomain, rosterError,
  type AgentSettings, type AgentSettingsInput,
} from '@/lib/agents/settings'
import type { AgentToolRefusal } from '@/lib/agents/permissions'
import { notifyAlmanacLocalChange } from '@/lib/almanac-sync/notify'

interface SettingsRow extends Omit<AgentSettings, 'allowedTools' | 'enabled' | 'domain'> {
  allowedTools: string
  enabled: number
  domain: string | null
}

const SELECT_SETTINGS = `select id, name, role, domain, enabled, allowed_tools as allowedTools,
  created_at as createdAt, updated_at as updatedAt from agent_settings`

function fromRow(row: SettingsRow): AgentSettings {
  let tools: unknown
  try { tools = JSON.parse(row.allowedTools) } catch { /* Invalid lists grant no tools. */ }
  const { domain, ...rest } = row
  return {
    ...rest,
    ...(domain ? { domain } : {}),
    enabled: row.enabled === 1 && isAgentRole(row.role),
    allowedTools: Array.isArray(tools) ? tools.filter(isAgentToolName) : [],
  }
}

let initialization: Promise<void> | undefined

async function agentDb() {
  const db = await getDb()
  initialization ??= (async () => {
    await initAgentTaskDb()
    for (const sql of AGENT_SCHEMA) await db.execute(sql)
    // Fork（almanac ALMNC-54.2）：舊的五個角色升級成四個角色（只在舊資料表上跑一次）。
    await migrateAgentRoles(db, executeRecordTransaction)
  })().catch(error => {
    initialization = undefined
    throw error
  })
  await initialization
  return db
}

function settingsValues(input: AgentSettingsInput) {
  const name = input.name.trim()
  if (!name || name.length > 80 || !isAgentRole(input.role) ||
      typeof input.enabled !== 'boolean' || !Array.isArray(input.allowedTools) ||
      !input.allowedTools.every(isAgentToolName)) {
    throw new Error('INVALID_AGENT_SETTINGS')
  }
  return [name, input.role, normalizeDomain(input.role, input.domain) ?? null, Number(input.enabled), JSON.stringify([...new Set(input.allowedTools)])]
}

/** 指揮官、秘書、研究員各只能一位；專家要有領域。 */
async function assertRoster(input: AgentSettingsInput, editingId?: string) {
  const error = rosterError(await listAgentSettings(), input, editingId)
  if (error) throw new Error(error)
}

export async function listAgentSettings(): Promise<AgentSettings[]> {
  const db = await agentDb()
  const rows = await db.select<SettingsRow[]>(`${SELECT_SETTINGS} order by created_at, id`)
  return rows.map(fromRow)
}

export async function getAgentSettings(id: string): Promise<AgentSettings | undefined> {
  const db = await agentDb()
  const [row] = await db.select<SettingsRow[]>(`${SELECT_SETTINGS} where id = $1`, [id])
  return row && fromRow(row)
}

export async function createAgentSettings(input: AgentSettingsInput): Promise<string> {
  const values = settingsValues(input)
  await assertRoster(input)
  const db = await agentDb()
  const id = crypto.randomUUID()
  const now = Date.now()
  await db.execute(
    `insert into agent_settings (id, name, role, domain, enabled, allowed_tools, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [id, ...values, now],
  )
  // Fork（almanac ALMNC-85.3）：夥伴名單跟著 V3 同步（crew.json）；同步關著時不做事。
  notifyAlmanacLocalChange('agent-settings')
  return id
}

export async function updateAgentSettings(id: string, input: AgentSettingsInput): Promise<void> {
  const values = settingsValues(input)
  await assertRoster(input, id)
  const db = await agentDb()
  const result = await db.execute(
    `update agent_settings set name = $2, role = $3, domain = $4, enabled = $5, allowed_tools = $6, updated_at = $7
     where id = $1`,
    [id, ...values, Date.now()],
  )
  if (result.rowsAffected !== 1) throw new Error('AGENT_NOT_FOUND')
  notifyAlmanacLocalChange('agent-settings')
}

let seeding: Promise<boolean> | undefined

/**
 * Fork（almanac ALMNC-54.2）：第一次使用（名單是空的）時建立預設的指揮官、秘書、研究員與英文本名，Scott 可以再改。
 * 回傳這次是否有建立。同一次啟動只會試一次。
 */
export function ensureDefaultRoster(): Promise<boolean> {
  seeding ??= (async () => {
    if ((await listAgentSettings()).length > 0) return false
    for (const agent of DEFAULT_ROSTER) await createAgentSettings(agent)
    return true
  })().catch(error => {
    seeding = undefined
    throw error
  })
  return seeding
}

export async function recordAgentToolRefusal(refusal: AgentToolRefusal): Promise<void> {
  const db = await agentDb()
  await db.execute(
    `insert into agent_tool_refusals (agent_id, task_id, tool_name, reason, created_at)
     values ($1, $2, $3, $4, $5)`,
    [refusal.agentId, refusal.taskId, refusal.toolName, refusal.reason, refusal.createdAt],
  )
}

export async function listAgentToolRefusals(taskId: string): Promise<AgentToolRefusal[]> {
  const db = await agentDb()
  return db.select<AgentToolRefusal[]>(
    `select agent_id as agentId, task_id as taskId, tool_name as toolName, reason, created_at as createdAt
     from agent_tool_refusals where task_id = $1 order by id`,
    [taskId],
  )
}

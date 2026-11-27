// Fork（almanac ALMNC-85.3）：夥伴群組的 V3 同步表（設計 2.5～2.9、M4、第 8 節 2A／3A／6A）。
// 一個檔 .data/almanac/crew.json（量很小，不分檔），同步鍵的前綴就是設計的四區：
//   agent:<夥伴同步鍵>          agent_settings（指揮官、秘書、研究員用 role:<角色>；專家用 id）
//   memory:<夥伴同步鍵>:<kind>  agent_memory（soul、rules 用 content 欄；工作筆記用 notes 欄）
//   context                     shared_context（單例）
//   preferences                 scott_preferences（單例）
//
// 合併（欄位規則依欄位名，所以 soul／rules 與工作筆記用不同欄位名）：
// - 夥伴：A 型。單例角色兩台 id 不同時，created_at 較早的為正式 id，另一個進別名表（almanac_sync_aliases，table = 'agents'），
//   本機的 agent_memory.agent_id、proposal_experts.agent_id、agent_tasks.kind 一起改寫；activity_log.actor_id 不改（只能新增），顯示時查別名。
//   未改過的預設夥伴（updated_at == created_at 且內容等於 DEFAULT_ROSTER）一律讓位給遠端（2.6、6A）。
//   兩台各自新增「同名同領域」的專家視為同一位：建立較早的 id 為正式 id。
// - soul、rules、Scott 的偏好：E 型逐行合併；同一段兩種改法 → 出確認卡（conflicts.ts），卡片處理前保留這台的版本（3A）。
// - 工作筆記：E 型，兩台各加的行都留；真的衝突時保留這台、不出卡（夥伴自己寫的）。
// - 目前脈絡：三個欄位各自 A 型，兩邊都改同一欄 → 較晚的贏（只有指揮官能改，短期記憶，不打擾 Scott）。
// - 別台刪專家 → 先問 Scott（2A：askOnRemoteDelete，進待確認清單「設定與夥伴」）。
// - 合併寫入不經過 decideAgentMemoryWrite（另一台寫入時已檢查過），updated_by 保留原寫入者。
import { chooseCanonicalId, recordAlias, resolveAlias } from '../aliases'
import { maxNumber, minNonNull, text, type FieldConflict, type FieldRule } from '../merge'
import type { SyncValue } from '../envelope'
import type { AlmanacSqlDb } from '../sql'
import { DEFAULT_ROSTER, SINGLE_ROLES, type AgentRole } from '@/lib/agents/settings'
import { upsertPendingRecordDeletion } from './pending-records'
import { recordSyncConflict, type SyncConflictSubject } from './conflicts'
import type { AlmanacRowsTable, AlmanacTableContext, LocalSyncRow, RowsTableChange } from './registry'

export const CREW_SYNC_TABLE = 'crew'
export const AGENT_ALIAS_TABLE = 'agents'

export type MemoryKind = 'soul' | 'rules' | 'work_notes'

export interface AgentSyncValue extends SyncValue {
  id: string
  name: string
  role: AgentRole
  domain: string | null
  enabled: boolean
  allowedTools: string[]
  createdAt: number
  updatedAt: number
}

export interface CrewTableDeps {
  /** App：先跑 db/agents、db/agent-memory 的建表（測試直接在 node:sqlite 建表）。 */
  ensureSchema?(db: AlmanacSqlDb): Promise<void>
  /** 有新的待確認刪除（畫面要提示） */
  onPendingChanged?(): void
  /** 有新的確認卡（工作台要重新載入） */
  onConflictsChanged?(): void
}

// ---------- 同步鍵 ----------

export function agentSyncKey(agent: { id: string; role: string }): string {
  return SINGLE_ROLES.includes(agent.role as AgentRole) ? `role:${agent.role}` : agent.id
}

export const agentRowKey = (agentKey: string) => `agent:${agentKey}`
export const memoryRowKey = (agentKey: string, kind: MemoryKind) => `memory:${agentKey}:${kind}`
export const CONTEXT_KEY = 'context'
export const PREFERENCES_KEY = 'preferences'

export type CrewKey =
  | { region: 'agent'; agentKey: string }
  | { region: 'memory'; agentKey: string; kind: MemoryKind }
  | { region: 'context' }
  | { region: 'preferences' }
  | { region: 'unknown' }

/** 夥伴同步鍵本身可能含冒號（role:commander），kind 一定是最後一段。 */
export function parseCrewKey(key: string): CrewKey {
  if (key === CONTEXT_KEY) return { region: 'context' }
  if (key === PREFERENCES_KEY) return { region: 'preferences' }
  if (key.startsWith('agent:')) return { region: 'agent', agentKey: key.slice('agent:'.length) }
  if (key.startsWith('memory:')) {
    const rest = key.slice('memory:'.length)
    const kind = rest.slice(rest.lastIndexOf(':') + 1)
    if (kind === 'soul' || kind === 'rules' || kind === 'work_notes') return { region: 'memory', agentKey: rest.slice(0, rest.lastIndexOf(':')), kind }
  }
  return { region: 'unknown' }
}

// ---------- 合併規則 ----------

/** 單例角色兩台 id 不同：建立較早的為正式 id（兩台算出來一定一樣）。 */
const canonicalIdRule: FieldRule = {
  type: 'resolve',
  resolve: (local, remote, context) => chooseCanonicalId(
    { id: String(local), createdAt: Number(context.local.v.createdAt ?? 0) || null },
    { id: String(remote), createdAt: Number(context.remote.v.createdAt ?? 0) || null },
  ).canonical,
}

export const CREW_RULES: Record<string, FieldRule> = {
  id: canonicalIdRule,
  createdAt: minNonNull(),
  updatedAt: maxNumber(),
  /** soul、rules、Scott 的偏好：只有 Scott 能改的文字，同段衝突出卡 */
  content: text('ask'),
  /** 工作筆記：夥伴自己一行一行加，衝突保留這台、不出卡 */
  notes: text('keep-local'),
}

/** 2.6：未改過的預設夥伴（新裝置剛建的）——不論時間多新都讓位給遠端。 */
export function isPristineAgent(value: SyncValue): boolean {
  const agent = value as Partial<AgentSyncValue>
  if (agent.createdAt === undefined || agent.createdAt !== agent.updatedAt) return false
  const preset = DEFAULT_ROSTER.find(item => item.role === agent.role)
  if (!preset) return false
  const tools = [...(agent.allowedTools ?? [])].sort()
  const presetTools = [...preset.allowedTools].sort()
  return agent.name === preset.name
    && agent.enabled === preset.enabled
    && (agent.domain ?? null) === null
    && tools.length === presetTools.length && tools.every((tool, index) => tool === presetTools[index])
}

// ---------- 本機讀寫 ----------

interface AgentRow {
  id: string
  name: string
  role: string
  domain: string | null
  enabled: number
  allowedTools: string
  createdAt: number
  updatedAt: number
}

interface MemoryRow {
  agentId: string
  kind: MemoryKind
  content: string
  updatedAt: number
  updatedBy: string
}

function parseJson<T>(textValue: string | null | undefined, fallback: T): T {
  try {
    return textValue ? JSON.parse(textValue) as T : fallback
  } catch {
    return fallback
  }
}

function agentValue(row: AgentRow): AgentSyncValue {
  const tools = parseJson<unknown>(row.allowedTools, [])
  return {
    id: row.id,
    name: row.name,
    role: row.role as AgentRole,
    domain: row.domain ?? null,
    enabled: Number(row.enabled) === 1,
    allowedTools: Array.isArray(tools) ? tools.filter((tool): tool is string => typeof tool === 'string') : [],
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  }
}

async function listAgents(db: AlmanacSqlDb): Promise<AgentRow[]> {
  return db.select<AgentRow[]>(
    `select id, name, role, domain, enabled, allowed_tools as allowedTools, created_at as createdAt, updated_at as updatedAt
     from agent_settings order by created_at, id`,
  )
}

/** 純函式：本機的夥伴、記憶、脈絡、偏好 → 同步列。 */
export function crewRows(input: {
  agents: AgentRow[]
  memory: MemoryRow[]
  context: { projects: string; weeklyFocus: string; people: string; updatedAt: number; updatedBy: string } | null
  preferences: { content: string; updatedAt: number } | null
}): Record<string, LocalSyncRow<SyncValue>> {
  const rows: Record<string, LocalSyncRow<SyncValue>> = {}
  const keyOfAgent = new Map<string, string>()
  for (const row of input.agents) {
    const value = agentValue(row)
    const key = agentSyncKey(value)
    keyOfAgent.set(value.id, key)
    rows[agentRowKey(key)] = { v: value, u: value.updatedAt }
  }
  for (const row of input.memory) {
    const agentKey = keyOfAgent.get(row.agentId) ?? row.agentId
    const field = row.kind === 'work_notes' ? 'notes' : 'content'
    rows[memoryRowKey(agentKey, row.kind)] = {
      v: { [field]: row.content, updatedBy: row.updatedBy, updatedAt: Number(row.updatedAt) },
      u: Number(row.updatedAt),
    }
  }
  if (input.context) {
    rows[CONTEXT_KEY] = {
      v: {
        projects: parseJson(input.context.projects, []),
        weeklyFocus: parseJson(input.context.weeklyFocus, []),
        people: parseJson(input.context.people, []),
        updatedBy: input.context.updatedBy,
        updatedAt: Number(input.context.updatedAt),
      },
      u: Number(input.context.updatedAt),
    }
  }
  if (input.preferences) {
    rows[PREFERENCES_KEY] = { v: { content: input.preferences.content, updatedAt: Number(input.preferences.updatedAt) }, u: Number(input.preferences.updatedAt) }
  }
  return rows
}

async function readCrew(db: AlmanacSqlDb): Promise<Record<string, LocalSyncRow<SyncValue>>> {
  const [agents, memory, context, preferences] = await Promise.all([
    listAgents(db),
    db.select<MemoryRow[]>('select agent_id as agentId, kind, content, updated_at as updatedAt, updated_by as updatedBy from agent_memory'),
    db.select<Array<{ projects: string; weeklyFocus: string; people: string; updatedAt: number; updatedBy: string }>>(
      'select projects, weekly_focus as weeklyFocus, people, updated_at as updatedAt, updated_by as updatedBy from shared_context where id = 1',
    ),
    db.select<Array<{ content: string; updatedAt: number }>>('select content, updated_at as updatedAt from scott_preferences where id = 1'),
  ])
  return crewRows({ agents, memory, context: context[0] ?? null, preferences: preferences[0] ?? null })
}

/** 本機那位夥伴換成正式 id：設定、記憶、提案建立的專家、任務一起改；舊 id 進別名表（顯示活動紀錄時換算）。 */
export async function realignAgentId(db: AlmanacSqlDb, fromId: string, toId: string, now: number): Promise<void> {
  if (fromId === toId) return
  await db.execute('update agent_settings set id = $1 where id = $2', [toId, fromId])
  await db.execute('update agent_memory set agent_id = $1 where agent_id = $2', [toId, fromId])
  for (const sql of [
    'update proposal_experts set agent_id = $1 where agent_id = $2',
    "update agent_tasks set kind = 'agent:' || $1 where kind = 'agent:' || $2",
  ]) {
    try {
      await db.execute(sql, [toId, fromId])
    } catch {
      // 表還沒建（這台沒用過這個功能）：沒有要改的。
    }
  }
  await recordAlias(db, AGENT_ALIAS_TABLE, fromId, toId, now)
}

async function writeAgent(db: AlmanacSqlDb, value: AgentSyncValue): Promise<void> {
  await db.execute(
    `insert into agent_settings (id, name, role, domain, enabled, allowed_tools, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict(id) do update set name = excluded.name, role = excluded.role, domain = excluded.domain, enabled = excluded.enabled,
       allowed_tools = excluded.allowed_tools, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    [value.id, value.name, value.role, value.domain ?? null, value.enabled ? 1 : 0, JSON.stringify(value.allowedTools ?? []), value.createdAt, value.updatedAt],
  )
}

async function applyAgent(context: AlmanacTableContext, agentKey: string, value: AgentSyncValue): Promise<void> {
  const { db } = context
  const agents = await listAgents(db)
  if (agentKey.startsWith('role:')) {
    const local = agents.find(agent => agent.role === agentKey.slice('role:'.length))
    if (local && local.id !== value.id) await realignAgentId(db, local.id, value.id, context.now())
    await writeAgent(db, value)
    return
  }
  // 專家
  if (agents.some(agent => agent.id === value.id)) return writeAgent(db, value)
  const canonical = await resolveAlias(db, AGENT_ALIAS_TABLE, value.id)
  if (canonical !== value.id && agents.some(agent => agent.id === canonical)) return
  const twin = agents.find(agent => agent.role === 'expert' && agent.id !== value.id
    && agent.name === value.name && (agent.domain ?? null) === (value.domain ?? null))
  if (twin) {
    const choice = chooseCanonicalId({ id: twin.id, createdAt: Number(twin.createdAt) }, { id: value.id, createdAt: value.createdAt })
    if (choice.canonical === twin.id) {
      await recordAlias(db, AGENT_ALIAS_TABLE, value.id, twin.id, context.now())
      return
    }
    await realignAgentId(db, twin.id, value.id, context.now())
  }
  await writeAgent(db, value)
}

async function localAgentIdFor(db: AlmanacSqlDb, agentKey: string): Promise<string | null> {
  if (agentKey.startsWith('role:')) {
    const rows = await db.select<Array<{ id: string }>>('select id from agent_settings where role = $1', [agentKey.slice('role:'.length)])
    return rows[0]?.id ?? null
  }
  const canonical = await resolveAlias(db, AGENT_ALIAS_TABLE, agentKey)
  // 別名的記憶不寫：正式那位的記憶會自己合併，避免兩份蓋來蓋去。
  return canonical === agentKey ? agentKey : null
}

async function applyCrewChange(context: AlmanacTableContext, change: RowsTableChange<SyncValue>): Promise<void> {
  const { db } = context
  const entries = Object.entries(change.upserts).map(([key, value]) => ({ key, parsed: parseCrewKey(key), value }))
  // 夥伴先寫，記憶才找得到本機那位。
  for (const { parsed, value } of entries) {
    if (parsed.region === 'agent') await applyAgent(context, parsed.agentKey, value as AgentSyncValue)
  }
  for (const { parsed, value } of entries) {
    if (parsed.region === 'memory') {
      const agentId = await localAgentIdFor(db, parsed.agentKey)
      if (!agentId) continue
      const content = String((parsed.kind === 'work_notes' ? value.notes : value.content) ?? '')
      await db.execute(
        `insert into agent_memory (agent_id, kind, content, updated_at, updated_by) values ($1, $2, $3, $4, $5)
         on conflict(agent_id, kind) do update set content = excluded.content, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        [agentId, parsed.kind, content, Number(value.updatedAt ?? context.now()), String(value.updatedBy ?? 'scott')],
      )
    } else if (parsed.region === 'context') {
      await db.execute(
        `insert into shared_context (id, projects, weekly_focus, people, updated_at, updated_by) values (1, $1, $2, $3, $4, $5)
         on conflict(id) do update set projects = excluded.projects, weekly_focus = excluded.weekly_focus, people = excluded.people,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        [
          JSON.stringify(value.projects ?? []), JSON.stringify(value.weeklyFocus ?? []), JSON.stringify(value.people ?? []),
          Number(value.updatedAt ?? context.now()), String(value.updatedBy ?? 'commander'),
        ],
      )
    } else if (parsed.region === 'preferences') {
      await db.execute(
        `insert into scott_preferences (id, content, updated_at) values (1, $1, $2)
         on conflict(id) do update set content = excluded.content, updated_at = excluded.updated_at`,
        [String(value.content ?? ''), Number(value.updatedAt ?? context.now())],
      )
    }
  }
  for (const key of change.deletes) {
    const parsed = parseCrewKey(key)
    if (parsed.region === 'agent' && !parsed.agentKey.startsWith('role:')) {
      await db.execute('delete from agent_memory where agent_id = $1', [parsed.agentKey])
      await db.execute('delete from agent_settings where id = $1', [parsed.agentKey])
    } else if (parsed.region === 'memory') {
      const agentId = await localAgentIdFor(db, parsed.agentKey)
      if (agentId) await db.execute('delete from agent_memory where agent_id = $1 and kind = $2', [agentId, parsed.kind])
    }
  }
}

/** 確認卡的標題：哪一份文字、哪一位夥伴。 */
async function describeConflict(db: AlmanacSqlDb, key: string): Promise<{ subject: SyncConflictSubject; agentId: string | null; agentName: string | null } | null> {
  const parsed = parseCrewKey(key)
  if (parsed.region === 'preferences') return { subject: 'preferences', agentId: null, agentName: null }
  if (parsed.region !== 'memory' || parsed.kind === 'work_notes') return null
  const agentId = await localAgentIdFor(db, parsed.agentKey)
  const rows = agentId ? await db.select<Array<{ name: string }>>('select name from agent_settings where id = $1', [agentId]) : []
  return { subject: parsed.kind, agentId, agentName: rows[0]?.name ?? null }
}

export async function recordCrewConflicts(context: AlmanacTableContext, conflicts: FieldConflict[]): Promise<number> {
  let recorded = 0
  for (const conflict of conflicts) {
    const described = await describeConflict(context.db, conflict.key)
    if (!described) continue
    await recordSyncConflict(context.db, {
      tableName: CREW_SYNC_TABLE,
      syncKey: conflict.key,
      field: conflict.field,
      ...described,
      base: typeof conflict.base === 'string' ? conflict.base : '',
      local: String(conflict.local ?? ''),
      remote: String(conflict.remote ?? ''),
      hunks: conflict.hunks ?? [],
      now: context.now(),
    })
    recorded++
  }
  return recorded
}

export function expertTitle(value: Partial<AgentSyncValue>): string {
  return value.domain ? `${value.name ?? ''}（${value.domain}）` : String(value.name ?? '')
}

export function createCrewTable(deps: CrewTableDeps = {}): AlmanacRowsTable<SyncValue> {
  return {
    kind: 'rows',
    name: CREW_SYNC_TABLE,
    layer: 'account',
    storage: { type: 'file', path: 'crew.json' },
    rules: CREW_RULES,
    askOnRemoteDelete: true,
    isPristine: (key, row) => parseCrewKey(key).region === 'agent' && isPristineAgent(row.v),
    async read({ db }) {
      await deps.ensureSchema?.(db)
      return readCrew(db)
    },
    async apply(context, change) {
      await deps.ensureSchema?.(context.db)
      await applyCrewChange(context, change)
    },
    async onConflicts(context, conflicts) {
      if (await recordCrewConflicts(context, conflicts)) deps.onConflictsChanged?.()
    },
    async onPendingDeletes(context, pending) {
      let opened = false
      for (const item of pending) {
        const parsed = parseCrewKey(item.key)
        // 只有專家要問（單例角色不能刪）；記憶跟著專家，專家確認刪除時一起清。
        if (parsed.region !== 'agent' || parsed.agentKey.startsWith('role:')) continue
        // 兩台同名同領域的專家併成一位時，另一個 id 被收掉：不是 Scott 刪的，不必問。
        if (await resolveAlias(context.db, AGENT_ALIAS_TABLE, parsed.agentKey) !== parsed.agentKey) continue
        const memory = await context.db.select<MemoryRow[]>(
          'select agent_id as agentId, kind, content, updated_at as updatedAt, updated_by as updatedBy from agent_memory where agent_id = $1',
          [parsed.agentKey],
        )
        opened = await upsertPendingRecordDeletion(context.db, {
          tableName: CREW_SYNC_TABLE,
          syncKey: item.key,
          title: expertTitle(item.local.v as Partial<AgentSyncValue>),
          snapshot: { agent: item.local.v, memory },
          deletedAt: item.tombstone.deletedAt,
          deviceId: item.tombstone.deviceId,
          now: context.now(),
        }) || opened
      }
      if (opened) deps.onPendingChanged?.()
    },
  }
}

/**
 * Scott 拒絕別台的刪除（保留）：專家與他的記憶改記成「現在改過」，下一輪同步晚於墓碑，推回遠端、另一台也拿回來（同 84.8 拒絕＝保留並推回）。
 */
export async function keepCrewAgent(db: AlmanacSqlDb, agentId: string, now: number): Promise<void> {
  await db.execute('update agent_settings set updated_at = $1 where id = $2', [now, agentId])
  await db.execute('update agent_memory set updated_at = $1 where agent_id = $2', [now, agentId])
}

/** Scott 確認別台的刪除：本機刪專家與記憶（呼叫端先寫進最近刪除）。 */
export async function removeCrewAgent(db: AlmanacSqlDb, agentId: string): Promise<void> {
  await db.execute('delete from agent_memory where agent_id = $1', [agentId])
  await db.execute('delete from agent_settings where id = $1', [agentId])
}

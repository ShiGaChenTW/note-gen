// Fork（almanac ALMNC-54.3）：Agent 設定區的資料存取——個別記憶、共用工作記憶（目前脈絡、活動紀錄）、Scott 的偏好。
// 每個寫入都要帶 actor，先過 src/lib/agent-memory/permissions.ts 的判斷。活動紀錄只有新增和封存，沒有修改或刪除的函式。
import { getDb } from './index'
import {
  actorLabel, archiveCutoff, buildMemoryPrompt, decideActivityWrite, decideAgentMemoryWrite, decideContextWrite,
  decidePreferencesWrite, defaultRules, defaultSoul, EMPTY_CONTEXT, isActivityAction, parseStoredItems,
  parseStoredPeople, selectActivityToArchive, validateActivityEntry, validateSharedContext,
  type ActivityEntry, type ActivityEntryInput, type MemoryActor, type MemoryKind, type MemoryWriteDecision,
  type RulesChangeProposal, type SavedSharedContext, type SharedContext, type SoulTemplateAgent,
} from '@/lib/agent-memory'
import { AGENT_MEMORY_SCHEMA } from '@/lib/agent-memory/schema'

export const MEMORY_CONTENT_MAX = 20000

export interface MemoryAgent extends SoulTemplateAgent {
  id: string
}

export interface MemoryDoc {
  content: string
  updatedAt: number | null
  updatedBy: string | null
  /** 還沒存過，顯示的是範本。 */
  isTemplate: boolean
}

export interface AgentMemoryView {
  soul: MemoryDoc
  rules: MemoryDoc
  workNotes: MemoryDoc
}

export type MemoryWriteResult = { status: 'saved' } | { status: 'proposal', proposal: RulesChangeProposal }

let initialization: Promise<void> | undefined

async function memoryDb() {
  const db = await getDb()
  initialization ??= (async () => {
    for (const sql of AGENT_MEMORY_SCHEMA) await db.execute(sql)
  })().catch(error => {
    initialization = undefined
    throw error
  })
  await initialization
  return db
}

function assertAllowed(decision: MemoryWriteDecision): asserts decision is Exclude<MemoryWriteDecision, { decision: 'deny' }> {
  if (decision.decision === 'deny') throw new Error(decision.reason)
}

function assertLength(content: string, max = MEMORY_CONTENT_MAX) {
  if (typeof content !== 'string' || [...content].length > max) throw new Error('MEMORY_TOO_LONG')
}

interface MemoryRow { kind: MemoryKind, content: string, updatedAt: number, updatedBy: string }

function template(agent: MemoryAgent, kind: MemoryKind): string {
  if (kind === 'soul') return defaultSoul(agent)
  if (kind === 'rules') return defaultRules(agent)
  return ''
}

export async function getAgentMemory(agent: MemoryAgent): Promise<AgentMemoryView> {
  const db = await memoryDb()
  const rows = await db.select<MemoryRow[]>(
    'select kind, content, updated_at as updatedAt, updated_by as updatedBy from agent_memory where agent_id = $1',
    [agent.id],
  )
  const doc = (kind: MemoryKind): MemoryDoc => {
    const row = rows.find(item => item.kind === kind)
    return row
      ? { content: row.content, updatedAt: row.updatedAt, updatedBy: row.updatedBy, isTemplate: false }
      : { content: template(agent, kind), updatedAt: null, updatedBy: null, isTemplate: kind !== 'work_notes' }
  }
  return { soul: doc('soul'), rules: doc('rules'), workNotes: doc('work_notes') }
}

/**
 * 寫入個別記憶。soul 只有 Scott；rules 由 agent 發起時只回傳提案、不寫入；工作筆記限 agent 自己或 Scott。
 * 權限不符時丟出錯誤代碼（例如 SOUL_SCOTT_ONLY）。
 */
export async function writeAgentMemory(
  actor: MemoryActor,
  agent: MemoryAgent,
  kind: MemoryKind,
  content: string,
  now = Date.now(),
): Promise<MemoryWriteResult> {
  assertLength(content)
  const current = (await getAgentMemory(agent))[kind === 'work_notes' ? 'workNotes' : kind].content
  const decision = decideAgentMemoryWrite(actor, { agentId: agent.id, kind }, current, content)
  assertAllowed(decision)
  if (decision.decision === 'propose') return { status: 'proposal', proposal: decision.proposal }
  const db = await memoryDb()
  await db.execute(
    `insert into agent_memory (agent_id, kind, content, updated_at, updated_by) values ($1, $2, $3, $4, $5)
     on conflict(agent_id, kind) do update set content = excluded.content, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [agent.id, kind, content, now, actorLabel(actor)],
  )
  return { status: 'saved' }
}

interface ContextRow { projects: string, weeklyFocus: string, people: string, updatedAt: number, updatedBy: string }

export async function getSharedContext(): Promise<SavedSharedContext> {
  const db = await memoryDb()
  const [row] = await db.select<ContextRow[]>(
    `select projects, weekly_focus as weeklyFocus, people, updated_at as updatedAt, updated_by as updatedBy
     from shared_context where id = 1`,
  )
  if (!row) return { ...EMPTY_CONTEXT, updatedAt: null, updatedBy: null }
  return {
    projects: parseStoredItems(row.projects),
    weeklyFocus: parseStoredItems(row.weeklyFocus),
    people: parseStoredPeople(row.people),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

/** 目前脈絡只有指揮官和 Scott 能改；超過上限（專案 10、本週重點 5）丟出錯誤代碼。 */
export async function saveSharedContext(actor: MemoryActor, context: SharedContext, now = Date.now()): Promise<void> {
  assertAllowed(decideContextWrite(actor))
  const result = validateSharedContext(context)
  if (!result.ok) throw new Error(result.error)
  const db = await memoryDb()
  await db.execute(
    `insert into shared_context (id, projects, weekly_focus, people, updated_at, updated_by) values (1, $1, $2, $3, $4, $5)
     on conflict(id) do update set projects = excluded.projects, weekly_focus = excluded.weekly_focus,
       people = excluded.people, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [
      JSON.stringify(result.context.projects), JSON.stringify(result.context.weeklyFocus),
      JSON.stringify(result.context.people), now, actorLabel(actor),
    ],
  )
}

interface ActivityRow {
  id: number, at: number, actorId: string, actorRole: ActivityEntry['actorRole'], action: string, targetLink: string
  sourceKind: ActivityEntry['source']['kind'], sourceRef: string, note: string, correctsId: number | null, archivedAt: number | null
}

const SELECT_ACTIVITY = `select id, at, actor_id as actorId, actor_role as actorRole, action, target_link as targetLink,
  source_kind as sourceKind, source_ref as sourceRef, note, corrects_id as correctsId, archived_at as archivedAt
  from activity_log`

function activityFromRow(row: ActivityRow): ActivityEntry | undefined {
  if (!isActivityAction(row.action)) return undefined
  const { sourceKind, sourceRef, ...rest } = row
  return { ...rest, action: row.action, source: { kind: sourceKind, ref: sourceRef } }
}

/** 系統寫一筆活動紀錄，回傳新編號。時間由系統填。 */
export async function appendActivity(actor: MemoryActor, input: ActivityEntryInput, now = Date.now()): Promise<number> {
  assertAllowed(decideActivityWrite(actor))
  const result = validateActivityEntry(input)
  if (!result.ok) throw new Error(result.error)
  const entry = result.entry
  const db = await memoryDb()
  if (entry.correctsId !== null) {
    const [target] = await db.select<Array<{ id: number }>>('select id from activity_log where id = $1', [entry.correctsId])
    if (!target) throw new Error('CORRECTION_TARGET_NOT_FOUND')
  }
  const inserted = await db.execute(
    `insert into activity_log (at, actor_id, actor_role, action, target_link, source_kind, source_ref, note, corrects_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [now, entry.actorId, entry.actorRole, entry.action, entry.targetLink, entry.sourceKind, entry.sourceRef, entry.note, entry.correctsId],
  )
  if (typeof inserted.lastInsertId === 'number') return inserted.lastInsertId
  const [row] = await db.select<Array<{ id: number }>>('select max(id) as id from activity_log')
  return row.id
}

/** 把超過 90 天的紀錄標記封存（不刪除），回傳這次封存幾筆。 */
export async function archiveOldActivity(now = Date.now()): Promise<number> {
  const db = await memoryDb()
  const rows = await db.select<Array<{ id: number, at: number, archivedAt: number | null }>>(
    'select id, at, archived_at as archivedAt from activity_log where archived_at is null and at < $1',
    [archiveCutoff(now)],
  )
  const ids = selectActivityToArchive(rows, now)
  if (!ids.length) return 0
  await db.execute(
    `update activity_log set archived_at = $1 where id in (${ids.map((_, index) => `$${index + 2}`).join(', ')})`,
    [now, ...ids],
  )
  return ids.length
}

/** 最新的在前；預設不含已封存的紀錄。讀之前先封存過期的。 */
export async function listActivity(options: { limit?: number, includeArchived?: boolean, now?: number } = {}): Promise<ActivityEntry[]> {
  await archiveOldActivity(options.now)
  const db = await memoryDb()
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 50)))
  const rows = await db.select<ActivityRow[]>(
    `${SELECT_ACTIVITY} ${options.includeArchived ? '' : 'where archived_at is null'} order by at desc, id desc limit $1`,
    [limit],
  )
  return rows.flatMap(row => activityFromRow(row) ?? [])
}

export interface ScottPreferences {
  content: string
  updatedAt: number | null
}

export async function getScottPreferences(): Promise<ScottPreferences> {
  const db = await memoryDb()
  const [row] = await db.select<Array<{ content: string, updatedAt: number }>>(
    'select content, updated_at as updatedAt from scott_preferences where id = 1',
  )
  return row ?? { content: '', updatedAt: null }
}

/** Scott 的偏好：所有 agent 共讀，只有 Scott 能改。 */
export async function saveScottPreferences(actor: MemoryActor, content: string, now = Date.now()): Promise<void> {
  assertAllowed(decidePreferencesWrite(actor))
  assertLength(content)
  const db = await memoryDb()
  await db.execute(
    `insert into scott_preferences (id, content, updated_at) values (1, $1, $2)
     on conflict(id) do update set content = excluded.content, updated_at = excluded.updated_at`,
    [content, now],
  )
}

/** 給 runner 用：這個 agent 的 soul、rules、工作筆記，加上 Scott 的偏好和目前脈絡標題。 */
export async function loadAgentMemoryPrompt(agent: MemoryAgent): Promise<string> {
  const [memory, preferences, context] = await Promise.all([getAgentMemory(agent), getScottPreferences(), getSharedContext()])
  return buildMemoryPrompt({
    soul: memory.soul.content,
    rules: memory.rules.content,
    workNotes: memory.workNotes.content,
    scottPreferences: preferences.content,
    context,
  })
}

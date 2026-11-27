// Fork（almanac ALMNC-54.3）：Agent 設定區的資料存取——個別記憶、共用工作記憶（目前脈絡、活動紀錄）、Scott 的偏好。
// 每個寫入都要帶 actor，先過 src/lib/agent-memory/permissions.ts 的判斷。活動紀錄只有新增和封存，沒有修改或刪除的函式。
import { executeRecordTransaction, getDb } from './index'
import {
  actorLabel, archiveCutoff, CONTEXT_MAX_PROJECTS, CONTEXT_MAX_FOCUS, CONTEXT_MAX_PEOPLE, buildMemoryPrompt, decideActivityWrite, decideAgentMemoryWrite, decideContextWrite,
  decidePreferencesWrite, defaultRules, defaultSoul, EMPTY_CONTEXT, isActivityAction, parseStoredItems,
  parseStoredPeople, selectActivityToArchive, validateActivityEntry, validateSharedContext,
  type ActivityEntry, type ActivityEntryInput, type MemoryActor, type MemoryKind, type MemoryWriteDecision,
  type RulesChangeProposal, type SavedSharedContext, type SharedContext, type SoulTemplateAgent,
} from '@/lib/agent-memory'
import { ACTIVITY_OP_COLUMN, ACTIVITY_OP_TRIGGER, AGENT_MEMORY_SCHEMA, migrateActivityLog } from '@/lib/agent-memory/schema'
import { notifyAlmanacLocalChange } from '@/lib/almanac-sync/notify'

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
    // Fork（almanac ALMNC-69.9）：舊資料庫補 op_id 欄位。
    const columns = await db.select<Array<{ name: string }>>('pragma table_info(activity_log)')
    if (!columns.some(column => column.name === 'op_id')) await db.execute(ACTIVITY_OP_COLUMN)
    // Fork（almanac ALMNC-71）：舊表的角色／來源限制放寬成可寫系統修復（重建表，整段一個交易）。
    await migrateActivityLog(db, executeRecordTransaction)
    await db.execute(ACTIVITY_OP_TRIGGER)
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
  // Fork（almanac ALMNC-85.3）：夥伴記憶跟著 V3 同步（crew.json）；同步關著時不做事。
  notifyAlmanacLocalChange('agent-memory')
  return { status: 'saved' }
}

/** Append-only for agent-authored notes; retry when another window saved while we were reading. */
export async function appendAgentWorkNotes(actor: MemoryActor, agent: MemoryAgent, notes: string[]): Promise<void> {
  assertAllowed(decideAgentMemoryWrite(actor, { agentId: agent.id, kind: 'work_notes' }, '', ''))
  const db = await memoryDb()
  for (let attempt = 0; attempt < 5; attempt++) {
    const { workNotes } = await getAgentMemory(agent)
    const current = new Set(workNotes.content.split(/\r?\n/).map(line => line.trim().replace(/^[-*] +/, '')))
    const added = [...new Set(notes)].filter(note => !current.has(note)).map(note => `- ${note}`).join('\n')
    if (!added) return
    const content = [workNotes.content.trimEnd(), added].filter(Boolean).join('\n') + '\n'
    assertLength(content)
    const result = await db.execute(
      `insert into agent_memory (agent_id, kind, content, updated_at, updated_by) values ($1, 'work_notes', $2, $3, $4)
       on conflict(agent_id, kind) do update set content = excluded.content, updated_at = excluded.updated_at, updated_by = excluded.updated_by
       where agent_memory.content = $5 and $6 is not null`,
      [agent.id, content, Date.now(), actorLabel(actor), workNotes.content, workNotes.updatedAt],
    )
    if (result.rowsAffected) {
      notifyAlmanacLocalChange('agent-work-notes')
      return
    }
  }
  throw new Error('WORK_NOTES_CHANGED')
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
  notifyAlmanacLocalChange('shared-context')
}

/** 只補入新的脈絡，不覆蓋 Scott 在設定頁寫的標題、連結或清單順序。 */
export async function mergeSharedContext(actor: MemoryActor, additions: SharedContext): Promise<void> {
  assertAllowed(decideContextWrite(actor))
  const checked = validateSharedContext(additions)
  if (!checked.ok) throw new Error(checked.error)
  const db = await memoryDb()
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await getSharedContext()
    const append = (existing: SharedContext['projects'], next: SharedContext['projects'], max: number) => {
      const byTitle = new Map(existing.map(item => [item.title, item]))
      for (const item of next) if (!byTitle.has(item.title)) byTitle.set(item.title, item)
      return [...byTitle.values()].slice(0, max)
    }
    const projects = append(current.projects, checked.context.projects, CONTEXT_MAX_PROJECTS)
    const weeklyFocus = append(current.weeklyFocus, checked.context.weeklyFocus, CONTEXT_MAX_FOCUS)
    const people = [...new Set([...current.people, ...checked.context.people])].slice(0, CONTEXT_MAX_PEOPLE)
    if (JSON.stringify([projects, weeklyFocus, people]) === JSON.stringify([current.projects, current.weeklyFocus, current.people])) return
    const result = await db.execute(
      `insert into shared_context (id, projects, weekly_focus, people, updated_at, updated_by) values (1, $1, $2, $3, $4, $5)
       on conflict(id) do update set projects = excluded.projects, weekly_focus = excluded.weekly_focus, people = excluded.people,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by
       where shared_context.updated_at = $6 and shared_context.updated_by = $7`,
      [JSON.stringify(projects), JSON.stringify(weeklyFocus), JSON.stringify(people),
        Math.max(Date.now(), (current.updatedAt ?? 0) + 1), actorLabel(actor), current.updatedAt, current.updatedBy],
    )
    if (result.rowsAffected) {
      notifyAlmanacLocalChange('shared-context')
      return
    }
  }
  throw new Error('SHARED_CONTEXT_CHANGED')
}

interface ActivityRow {
  id: number, at: number, actorId: string, actorRole: ActivityEntry['actorRole'], action: string, targetLink: string
  sourceKind: ActivityEntry['source']['kind'], sourceRef: string, note: string, correctsId: number | null, archivedAt: number | null
  opId: string | null
  originDevice?: string | null
}

const SELECT_ACTIVITY = `select id, at, actor_id as actorId, actor_role as actorRole, action, target_link as targetLink,
  source_kind as sourceKind, source_ref as sourceRef, note, corrects_id as correctsId, archived_at as archivedAt, op_id as opId
  from activity_log`

function activityFromRow(row: ActivityRow): ActivityEntry | undefined {
  if (!isActivityAction(row.action)) return undefined
  const { sourceKind, sourceRef, originDevice, ...rest } = row
  return { ...rest, action: row.action, source: { kind: sourceKind, ref: sourceRef }, ...(originDevice ? { originDevice } : {}) }
}

/**
 * Fork（almanac ALMNC-85.3）：V3 同步開過（M1 補了欄位）才有的資訊——寫這筆的裝置、更正晚到時用 corrects_uid 找回被更正的那筆；
 * 發起者 id 是另一台的單例夥伴時，查別名表換成這台那位（actor_id 只能新增、不能改，設計 1.3）。
 */
async function withSyncInfo(db: Awaited<ReturnType<typeof memoryDb>>, rows: ActivityRow[]): Promise<ActivityRow[]> {
  if (!rows.length) return rows
  const columns = await db.select<Array<{ name: string }>>('pragma table_info(activity_log)')
  if (!columns.some(column => column.name === 'uid')) return rows
  const ids = rows.map(row => row.id)
  const extra = await db.select<Array<{ id: number, originDevice: string | null, correctsUid: string | null }>>(
    `select id, origin_device as originDevice, corrects_uid as correctsUid from activity_log where id in (${ids.map((_, index) => `$${index + 1}`).join(', ')})`,
    ids,
  )
  const byId = new Map(extra.map(row => [Number(row.id), row]))
  const aliases = new Map<string, string>()
  try {
    const aliasRows = await db.select<Array<{ aliasId: string, canonicalId: string }>>(
      "select alias_id as aliasId, canonical_id as canonicalId from almanac_sync_aliases where table_name = 'agents'",
    )
    for (const row of aliasRows) aliases.set(row.aliasId, row.canonicalId)
  } catch {
    // 沒開過 V3 同步：沒有別名表。
  }
  const result: ActivityRow[] = []
  for (const row of rows) {
    const info = byId.get(row.id)
    let correctsId = row.correctsId
    if (correctsId === null && info?.correctsUid) {
      const [target] = await db.select<Array<{ id: number }>>('select id from activity_log where uid = $1', [info.correctsUid])
      correctsId = target ? Number(target.id) : null
    }
    result.push({ ...row, actorId: aliases.get(row.actorId) ?? row.actorId, correctsId, originDevice: info?.originDevice ?? null })
  }
  return result
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
    `insert into activity_log (at, actor_id, actor_role, action, target_link, source_kind, source_ref, note, corrects_id, op_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [now, entry.actorId, entry.actorRole, entry.action, entry.targetLink, entry.sourceKind, entry.sourceRef, entry.note, entry.correctsId, entry.opId],
  )
  notifyAlmanacLocalChange('activity')
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

/**
 * 最新的在前；預設不含已封存的紀錄。讀之前先封存過期的。
 * Fork（almanac ALMNC-71）：actorId 只列這位發起者（'system'＝系統修復），篩選在資料庫做，不只篩已載入的幾筆。
 */
export async function listActivity(options: { limit?: number, includeArchived?: boolean, now?: number, actorId?: string } = {}): Promise<ActivityEntry[]> {
  await archiveOldActivity(options.now)
  const db = await memoryDb()
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 50)))
  const where = [options.includeArchived ? '' : 'archived_at is null', options.actorId ? 'actor_id = $2' : ''].filter(Boolean)
  const rows = await db.select<ActivityRow[]>(
    `${SELECT_ACTIVITY} ${where.length ? `where ${where.join(' and ')}` : ''} order by at desc, id desc limit $1`,
    options.actorId ? [limit, options.actorId] : [limit],
  )
  return (await withSyncInfo(db, rows)).flatMap(row => activityFromRow(row) ?? [])
}

/** Fork（almanac ALMNC-71）：還沒封存的紀錄裡出現過的發起者（最近有紀錄的在前），給設定頁的篩選選單用。 */
export async function listActivityActors(): Promise<Array<Pick<ActivityEntry, 'actorId' | 'actorRole'>>> {
  const db = await memoryDb()
  return db.select<Array<Pick<ActivityEntry, 'actorId' | 'actorRole'>>>(
    `select actor_id as actorId, actor_role as actorRole from activity_log where archived_at is null
     group by actor_id order by max(at) desc, max(id) desc`,
  )
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
  notifyAlmanacLocalChange('scott-preferences')
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

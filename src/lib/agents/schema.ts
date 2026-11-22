import { planLegacyRoleMigration, type LegacyAgentRow } from './settings'

// Fork（almanac ALMNC-54.2）：角色改成 commander／expert／secretary／researcher，加上專家的 domain 欄位。
function AGENT_SETTINGS_TABLE_SQL(table: string) {
  return `create table if not exists ${table} (
    id text primary key not null,
    name text not null check (length(trim(name)) between 1 and 80),
    role text not null check (role in ('commander', 'expert', 'secretary', 'researcher')),
    domain text,
    enabled integer not null check (enabled in (0, 1)),
    allowed_tools text not null,
    created_at integer not null,
    updated_at integer not null
  )`
}

// Additive, idempotent schema for note.db, following the existing agent_tasks bootstrap.
export const AGENT_SCHEMA = [
  AGENT_SETTINGS_TABLE_SQL('agent_settings'),
  `create table if not exists agent_tool_refusals (
    id integer primary key,
    agent_id text not null,
    task_id text not null,
    tool_name text not null,
    reason text not null check (reason in ('disabled', 'not_granted', 'unavailable')),
    created_at integer not null
  )`,
  'create index if not exists idx_agent_tool_refusals_task on agent_tool_refusals(task_id, id)',
]

// Run offline after a backup, immediately before downgrading to a build without P5.
// substr() instead of LIKE: LIKE is case-insensitive in SQLite and would also match e.g. 'AGENT:legacy'.
export const AGENT_SCHEMA_ROLLBACK = [
  "delete from agent_tasks where substr(kind, 1, 6) = 'agent:'",
  'drop table if exists agent_tool_refusals',
  'drop table if exists agent_settings',
]

export const AGENT_PENDING_REVIEW_SQL =
  "select count(*) as count from agent_tasks where substr(kind, 1, 6) = 'agent:' and status = 'awaiting_review'"

export interface RollbackDb {
  select: <T>(sql: string) => Promise<T>
  execute: (sql: string) => Promise<unknown>
}

/**
 * Removes P5 data in one transaction (review finding: the rollback used to exist only as SQL in the README).
 * Refuses while agent drafts still wait for review, unless `discardPendingReview` is set, because deleting
 * them is irreversible. Back up note.db before calling this.
 */
export async function rollbackAgentSchema(db: RollbackDb, options: { discardPendingReview?: boolean } = {}): Promise<void> {
  const rows = await db.select<Array<{ count: number }>>(AGENT_PENDING_REVIEW_SQL)
  const pending = Number(rows[0]?.count ?? 0)
  if (pending > 0 && !options.discardPendingReview) {
    throw new Error(`AGENT_ROLLBACK_PENDING_REVIEW: ${pending} agent draft task(s) still await review`)
  }
  await db.execute('begin')
  try {
    for (const statement of AGENT_SCHEMA_ROLLBACK) await db.execute(statement)
    await db.execute('commit')
  } catch (error) {
    await db.execute('rollback')
    throw error
  }
}

export interface RoleMigrationStatement { sql: string, values: (string | number | null)[] }
export interface RoleMigrationDb {
  select: <T>(sql: string) => Promise<T>
}

/** 舊版資料表的 role 限制還是五個舊角色時，才需要重建。 */
export function needsRoleRebuild(tableSql: string | undefined): boolean {
  return !!tableSql && tableSql.includes("'organizer'")
}

/**
 * Fork（almanac ALMNC-54.2）：把 ALMNC-12 的舊角色資料表升級成四個角色。
 * SQLite 不能改 check 限制，只能新建資料表、複製、刪舊、改名；整段交給 runTransaction 一次做完，失敗就整批還原。
 * id（固定編號）、本名、工具、建立時間都保留，所以過去的任務（kind = agent:<id>）不受影響。
 */
export async function migrateAgentRoles(
  db: RoleMigrationDb,
  runTransaction: (statements: RoleMigrationStatement[]) => Promise<void>,
): Promise<boolean> {
  const [table] = await db.select<Array<{ sql: string }>>("select sql from sqlite_master where type = 'table' and name = 'agent_settings'")
  if (!needsRoleRebuild(table?.sql)) return false
  const rows = await db.select<LegacyAgentRow[]>('select id, role, enabled, created_at as createdAt from agent_settings')
  const plan = planLegacyRoleMigration(rows)
  await runTransaction([
    { sql: 'drop table if exists agent_settings_v2', values: [] },
    { sql: AGENT_SETTINGS_TABLE_SQL('agent_settings_v2'), values: [] },
    {
      sql: `insert into agent_settings_v2 (id, name, role, domain, enabled, allowed_tools, created_at, updated_at)
        select id, name, 'expert', null, enabled, allowed_tools, created_at, updated_at from agent_settings`,
      values: [],
    },
    ...plan.map(row => ({
      sql: 'update agent_settings_v2 set role = $1, domain = $2, enabled = $3 where id = $4',
      values: [row.role, row.domain, row.enabled, row.id],
    })),
    { sql: 'drop table agent_settings', values: [] },
    { sql: 'alter table agent_settings_v2 rename to agent_settings', values: [] },
  ])
  return true
}

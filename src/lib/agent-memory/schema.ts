// Fork（almanac ALMNC-54.3）：Agent 設定區的資料表，存在 note.db（系統內部，不放進筆記庫）。
// 和 agent_settings 一樣用 create table if not exists，可以重複執行。

/**
 * activity_log 的建表語法。Fork（almanac ALMNC-71）：actor_role 加 'system'、source_kind 加 'system'（系統修復），
 * op_id（ALMNC-69.9）直接放進表裡；舊資料庫靠 ACTIVITY_OP_COLUMN 補欄位、migrateActivityLog 放寬限制。
 * corrects_id 指向自己這張表：重建時先用 activity_log_v2 的名字建，改名時 SQLite 會一起改掉這個參照。
 */
export const ACTIVITY_LOG_TABLE_SQL = (name: string) => `create table if not exists ${name} (
    id integer primary key,
    at integer not null,
    actor_id text not null check (length(trim(actor_id)) > 0),
    actor_role text not null check (actor_role in ('scott', 'commander', 'expert', 'secretary', 'researcher', 'system')),
    action text not null,
    target_link text not null check (length(trim(target_link)) > 0),
    source_kind text not null check (source_kind in ('conversation', 'proposal', 'system')),
    source_ref text not null check (length(trim(source_ref)) > 0),
    note text not null default '' check (length(note) <= 60),
    corrects_id integer references ${name}(id),
    archived_at integer,
    op_id text default null
  )`

/** activity_log 的索引與「只能新增」觸發器（表重建後要重新建立）。 */
const ACTIVITY_LOG_EXTRAS = [
  'create index if not exists idx_activity_log_at on activity_log(at desc, id desc)',
  // 只能新增：不准刪除；更新只允許「把還沒封存的紀錄標記封存」，其他欄位一律不能動。
  `create trigger if not exists activity_log_no_delete before delete on activity_log
    begin select raise(abort, 'ACTIVITY_LOG_APPEND_ONLY'); end`,
  `create trigger if not exists activity_log_archive_only before update on activity_log
    when old.archived_at is not null or new.archived_at is null
      or new.id is not old.id or new.at is not old.at or new.actor_id is not old.actor_id
      or new.actor_role is not old.actor_role or new.action is not old.action
      or new.target_link is not old.target_link or new.source_kind is not old.source_kind
      or new.source_ref is not old.source_ref or new.note is not old.note
      or new.corrects_id is not old.corrects_id
    begin select raise(abort, 'ACTIVITY_LOG_APPEND_ONLY'); end`,
]

export const AGENT_MEMORY_SCHEMA = [
  `create table if not exists agent_memory (
    agent_id text not null,
    kind text not null check (kind in ('soul', 'rules', 'work_notes')),
    content text not null,
    updated_at integer not null,
    updated_by text not null,
    primary key (agent_id, kind)
  )`,
  `create table if not exists shared_context (
    id integer primary key check (id = 1),
    projects text not null default '[]',
    weekly_focus text not null default '[]',
    people text not null default '[]',
    updated_at integer not null,
    updated_by text not null
  )`,
  ACTIVITY_LOG_TABLE_SQL('activity_log'),
  ...ACTIVITY_LOG_EXTRAS,
  `create table if not exists scott_preferences (
    id integer primary key check (id = 1),
    content text not null,
    updated_at integer not null
  )`,
]

/**
 * Fork（almanac ALMNC-69.9）：activity_log 補 op_id（對應 ops 表的操作）。舊資料庫啟動時補欄位（預設 null），
 * 補完再加觸發器：op_id 寫入後不能改（只能新增的規則延伸到新欄位）。
 */
export const ACTIVITY_OP_COLUMN = 'alter table activity_log add column op_id text default null'
export const ACTIVITY_OP_TRIGGER = `create trigger if not exists activity_log_op_fixed before update on activity_log
  when new.op_id is not old.op_id
  begin select raise(abort, 'ACTIVITY_LOG_APPEND_ONLY'); end`

export interface ActivityMigrationStatement { sql: string, values: (string | number | null)[], expectedRows?: number }
export interface ActivityMigrationDb {
  select: <T>(sql: string) => Promise<T>
}

const ACTIVITY_COLUMNS = 'id, at, actor_id, actor_role, action, target_link, source_kind, source_ref, note, corrects_id, archived_at, op_id'

/** 舊表的 source_kind 限制還沒有 'system'（ALMNC-71 之前建的）才需要重建。 */
export function needsActivityRebuild(tableSql: string | undefined): boolean {
  if (!tableSql) return false
  const sourceCheck = /source_kind\s+text[^,]*check\s*\(([^)]*)\)/i.exec(tableSql)?.[1] ?? ''
  const roleCheck = /actor_role\s+text[^,]*check\s*\(([^)]*)\)/i.exec(tableSql)?.[1] ?? ''
  return !sourceCheck.includes("'system'") || !roleCheck.includes("'system'")
}

/**
 * Fork（almanac ALMNC-71）：放寬舊 activity_log 的 check 限制（角色與來源加 'system'）。
 * SQLite 不能改 check 限制，照 agents/schema.ts migrateAgentRoles 的做法：新建表 → 整批複製（筆數要相符）→ 刪舊 → 改名
 * → 重建索引與觸發器，整段交給 runTransaction 一次做完，失敗就整批還原。編號、時間與所有欄位原樣保留（更正的 corrects_id 仍指向同一筆）。
 * 刪舊表不會觸發 activity_log_no_delete（SQLite 的 drop table 不跑觸發器）。只在舊限制時執行，所以可以重複呼叫。
 */
export async function migrateActivityLog(
  db: ActivityMigrationDb,
  runTransaction: (statements: ActivityMigrationStatement[]) => Promise<void>,
): Promise<boolean> {
  const [table] = await db.select<Array<{ sql: string }>>("select sql from sqlite_master where type = 'table' and name = 'activity_log'")
  if (!needsActivityRebuild(table?.sql)) return false
  const columns = await db.select<Array<{ name: string }>>('pragma table_info(activity_log)')
  const source = columns.some(column => column.name === 'op_id') ? ACTIVITY_COLUMNS : ACTIVITY_COLUMNS.replace(/op_id$/, 'null')
  const [{ count }] = await db.select<Array<{ count: number }>>('select count(*) as count from activity_log')
  await runTransaction([
    { sql: 'drop table if exists activity_log_v2', values: [] },
    { sql: ACTIVITY_LOG_TABLE_SQL('activity_log_v2'), values: [] },
    { sql: `insert into activity_log_v2 (${ACTIVITY_COLUMNS}) select ${source} from activity_log order by id`, values: [], expectedRows: Number(count) },
    { sql: 'drop table activity_log', values: [] },
    { sql: 'alter table activity_log_v2 rename to activity_log', values: [] },
    ...ACTIVITY_LOG_EXTRAS.map(sql => ({ sql, values: [] })),
    { sql: ACTIVITY_OP_TRIGGER, values: [] },
  ])
  return true
}

// Fork（almanac ALMNC-54.3）：Agent 設定區的資料表，存在 note.db（系統內部，不放進筆記庫）。
// 和 agent_settings 一樣用 create table if not exists，可以重複執行。
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
  `create table if not exists activity_log (
    id integer primary key,
    at integer not null,
    actor_id text not null check (length(trim(actor_id)) > 0),
    actor_role text not null check (actor_role in ('scott', 'commander', 'expert', 'secretary', 'researcher')),
    action text not null,
    target_link text not null check (length(trim(target_link)) > 0),
    source_kind text not null check (source_kind in ('conversation', 'proposal')),
    source_ref text not null check (length(trim(source_ref)) > 0),
    note text not null default '' check (length(note) <= 60),
    corrects_id integer references activity_log(id),
    archived_at integer
  )`,
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
  `create table if not exists scott_preferences (
    id integer primary key check (id = 1),
    content text not null,
    updated_at integer not null
  )`,
]

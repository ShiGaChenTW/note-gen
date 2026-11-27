// Fork（almanac ALMNC-85.3）：要 Scott 挑的同步衝突（設計 1.7 第 1 種、第 8 節 3A）。
// 只有 Scott 能改的文字（Scott 的偏好、soul.md、rules.md）兩台都改了同一段：同步照常進行、這台的版本先留著，
// 另一台的版本存在這張表（almanac_sync_conflicts），工作台出一張確認卡讓 Scott 挑：用這台的、用另一台的、自己合併。
// 純加法的新表，舊版 App 忽略。
import { mergeTextLines, type TextMergeConflict } from '../text-merge'
import type { AlmanacSqlDb } from '../sql'

export type SyncConflictStatus = 'open' | 'resolved'
/** 卡片標題用：哪一份文字。 */
export type SyncConflictSubject = 'preferences' | 'soul' | 'rules'

export interface SyncConflict {
  tableName: string
  syncKey: string
  field: string
  subject: SyncConflictSubject
  /** 夥伴名稱（soul、rules 才有） */
  agentName: string | null
  /** 本機那位夥伴的 id（寫回時用；偏好是 null） */
  agentId: string | null
  base: string
  /** 這台改的（合併前） */
  local: string
  /** 另一台改的（合併前） */
  remote: string
  /** 同步後留下的版本：衝突段用這台的，其他段兩邊的修改都在 */
  keptLocal: string
  /** 衝突段改用另一台的版本，其他段一樣 */
  takeRemote: string
  hunks: TextMergeConflict[]
  status: SyncConflictStatus
  createdAt: number
  resolvedAt: number | null
}

interface Row {
  tableName: string
  syncKey: string
  field: string
  subject: SyncConflictSubject
  agentName: string | null
  agentId: string | null
  base: string
  local: string
  remote: string
  keptLocal: string
  takeRemote: string
  hunks: string
  status: SyncConflictStatus
  createdAt: number
  resolvedAt: number | null
}

const initialized = new WeakMap<AlmanacSqlDb, Promise<void>>()

export function initSyncConflicts(db: AlmanacSqlDb): Promise<void> {
  let ready = initialized.get(db)
  if (!ready) {
    ready = db.execute(`
      create table if not exists almanac_sync_conflicts (
        table_name text not null,
        sync_key text not null,
        field text not null,
        subject text not null,
        agent_name text,
        agent_id text,
        base text not null default '',
        local text not null default '',
        remote text not null default '',
        kept_local text not null default '',
        take_remote text not null default '',
        hunks text not null default '[]',
        status text not null default 'open',
        created_at integer not null,
        resolved_at integer,
        primary key (table_name, sync_key, field)
      )
    `).then(() => undefined).catch(error => {
      initialized.delete(db)
      throw error
    })
    initialized.set(db, ready)
  }
  return ready
}

const SELECT = `select table_name as tableName, sync_key as syncKey, field, subject, agent_name as agentName, agent_id as agentId,
  base, local, remote, kept_local as keptLocal, take_remote as takeRemote, hunks, status, created_at as createdAt, resolved_at as resolvedAt
  from almanac_sync_conflicts`

function fromRow(row: Row): SyncConflict {
  let hunks: TextMergeConflict[] = []
  try {
    hunks = JSON.parse(row.hunks) as TextMergeConflict[]
  } catch {
    hunks = []
  }
  return {
    ...row,
    hunks,
    createdAt: Number(row.createdAt),
    resolvedAt: row.resolvedAt === null || row.resolvedAt === undefined ? null : Number(row.resolvedAt),
  }
}

export interface RecordConflictInput {
  tableName: string
  syncKey: string
  field: string
  subject: SyncConflictSubject
  agentName?: string | null
  agentId?: string | null
  base: string
  local: string
  remote: string
  hunks: TextMergeConflict[]
  now: number
}

/** 純函式：合併後兩種選法的全文（衝突段用這台的／用另一台的，其他段兩邊的修改都留）。 */
export function conflictChoices(base: string, local: string, remote: string): { keptLocal: string; takeRemote: string } {
  return { keptLocal: mergeTextLines(base, local, remote).text, takeRemote: mergeTextLines(base, remote, local).text }
}

/** 記一張衝突卡；同一份文字已有一張還沒處理的，就換成最新的兩版（另一台又改了）。 */
export async function recordSyncConflict(db: AlmanacSqlDb, input: RecordConflictInput): Promise<void> {
  await initSyncConflicts(db)
  const { keptLocal, takeRemote } = conflictChoices(input.base, input.local, input.remote)
  await db.execute(
    `insert into almanac_sync_conflicts (table_name, sync_key, field, subject, agent_name, agent_id, base, local, remote, kept_local,
       take_remote, hunks, status, created_at, resolved_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'open', $13, null)
     on conflict(table_name, sync_key, field) do update set subject = excluded.subject, agent_name = excluded.agent_name,
       agent_id = excluded.agent_id, base = excluded.base, local = excluded.local, remote = excluded.remote,
       kept_local = excluded.kept_local, take_remote = excluded.take_remote, hunks = excluded.hunks, status = 'open',
       created_at = excluded.created_at, resolved_at = null`,
    [
      input.tableName, input.syncKey, input.field, input.subject, input.agentName ?? null, input.agentId ?? null,
      input.base, input.local, input.remote, keptLocal, takeRemote, JSON.stringify(input.hunks), input.now,
    ],
  )
}

export async function listSyncConflicts(db: AlmanacSqlDb, status: SyncConflictStatus | 'all' = 'open'): Promise<SyncConflict[]> {
  await initSyncConflicts(db)
  const rows = status === 'all'
    ? await db.select<Row[]>(`${SELECT} order by created_at desc`)
    : await db.select<Row[]>(`${SELECT} where status = $1 order by created_at desc`, [status])
  return rows.map(fromRow)
}

export async function getSyncConflict(db: AlmanacSqlDb, tableName: string, syncKey: string, field: string): Promise<SyncConflict | null> {
  await initSyncConflicts(db)
  const rows = await db.select<Row[]>(`${SELECT} where table_name = $1 and sync_key = $2 and field = $3`, [tableName, syncKey, field])
  return rows[0] ? fromRow(rows[0]) : null
}

export async function markSyncConflictResolved(db: AlmanacSqlDb, tableName: string, syncKey: string, field: string, now: number): Promise<void> {
  await initSyncConflicts(db)
  await db.execute(
    "update almanac_sync_conflicts set status = 'resolved', resolved_at = $1 where table_name = $2 and sync_key = $3 and field = $4",
    [now, tableName, syncKey, field],
  )
}

export type ConflictChoice = { kind: 'local' } | { kind: 'remote' } | { kind: 'merged'; text: string }

/**
 * 純函式：Scott 挑完之後要寫回的全文。current＝本機現在的內容（卡片出來之後可能又改過）。
 * - 用這台的：不動（null）。
 * - 用另一台的：把「衝突段改用另一台」這個差異套在現在的內容上（現在的內容沒再改過就等於 takeRemote）。
 * - 自己合併：直接用 Scott 寫的。
 */
export function resolvedText(conflict: Pick<SyncConflict, 'keptLocal' | 'takeRemote'>, current: string, choice: ConflictChoice): string | null {
  if (choice.kind === 'local') return null
  if (choice.kind === 'merged') return choice.text
  return mergeTextLines(conflict.keptLocal, current, conflict.takeRemote).text
}

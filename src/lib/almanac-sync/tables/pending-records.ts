// Fork（almanac ALMNC-85.2）：別台刪掉、要先問 Scott 的資料庫列（設計第 8 節 2A：RSS 訂閱、夥伴）。
// 設計第 3 節原本建議塞進 84.8 的 pending_sync_deletions（kind 加 record，M6 要重建表的 check 限制）。
// 這裡改用一張新表（純加法、舊版忽略、降版不必清資料），畫面仍併進 84.8 的待確認清單（多一個「設定與夥伴」分組）。
// 規則跟 84.8 一樣：Scott 拒絕或確認過、而遠端墓碑沒有更新時，不再重新出現。
import type { AlmanacSqlDb } from '../sql'

export type PendingRecordStatus = 'pending' | 'confirmed' | 'rejected'

export interface PendingRecordDeletion {
  tableName: string
  syncKey: string
  title: string
  /** 本機那一列的內容快照（確認時寫進最近刪除） */
  snapshot: unknown
  deletedAt: number
  deviceId: string
  status: PendingRecordStatus
  resolvedAt: number | null
  createdAt: number
}

interface Row {
  tableName: string
  syncKey: string
  title: string
  snapshot: string | null
  deletedAt: number
  deviceId: string
  status: PendingRecordStatus
  resolvedAt: number | null
  createdAt: number
}

const initialized = new WeakMap<AlmanacSqlDb, Promise<void>>()

export function initPendingRecordDeletions(db: AlmanacSqlDb): Promise<void> {
  let ready = initialized.get(db)
  if (!ready) {
    ready = db.execute(`
      create table if not exists almanac_pending_record_deletions (
        table_name text not null,
        sync_key text not null,
        title text not null,
        snapshot text,
        deleted_at integer not null,
        device_id text not null default '',
        status text not null default 'pending',
        resolved_at integer,
        created_at integer not null,
        primary key (table_name, sync_key)
      )
    `).then(() => undefined).catch(error => {
      initialized.delete(db)
      throw error
    })
    initialized.set(db, ready)
  }
  return ready
}

const SELECT = `select table_name as tableName, sync_key as syncKey, title, snapshot, deleted_at as deletedAt, device_id as deviceId,
  status, resolved_at as resolvedAt, created_at as createdAt from almanac_pending_record_deletions`

function fromRow(row: Row): PendingRecordDeletion {
  let snapshot: unknown = null
  try {
    snapshot = row.snapshot ? JSON.parse(row.snapshot) : null
  } catch {
    snapshot = null
  }
  return {
    tableName: row.tableName,
    syncKey: row.syncKey,
    title: row.title,
    snapshot,
    deletedAt: Number(row.deletedAt),
    deviceId: row.deviceId,
    status: row.status,
    resolvedAt: row.resolvedAt === null || row.resolvedAt === undefined ? null : Number(row.resolvedAt),
    createdAt: Number(row.createdAt),
  }
}

export async function getPendingRecordDeletion(db: AlmanacSqlDb, tableName: string, syncKey: string): Promise<PendingRecordDeletion | null> {
  await initPendingRecordDeletions(db)
  const rows = await db.select<Row[]>(`${SELECT} where table_name = $1 and sync_key = $2`, [tableName, syncKey])
  return rows[0] ? fromRow(rows[0]) : null
}

/** 回傳 true＝新出現或重新打開（畫面要提示）。 */
export async function upsertPendingRecordDeletion(
  db: AlmanacSqlDb,
  input: { tableName: string; syncKey: string; title: string; snapshot: unknown; deletedAt: number; deviceId: string; now: number },
): Promise<boolean> {
  const existing = await getPendingRecordDeletion(db, input.tableName, input.syncKey)
  if (existing && existing.status !== 'pending' && input.deletedAt <= existing.deletedAt) return false
  if (existing?.status === 'pending' && existing.deletedAt >= input.deletedAt && existing.title === input.title) return false
  await db.execute(
    `insert into almanac_pending_record_deletions (table_name, sync_key, title, snapshot, deleted_at, device_id, status, resolved_at, created_at)
     values ($1, $2, $3, $4, $5, $6, 'pending', null, $7)
     on conflict(table_name, sync_key) do update set title = excluded.title, snapshot = excluded.snapshot,
       deleted_at = max(almanac_pending_record_deletions.deleted_at, excluded.deleted_at), device_id = excluded.device_id,
       status = 'pending', resolved_at = null`,
    [input.tableName, input.syncKey, input.title, JSON.stringify(input.snapshot ?? null), input.deletedAt, input.deviceId, input.now],
  )
  return existing?.status !== 'pending'
}

export async function listPendingRecordDeletions(db: AlmanacSqlDb, status: PendingRecordStatus | 'all' = 'pending'): Promise<PendingRecordDeletion[]> {
  await initPendingRecordDeletions(db)
  const rows = status === 'all'
    ? await db.select<Row[]>(`${SELECT} order by deleted_at desc`)
    : await db.select<Row[]>(`${SELECT} where status = $1 order by deleted_at desc`, [status])
  return rows.map(fromRow)
}

export async function markPendingRecordDeletion(
  db: AlmanacSqlDb,
  tableName: string,
  syncKey: string,
  status: Exclude<PendingRecordStatus, 'pending'>,
  now: number,
): Promise<void> {
  await initPendingRecordDeletions(db)
  await db.execute(
    'update almanac_pending_record_deletions set status = $1, resolved_at = $2 where table_name = $3 and sync_key = $4',
    [status, now, tableName, syncKey],
  )
}

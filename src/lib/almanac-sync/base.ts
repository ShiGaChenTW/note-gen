// Fork（almanac ALMNC-85.2 骨架）：同步基準（almanac_sync_base）與每檔狀態（almanac_sync_state）。
// 基準＝「上次同步時兩邊一致的版本」，每欄存雜湊；E 型欄位另存整份文字（doc）。
// 基準只在「上傳成功」或「合併後寫回成功」時更新（設計 1.4）。
import type { RowBase } from './merge'
import { initAlmanacSyncTables, type AlmanacSqlDb, type SqlValue } from './sql'

const WRITE_CHUNK = 100

interface BaseRow {
  syncKey: string
  fieldHashes: string
  doc: string | null
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export async function loadBases(db: AlmanacSqlDb, scope: string, table: string, keys?: string[]): Promise<Record<string, RowBase>> {
  await initAlmanacSyncTables(db)
  const rows = await db.select<BaseRow[]>(
    'select sync_key as syncKey, field_hashes as fieldHashes, doc from almanac_sync_base where scope = $1 and table_name = $2',
    [scope, table],
  )
  const wanted = keys ? new Set(keys) : null
  const bases: Record<string, RowBase> = {}
  for (const row of rows) {
    if (wanted && !wanted.has(row.syncKey)) continue
    bases[row.syncKey] = { hashes: parseJson(row.fieldHashes, {}), doc: parseJson<Record<string, string> | null>(row.doc, null) }
  }
  return bases
}

export async function saveBases(
  db: AlmanacSqlDb,
  scope: string,
  table: string,
  upserts: Record<string, RowBase>,
  removals: string[],
  now: number,
): Promise<void> {
  await initAlmanacSyncTables(db)
  const entries = Object.entries(upserts)
  for (let start = 0; start < entries.length; start += WRITE_CHUNK) {
    const chunk = entries.slice(start, start + WRITE_CHUNK)
    const values: SqlValue[] = []
    const placeholders = chunk.map(([key, base], index) => {
      values.push(scope, table, key, JSON.stringify(base.hashes), base.doc ? JSON.stringify(base.doc) : null, now)
      const offset = index * 6
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`
    })
    await db.execute(
      `insert into almanac_sync_base (scope, table_name, sync_key, field_hashes, doc, synced_at) values ${placeholders.join(', ')}
       on conflict(scope, table_name, sync_key) do update set field_hashes = excluded.field_hashes, doc = excluded.doc, synced_at = excluded.synced_at`,
      values,
    )
  }
  for (let start = 0; start < removals.length; start += WRITE_CHUNK) {
    const chunk = removals.slice(start, start + WRITE_CHUNK)
    await db.execute(
      `delete from almanac_sync_base where scope = $1 and table_name = $2 and sync_key in (${chunk.map((_, index) => `$${index + 3}`).join(', ')})`,
      [scope, table, ...chunk],
    )
  }
}

export interface FileSyncState {
  hash: string
  version: string | null
}

export async function getFileState(db: AlmanacSqlDb, scope: string, path: string): Promise<FileSyncState | null> {
  await initAlmanacSyncTables(db)
  const rows = await db.select<Array<{ hash: string; version: string | null }>>(
    'select hash, version from almanac_sync_state where scope = $1 and path = $2',
    [scope, path],
  )
  return rows[0] ?? null
}

export async function setFileState(db: AlmanacSqlDb, scope: string, path: string, state: FileSyncState, now: number): Promise<void> {
  await initAlmanacSyncTables(db)
  await db.execute(
    `insert into almanac_sync_state (scope, path, hash, version, synced_at) values ($1, $2, $3, $4, $5)
     on conflict(scope, path) do update set hash = excluded.hash, version = excluded.version, synced_at = excluded.synced_at`,
    [scope, path, state.hash, state.version, now],
  )
}

/** 清掉一個範圍的基準與狀態：下次同步就重新做一次首次合併（關掉再開 V3 同步、換遠端時用）。 */
export async function resetSyncScope(db: AlmanacSqlDb, scope: string): Promise<void> {
  await initAlmanacSyncTables(db)
  await db.execute('delete from almanac_sync_base where scope = $1', [scope])
  await db.execute('delete from almanac_sync_state where scope = $1', [scope])
}

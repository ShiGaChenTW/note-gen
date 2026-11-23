// Fork（almanac ALMNC-69.1）：系統索引 id_index（note.db）。編號 ↔ 種類、上次路徑與檔名；MOC 名稱 ↔ M 編號。
// 新表，用 create table if not exists 建立（和其他 V3 表同一套延遲初始化），對舊資料庫安全、可重跑。
// 薄薄的 SQL 包裝，驗證在 src/lib/v3-model/id-index.ts。
import { getDb } from './index'
import { idIndexEntryFromRow, idIndexValues, lastNameOf, movedIndexPaths, type IdIndexEntry, type IdIndexRow, type RecordIdInput } from '@/lib/v3-model/id-index'

const COLUMNS = 'id, kind, path, last_name as lastName, name, created_at as createdAt, updated_at as updatedAt'

let initialized: Promise<void> | null = null

export function initIdIndexDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists id_index (
          id text primary key,
          kind text not null,
          path text,
          last_name text,
          name text,
          created_at integer not null,
          updated_at integer not null
        )
      `)
      await db.execute('create index if not exists idx_id_index_path on id_index(path)')
      await db.execute('create index if not exists idx_id_index_kind_name on id_index(kind, name)')
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

export async function idExists(id: string): Promise<boolean> {
  await initIdIndexDb()
  const db = await getDb()
  const rows = await db.select<Array<{ id: string }>>('select id from id_index where id = $1 limit 1', [id])
  return rows.length > 0
}

/** 登記編號；已登記就更新路徑、檔名與名稱（建立時間不變）。 */
export async function recordId(input: RecordIdInput, now = Date.now()): Promise<IdIndexEntry> {
  const entry = idIndexValues(input, now)
  await initIdIndexDb()
  const db = await getDb()
  await db.execute(
    `insert into id_index (id, kind, path, last_name, name, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict(id) do update set path = excluded.path, last_name = excluded.last_name, name = excluded.name, updated_at = excluded.updated_at`,
    [entry.id, entry.kind, entry.path ?? null, entry.lastName ?? null, entry.name ?? null, entry.createdAt, entry.updatedAt]
  )
  return entry
}

export async function getIdEntry(id: string): Promise<IdIndexEntry | null> {
  await initIdIndexDb()
  const db = await getDb()
  const rows = await db.select<IdIndexRow[]>(`select ${COLUMNS} from id_index where id = $1`, [id])
  return rows[0] ? idIndexEntryFromRow(rows[0]) : null
}

export async function findIdsByPath(path: string): Promise<IdIndexEntry[]> {
  await initIdIndexDb()
  const db = await getDb()
  const rows = await db.select<IdIndexRow[]>(`select ${COLUMNS} from id_index where path = $1 order by created_at`, [path])
  return rows.map(idIndexEntryFromRow)
}

/** MOC 名稱 → M 編號。 */
export async function findMocIdByName(name: string): Promise<string | null> {
  await initIdIndexDb()
  const db = await getDb()
  const rows = await db.select<Array<{ id: string }>>("select id from id_index where kind = 'M' and name = $1 order by created_at limit 1", [name.trim()])
  return rows[0]?.id ?? null
}

/** Fork（almanac ALMNC-69.5）：整張索引（掃描補號與斷鏈修復用）。 */
export async function listIdIndex(): Promise<IdIndexEntry[]> {
  await initIdIndexDb()
  const db = await getDb()
  const rows = await db.select<IdIndexRow[]>(`select ${COLUMNS} from id_index`)
  return rows.map(idIndexEntryFromRow)
}

/**
 * Fork（almanac ALMNC-69.5）：App 內改名／搬動後同步索引裡的路徑。
 * 這樣掃描不會把 App 內的改名當成「在 App 外被改」而自己改連結（App 內改名由詢問對話框讓 Scott 決定）。
 */
export async function moveIdIndexPaths(moves: ReadonlyArray<{ sourcePath: string, targetPath: string }>, now = Date.now()): Promise<number> {
  if (moves.length === 0) return 0
  await initIdIndexDb()
  const db = await getDb()
  const rows = await db.select<Array<{ path: string }>>('select distinct path from id_index where path is not null')
  const changes = movedIndexPaths(rows.map(row => row.path), moves)
  for (const [from, to] of changes) {
    await db.execute('update id_index set path = $1, last_name = $2, updated_at = $3 where path = $4', [to, lastNameOf(to), now, from])
  }
  return changes.length
}

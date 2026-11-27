// Fork（almanac ALMNC-85.3）：ops（操作紀錄）的 V3 同步表（設計 2.13）。85.3 #3「在 B 台可以復原 A 台的操作」靠它：
// 活動紀錄的「復原」用 op_id 找 ops 表的操作，所以 ops 也要到 B 台。設計原本排在 85.4，因為 85.3 #3 依賴它而提前在這裡做，85.4 不必重做。
//
// C 型：每台只寫自己的 .almanac/v3/ops/<deviceId>/<YYYY-MM>.json（筆記庫層），合併＝聯集。
// - 操作 { type: 'op', uid = op.id, ... }；復原事件 { type: 'undo', uid = undo:<裝置>:<opId>, opId, at }。
//   誰按的復原就寫在誰的檔裡：A 台的操作在 B 台被復原，記在 B 台的檔。
// - undone_at = 所有復原事件裡最早的時間（D 型：復原過就保持復原；重做是新的一筆操作）。
// - 本機欄位：workspace 不傳，收進來時填目前的筆記庫（設計 1.6）。origin_device／undone_device 是同步用的新欄位（純加法）。
// - 超過 30 天（UNDO_WINDOW_MS）的不能再復原，本機也會清掉：不上傳、不收（retain）。
// - 復原事件比操作先到（兩台的檔案讀取順序不定）：先記在 almanac_ops_pending_undo，操作到了再補上。
import { UNDO_WINDOW_MS } from '@/lib/ops/types'
import { missingOpsSyncColumns, OPS_SCHEMA } from '@/lib/ops/schema'
import type { AlmanacSqlDb, SqlValue } from '../sql'
import type { AlmanacAppendTable } from './registry'

export const OPS_SYNC_TABLE = 'ops'

export interface OpSyncEntry {
  uid: string
  at: number
  type: 'op' | 'undo'
  /** 寫這筆的裝置 */
  device: string
  // type = 'op'
  id?: string
  actor?: string
  actorId?: string | null
  kind?: string
  payload?: unknown
  inverse?: unknown
  proposalId?: string | null
  batchId?: string | null
  baseVersions?: Record<string, string | null>
  // type = 'undo'
  opId?: string
}

export const undoUid = (deviceId: string, opId: string) => `undo:${deviceId}:${opId}`

const ready = new WeakMap<AlmanacSqlDb, Promise<void>>()

/** ops 表（同 db/ops.ts）＋兩個同步欄位＋還沒配對到操作的復原事件。 */
export function ensureOpsSyncSchema(db: AlmanacSqlDb): Promise<void> {
  let pending = ready.get(db)
  if (!pending) {
    pending = (async () => {
      for (const sql of OPS_SCHEMA) await db.execute(sql)
      const columns = await db.select<Array<{ name: string }>>('pragma table_info(ops)')
      for (const name of missingOpsSyncColumns(columns)) await db.execute(`alter table ops add column ${name} text default null`)
      await db.execute(`create table if not exists almanac_ops_pending_undo (
        op_id text not null,
        device text not null,
        at integer not null,
        primary key (op_id, device)
      )`)
    })().catch(error => {
      ready.delete(db)
      throw error
    })
    ready.set(db, pending)
  }
  return pending
}

interface OpRow {
  id: string
  at: number
  actor: string
  actorId: string | null
  kind: string
  payload: string
  inverse: string
  proposalId: string | null
  batchId: string | null
  baseVersions: string
  undoneAt: number | null
  originDevice: string
  undoneDevice: string | null
}

function parse(text: string, fallback: unknown): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/** 純函式：同一批裡先插操作、再套復原事件（復原事件的時間可能因時鐘偏移早於操作）。 */
export function orderOpsForApply(entries: readonly OpSyncEntry[]): OpSyncEntry[] {
  const ops = entries.filter(entry => entry.type === 'op')
  const undos = entries.filter(entry => entry.type === 'undo')
  return [...ops, ...undos]
}

async function applyUndo(db: AlmanacSqlDb, opId: string, at: number, device: string): Promise<boolean> {
  const rows = await db.select<Array<{ undoneAt: number | null }>>('select undone_at as undoneAt from ops where id = $1', [opId])
  if (!rows.length) return false
  const current = rows[0].undoneAt === null || rows[0].undoneAt === undefined ? null : Number(rows[0].undoneAt)
  if (current === null) {
    await db.execute('update ops set undone_at = $1, undone_device = $2 where id = $3', [at, device, opId])
  } else if (at < current) {
    // 兩台都復原了同一筆：取最早的時間；按復原的那台保留原本記的（不改成別台）。
    await db.execute('update ops set undone_at = $1 where id = $2', [at, opId])
  }
  return true
}

export function createOpsTable(): AlmanacAppendTable<OpSyncEntry> {
  return {
    kind: 'append',
    name: OPS_SYNC_TABLE,
    layer: 'library',
    dir: 'ops',
    retain: (entry, now) => entry.at >= now - UNDO_WINDOW_MS,
    async readOwn({ db, deviceId, libraryScope }) {
      await ensureOpsSyncSchema(db)
      // 這台寫的操作（還沒標裝置的都是這台寫的：收進來的一定有標）；這台按的復原。
      await db.execute('update ops set origin_device = $1 where origin_device is null', [deviceId])
      await db.execute('update ops set undone_device = $1 where undone_at is not null and undone_device is null', [deviceId])
      const rows = await db.select<OpRow[]>(
        `select id, at, actor, actor_id as actorId, kind, payload, inverse, proposal_id as proposalId, batch_id as batchId,
          base_versions as baseVersions, undone_at as undoneAt, origin_device as originDevice, undone_device as undoneDevice
         from ops where workspace = $1 and (origin_device = $2 or undone_device = $2) order by at, rowid`,
        [libraryScope, deviceId],
      )
      const entries: OpSyncEntry[] = []
      for (const row of rows) {
        if (row.originDevice === deviceId) {
          entries.push({
            uid: row.id,
            at: Number(row.at),
            type: 'op',
            device: deviceId,
            id: row.id,
            actor: row.actor,
            actorId: row.actorId ?? null,
            kind: row.kind,
            payload: parse(row.payload, null),
            inverse: parse(row.inverse, null),
            proposalId: row.proposalId ?? null,
            batchId: row.batchId ?? null,
            baseVersions: parse(row.baseVersions, {}) as Record<string, string | null>,
          })
        }
        if (row.undoneAt !== null && row.undoneAt !== undefined && row.undoneDevice === deviceId) {
          entries.push({ uid: undoUid(deviceId, row.id), at: Number(row.undoneAt), type: 'undo', device: deviceId, opId: row.id })
        }
      }
      return entries
    },
    async applyRemote({ db, libraryScope }, entries) {
      await ensureOpsSyncSchema(db)
      for (const entry of orderOpsForApply(entries)) {
        if (entry.type === 'op' && entry.id) {
          const exists = await db.select<Array<{ id: string }>>('select id from ops where id = $1', [entry.id])
          if (!exists.length) {
            const values: SqlValue[] = [
              entry.id, libraryScope, entry.at, entry.actor ?? 'system', entry.actorId ?? null, entry.kind ?? '',
              JSON.stringify(entry.payload ?? null), JSON.stringify(entry.inverse ?? null), entry.proposalId ?? null,
              entry.batchId ?? null, JSON.stringify(entry.baseVersions ?? {}), entry.device,
            ]
            await db.execute(
              `insert into ops (id, workspace, at, actor, actor_id, kind, payload, inverse, proposal_id, batch_id, base_versions, undone_at, origin_device)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, null, $12)`,
              values,
            )
          }
          // 先到的復原事件補上。
          const pending = await db.select<Array<{ device: string; at: number }>>(
            'select device, at from almanac_ops_pending_undo where op_id = $1 order by at', [entry.id],
          )
          for (const undo of pending) await applyUndo(db, entry.id, Number(undo.at), undo.device)
          if (pending.length) await db.execute('delete from almanac_ops_pending_undo where op_id = $1', [entry.id])
          continue
        }
        if (entry.type === 'undo' && entry.opId) {
          if (!await applyUndo(db, entry.opId, entry.at, entry.device)) {
            await db.execute(
              `insert into almanac_ops_pending_undo (op_id, device, at) values ($1, $2, $3)
               on conflict(op_id, device) do update set at = min(almanac_ops_pending_undo.at, excluded.at)`,
              [entry.opId, entry.device, entry.at],
            )
          }
        }
      }
    },
  }
}

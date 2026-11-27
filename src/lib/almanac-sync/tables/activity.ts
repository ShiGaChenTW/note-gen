// Fork（almanac ALMNC-85.3）：活動紀錄（activity_log）的 V3 同步表（設計 2.10、M1、M2 活動紀錄部分、第 8 節 5A）。
// C 型：每台只寫自己的 .data/almanac/activity/<deviceId>/<YYYY-MM>.json，合併＝聯集。
//
// - 同步鍵 uid = <deviceId>:<本機 id>。M1 重建表時，以前的紀錄全部補上這台的 uid（5A：連同以前的紀錄全部上傳、每筆標裝置）；
//   之後新增、或舊版 App 插入的紀錄 uid 是空的，下一輪同步時才補（觸發器只允許補一次）。
// - 收進來的紀錄寫進本機 activity_log：本機另給新的整數 id，uid 保留原值；uid 已存在就跳過，所以不會重複（85.3 #2）。
// - 更正：corrects_id 用 corrects_uid 找本機對應的 id，同一批裡先插被更正的那筆、再插更正；被更正的那筆晚到（還在別台的檔案裡）時，
//   先插更正（corrects_id 留空、corrects_uid 有值），讀取時再用 corrects_uid 找回來。
// - 順序：依 at 排，同一時間依裝置、再依那台的本機 id；兩台時鐘有差時順序依各台當時的時鐘（可接受的誤差）。
// - 單機欄位：source_ref 的本機對話編號傳出時換成 conv:<syncId>，收進來時換回本機編號；查不到就保留 conv:<syncId>
//   （畫面顯示「另一台的對話（尚未同步）」）。archived_at 不傳，各台依自己的時鐘封存。actor_id 不改，顯示時查別名表換算。
import { mergeAppendEntries } from '../merge'
import type { AlmanacSqlDb, SqlValue } from '../sql'
import { migrateActivitySyncColumns, type ActivityMigrationStatement } from '@/lib/agent-memory/schema'
import type { AlmanacAppendTable } from './registry'

export const ACTIVITY_SYNC_TABLE = 'activity'

export interface ActivitySyncEntry {
  uid: string
  at: number
  actorId: string
  actorRole: string
  action: string
  targetLink: string
  source: { kind: string; ref: string }
  note: string
  correctsUid: string | null
  opId: string | null
  /** 寫這筆的裝置 */
  device: string
}

export interface ActivityTableDeps {
  /** App：先跑 db/agent-memory 的建表與舊表升級（測試直接在 node:sqlite 建表）。 */
  ensureSchema?(db: AlmanacSqlDb): Promise<void>
  /** 一個交易執行（App：executeRecordTransaction；測試：node:sqlite begin/commit）。 */
  runTransaction(statements: ActivityMigrationStatement[]): Promise<void>
}

const PORTABLE_CONVERSATION = 'conv:'

/** uid 最後一段是那台的本機 id（裝置編號本身也可能含冒號）。 */
export function localNumberOfUid(uid: string): number {
  const value = Number(uid.slice(uid.lastIndexOf(':') + 1))
  return Number.isFinite(value) ? value : 0
}

function compareEntries(left: ActivitySyncEntry, right: ActivitySyncEntry): number {
  if (left.at !== right.at) return left.at - right.at
  if (left.device !== right.device) return left.device < right.device ? -1 : 1
  const byNumber = localNumberOfUid(left.uid) - localNumberOfUid(right.uid)
  if (byNumber) return byNumber
  return left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : 0
}

/**
 * 純函式：收進來的紀錄排成插入順序。uid 去重；依 at → 裝置 → 那台的本機 id 排（不用 uid 字串比，否則 dev:10 會排在 dev:9 前面）；
 * 同一批裡被更正的那筆一定排在更正之前，就算更正的時間比較早（時鐘偏移）也一樣。
 */
export function orderActivityForInsert(entries: readonly ActivitySyncEntry[]): ActivitySyncEntry[] {
  const unique = mergeAppendEntries([...entries]).sort(compareEntries)
  const inBatch = new Set(unique.map(entry => entry.uid))
  const emitted = new Set<string>()
  const waiting = new Map<string, ActivitySyncEntry[]>()
  const result: ActivitySyncEntry[] = []
  const emit = (entry: ActivitySyncEntry) => {
    result.push(entry)
    emitted.add(entry.uid)
    const dependents = waiting.get(entry.uid) ?? []
    waiting.delete(entry.uid)
    for (const dependent of dependents) emit(dependent)
  }
  for (const entry of unique) {
    const target = entry.correctsUid
    if (target && target !== entry.uid && inBatch.has(target) && !emitted.has(target)) {
      waiting.set(target, [...(waiting.get(target) ?? []), entry])
      continue
    }
    emit(entry)
  }
  for (const rest of waiting.values()) for (const entry of rest) if (!emitted.has(entry.uid)) emit(entry)
  return result
}

/** 畫面用：所有裝置的紀錄合併後的顯示順序（最新的在前）。 */
export function displayOrder(entries: readonly ActivitySyncEntry[]): ActivitySyncEntry[] {
  return mergeAppendEntries([...entries]).sort(compareEntries).reverse()
}

async function lookupConversationSyncId(db: AlmanacSqlDb, localId: number): Promise<string | null> {
  try {
    const rows = await db.select<Array<{ syncId: string | null }>>('select syncId as syncId from conversations where id = $1', [localId])
    return rows[0]?.syncId ?? null
  } catch {
    return null
  }
}

async function lookupConversationLocalId(db: AlmanacSqlDb, syncId: string): Promise<number | null> {
  try {
    const rows = await db.select<Array<{ id: number }>>('select id from conversations where syncId = $1', [syncId])
    return rows[0] ? Number(rows[0].id) : null
  } catch {
    return null
  }
}

/** 傳出：本機對話編號 → conv:<syncId>；查不到就加裝置前綴（conv:<deviceId>:<編號>），不會撞到別台的編號。 */
export async function toPortableSourceRef(db: AlmanacSqlDb, kind: string, ref: string, deviceId: string): Promise<string> {
  if (kind !== 'conversation' || !/^\d+$/.test(ref)) return ref
  const syncId = await lookupConversationSyncId(db, Number(ref))
  return syncId ? `${PORTABLE_CONVERSATION}${syncId}` : `${PORTABLE_CONVERSATION}${deviceId}:${ref}`
}

/** 收進來：conv:<syncId> → 本機對話編號；查不到（對話同步關著或還沒到）就保留 conv:<syncId>。 */
export async function fromPortableSourceRef(db: AlmanacSqlDb, kind: string, ref: string, deviceId: string): Promise<string> {
  if (kind !== 'conversation' || !ref.startsWith(PORTABLE_CONVERSATION)) return ref
  const rest = ref.slice(PORTABLE_CONVERSATION.length)
  if (rest.startsWith(`${deviceId}:`)) {
    const local = rest.slice(deviceId.length + 1)
    if (/^\d+$/.test(local)) return local
  }
  const localId = await lookupConversationLocalId(db, rest)
  return localId === null ? ref : String(localId)
}

/** 這筆的來源是不是另一台、還沒同步到這台的對話。 */
export function isPendingConversationRef(kind: string, ref: string): boolean {
  return kind === 'conversation' && ref.startsWith(PORTABLE_CONVERSATION)
}

/** M1（第一次開 V3 同步時）＋補 uid：舊版 App 或這版新寫的紀錄 uid 還是空的，由這台補上。 */
export async function ensureActivitySyncSchema(db: AlmanacSqlDb, deviceId: string, deps: ActivityTableDeps): Promise<void> {
  await deps.ensureSchema?.(db)
  await migrateActivitySyncColumns(db as never, deps.runTransaction, deviceId)
  await db.execute(
    "update activity_log set uid = $1 || ':' || id, origin_device = $1 where uid is null",
    [deviceId],
  )
  await db.execute(
    `update activity_log set corrects_uid = (select target.uid from activity_log target where target.id = activity_log.corrects_id)
     where corrects_uid is null and corrects_id is not null`,
  )
}

interface OwnRow {
  uid: string
  at: number
  actorId: string
  actorRole: string
  action: string
  targetLink: string
  sourceKind: string
  sourceRef: string
  note: string
  correctsUid: string | null
  opId: string | null
  device: string
}

export function createActivityTable(deps: ActivityTableDeps): AlmanacAppendTable<ActivitySyncEntry> {
  return {
    kind: 'append',
    name: ACTIVITY_SYNC_TABLE,
    layer: 'account',
    dir: 'activity',
    async readOwn({ db, deviceId }) {
      await ensureActivitySyncSchema(db, deviceId, deps)
      const rows = await db.select<OwnRow[]>(
        `select uid, at, actor_id as actorId, actor_role as actorRole, action, target_link as targetLink, source_kind as sourceKind,
          source_ref as sourceRef, note, corrects_uid as correctsUid, op_id as opId, origin_device as device
         from activity_log where origin_device = $1 order by id`,
        [deviceId],
      )
      const entries: ActivitySyncEntry[] = []
      for (const row of rows) {
        entries.push({
          uid: row.uid,
          at: Number(row.at),
          actorId: row.actorId,
          actorRole: row.actorRole,
          action: row.action,
          targetLink: row.targetLink,
          source: { kind: row.sourceKind, ref: await toPortableSourceRef(db, row.sourceKind, row.sourceRef, deviceId) },
          note: row.note ?? '',
          correctsUid: row.correctsUid ?? null,
          opId: row.opId ?? null,
          device: row.device,
        })
      }
      return entries
    },
    async applyRemote({ db, deviceId }, entries) {
      await ensureActivitySyncSchema(db, deviceId, deps)
      for (const entry of orderActivityForInsert(entries)) {
        const existing = await db.select<Array<{ id: number }>>('select id from activity_log where uid = $1', [entry.uid])
        if (existing.length) continue
        const target = entry.correctsUid
          ? await db.select<Array<{ id: number }>>('select id from activity_log where uid = $1', [entry.correctsUid])
          : []
        const ref = await fromPortableSourceRef(db, entry.source.kind, entry.source.ref, deviceId)
        const values: SqlValue[] = [
          entry.at, entry.actorId, entry.actorRole, entry.action, entry.targetLink, entry.source.kind, ref,
          entry.note ?? '', target[0] ? Number(target[0].id) : null, entry.opId ?? null, entry.uid, entry.correctsUid ?? null,
          entry.device || entry.uid.slice(0, entry.uid.lastIndexOf(':')),
        ]
        try {
          await db.execute(
            `insert into activity_log (at, actor_id, actor_role, action, target_link, source_kind, source_ref, note, corrects_id, op_id,
              uid, corrects_uid, origin_device) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            values,
          )
        } catch (error) {
          // 較新版 App 寫的角色或動作（check 限制不認得）：跳過這一筆，不讓整輪同步失敗。
          console.warn('[almanac-sync] activity entry skipped:', entry.uid, error)
        }
      }
    },
  }
}

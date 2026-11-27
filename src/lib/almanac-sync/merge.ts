// Fork（almanac ALMNC-85.2 骨架）：V3 同步 A～E 五種合併的純函式（設計 1.4、1.5、1.7）。
// 不碰資料庫、不碰網路：輸入「基準、本機、遠端」，輸出合併結果、要寫回本機的變動、要上傳的外殼與衝突。
//
// A 單筆三方合併：靠基準（每欄雜湊）分辨哪一邊真的改過；只有一邊改 → 採用；兩邊改不同欄 → 各取各的；
//   兩邊改同一欄 → 看欄位規則（預設較晚的贏）。
// B 集合聯集：mergeSetUnion（同鍵合為一筆，刪除靠墓碑）。
// C 各裝置自己的追加檔：mergeAppendEntries（聯集、依時間排序、uid 去重）。
// D 狀態只往前：forward() 欄位規則／pickForward。
// E 文字逐行合併：text() 欄位規則（見 text-merge.ts）。
import { hashValue, sameValue } from './hash'
import { mergeTextLines, type TextMergeConflict } from './text-merge'
import type { SyncRow, SyncTombstone, SyncValue } from './envelope'
import { pruneTombstones } from './envelope'

// ---------- 欄位規則 ----------

export interface FieldMergeContext {
  local: SyncRow
  remote: SyncRow
  /** 本機版本較晚（u 大；同時間比 d 字串） */
  localIsLater: boolean
}

export type FieldRule =
  | { type: 'lww' }
  | { type: 'resolve'; resolve: (local: unknown, remote: unknown, context: FieldMergeContext) => unknown }
  | { type: 'text'; conflict: 'ask' | 'keep-local' }
  | { type: 'ask' }

export type FieldRules<V extends SyncValue = SyncValue> = Partial<Record<keyof V & string, FieldRule>>

/** 兩邊改同一欄 → 較晚的贏（預設）。 */
export const lww = (): FieldRule => ({ type: 'lww' })

/**
 * D 型：狀態只往前。order 由前到後；不在 order 裡的值排最後面以外的處理交給 tieBreak。
 * tieBreak 讓表自己決定特殊情況（例如 rejected 對上 awaiting_decision 看時間）。
 */
export function forward(order: readonly unknown[], tieBreak?: (local: unknown, remote: unknown, context: FieldMergeContext) => unknown): FieldRule {
  return {
    type: 'resolve',
    resolve: (local, remote, context) => {
      const special = tieBreak?.(local, remote, context)
      if (special !== undefined) return special
      return pickForward(order, local, remote, context.localIsLater)
    },
  }
}

export function pickForward<T>(order: readonly unknown[], local: T, remote: T, localIsLater = true): T {
  const localRank = order.indexOf(local)
  const remoteRank = order.indexOf(remote)
  if (localRank === remoteRank) return localIsLater ? local : remote
  return localRank > remoteRank ? local : remote
}

const isPresent = (value: unknown) => value !== null && value !== undefined

/** 取兩邊較早的非空值（一旦鎖定／封存就保持）。 */
export const minNonNull = (): FieldRule => ({
  type: 'resolve',
  resolve: (local, remote) => {
    if (!isPresent(local)) return remote
    if (!isPresent(remote)) return local
    return Number(local) <= Number(remote) ? local : remote
  },
})

/** 取兩邊較大的數字（例如 lastFetchedAt）。 */
export const maxNumber = (): FieldRule => ({
  type: 'resolve',
  resolve: (local, remote) => {
    if (!isPresent(local)) return remote
    if (!isPresent(remote)) return local
    return Number(local) >= Number(remote) ? local : remote
  },
})

/** 任一邊為 true 就是 true（例如「照建議處理」按過就算）。 */
export const anyTrue = (): FieldRule => ({ type: 'resolve', resolve: (local, remote) => Boolean(local) || Boolean(remote) })

/** 陣列欄位的 B 型聯集，鍵由 keyOf 決定；同鍵保留本機那筆。 */
export function unionBy<T>(keyOf: (item: T) => string): FieldRule {
  return {
    type: 'resolve',
    resolve: (local, remote) => {
      const merged = new Map<string, T>()
      for (const item of (Array.isArray(local) ? local : []) as T[]) merged.set(keyOf(item), item)
      for (const item of (Array.isArray(remote) ? remote : []) as T[]) if (!merged.has(keyOf(item))) merged.set(keyOf(item), item)
      return [...merged.values()]
    },
  }
}

/** E 型：逐行三方合併；ask＝同段兩種改法時出確認卡（Scott 親手寫的文字），keep-local＝只保留本機、不出卡。 */
export const text = (conflict: 'ask' | 'keep-local' = 'ask'): FieldRule => ({ type: 'text', conflict })

/** 兩邊改同一欄就一定要問 Scott（例如提案兩台都接受）；問之前保留本機。 */
export const ask = (): FieldRule => ({ type: 'ask' })

// ---------- A 型：單筆三方合併 ----------

export interface RowBase {
  /** 每個欄位的雜湊：判斷「這一欄跟基準比改了沒」 */
  hashes: Record<string, string>
  /** E 型欄位需要整份基準文字 */
  doc?: Record<string, string> | null
}

export interface FieldConflict {
  key: string
  field: string
  base: unknown
  local: unknown
  remote: unknown
  /** E 型：衝突的段落 */
  hunks?: TextMergeConflict[]
}

export interface MergeRowInput<V extends SyncValue> {
  key: string
  base: RowBase | null
  local: SyncRow<V>
  remote: SyncRow<V>
  rules?: FieldRules<V>
  /** 本機這列只是沒改過的預設值（例如新裝置剛建的預設夥伴）→ 一律讓位給遠端（設計 2.6、M10）。 */
  localPristine?: boolean
}

export interface MergeRowResult<V extends SyncValue> {
  row: SyncRow<V>
  conflicts: FieldConflict[]
}

export function isLaterStamp(left: Pick<SyncRow, 'u' | 'd'>, right: Pick<SyncRow, 'u' | 'd'>): boolean {
  if (left.u !== right.u) return left.u > right.u
  return left.d > right.d
}

export function hashRowFields(value: SyncValue): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined).map(([field, fieldValue]) => [field, hashValue(fieldValue)]))
}

export function textFieldsOf<V extends SyncValue>(value: V, rules?: FieldRules<V>): Record<string, string> | null {
  if (!rules) return null
  const doc: Record<string, string> = {}
  for (const [field, rule] of Object.entries(rules) as Array<[string, FieldRule | undefined]>) {
    if (rule?.type === 'text' && typeof value[field] === 'string') doc[field] = value[field] as string
  }
  return Object.keys(doc).length ? doc : null
}

export function buildRowBase<V extends SyncValue>(value: V, rules?: FieldRules<V>): RowBase {
  return { hashes: hashRowFields(value), doc: textFieldsOf(value, rules) }
}

function fieldChanged(base: RowBase | null, field: string, value: unknown): boolean {
  if (!base) return true
  const baseHash = base.hashes[field]
  if (baseHash === undefined) return value !== undefined && value !== null
  return hashValue(value) !== baseHash
}

export function mergeRow<V extends SyncValue>(input: MergeRowInput<V>): MergeRowResult<V> {
  const { key, base, local, remote, rules = {} as FieldRules<V> } = input
  // 內容一樣就沿用遠端那列（含時間），本機時間不同也不重傳，避免每次同步都改寫遠端。
  if (sameValue(local.v, remote.v)) return { row: remote, conflicts: [] }
  if (input.localPristine) return { row: remote, conflicts: [] }

  const localIsLater = isLaterStamp(local, remote)
  const context: FieldMergeContext = { local, remote, localIsLater }
  const fields = new Set([...Object.keys(local.v), ...Object.keys(remote.v)])
  const value: SyncValue = {}
  const conflicts: FieldConflict[] = []

  for (const field of fields) {
    const localValue = local.v[field]
    const remoteValue = remote.v[field]
    if (sameValue(localValue, remoteValue)) {
      value[field] = localValue
      continue
    }
    const localChanged = fieldChanged(base, field, localValue)
    const remoteChanged = fieldChanged(base, field, remoteValue)
    if (localChanged && !remoteChanged) {
      value[field] = localValue
      continue
    }
    if (!localChanged && remoteChanged) {
      value[field] = remoteValue
      continue
    }

    // 兩邊都改了（或沒有基準）：看欄位規則。
    const rule: FieldRule = rules[field as keyof V & string] ?? { type: 'lww' }
    switch (rule.type) {
      case 'lww':
        value[field] = localIsLater ? localValue : remoteValue
        break
      case 'resolve':
        value[field] = rule.resolve(localValue, remoteValue, context)
        break
      case 'ask':
        value[field] = localValue
        conflicts.push({ key, field, base: base?.doc?.[field], local: localValue, remote: remoteValue })
        break
      case 'text': {
        const baseText = base?.doc?.[field] ?? ''
        const merged = mergeTextLines(baseText, String(localValue ?? ''), String(remoteValue ?? ''))
        value[field] = merged.text
        if (merged.conflicts.length && rule.conflict === 'ask') {
          conflicts.push({ key, field, base: base?.doc?.[field] ?? null, local: localValue, remote: remoteValue, hunks: merged.conflicts })
        }
        break
      }
    }
  }

  const merged = value as V
  if (sameValue(merged, local.v)) return { row: local, conflicts }
  if (sameValue(merged, remote.v)) return { row: remote, conflicts }
  // 混合結果：時間取較晚的那邊，讓其他裝置看得出這列有新版本。
  const later = localIsLater ? local : remote
  return { row: { v: merged, u: later.u, d: later.d }, conflicts }
}

// ---------- 整張表：A 型＋刪除（1.5） ----------

export interface PendingRemoteDeletion<V extends SyncValue> {
  key: string
  tombstone: SyncTombstone
  local: SyncRow<V>
}

export interface MergeTableInput<V extends SyncValue> {
  local: Record<string, SyncRow<V>>
  remote: { rows: Record<string, SyncRow<V>>; deleted: Record<string, SyncTombstone> }
  bases: Record<string, RowBase>
  /** 本機已知的刪除（有時間就用它；沒有時，基準有、本機沒有的列以 now 當刪除時間） */
  localDeleted?: Record<string, SyncTombstone>
  rules?: FieldRules<V>
  isPristine?: (key: string, row: SyncRow<V>) => boolean
  /** 別台的刪除要先問 Scott（設計第 8 節 2A：RSS 訂閱、夥伴） */
  askOnRemoteDelete?: boolean
  now: number
  deviceId: string
}

export interface MergeTableResult<V extends SyncValue> {
  /** 合併後的完整列集合（也是要上傳的 rows） */
  rows: Record<string, SyncRow<V>>
  /** 要上傳的墓碑 */
  deleted: Record<string, SyncTombstone>
  /** 要寫回本機的新增／修改 */
  localUpserts: Record<string, V>
  /** 要在本機刪掉的列 */
  localDeletes: string[]
  /** 別台刪了、要先問 Scott 的列（同步照常進行，本機先保留） */
  pendingDeletes: Array<PendingRemoteDeletion<V>>
  conflicts: FieldConflict[]
}

export function mergeTable<V extends SyncValue>(input: MergeTableInput<V>): MergeTableResult<V> {
  const { local, remote, bases, rules, now, deviceId } = input
  const localDeleted = input.localDeleted ?? {}
  const rows: Record<string, SyncRow<V>> = {}
  const deleted: Record<string, SyncTombstone> = { ...pruneTombstones(remote.deleted, now) }
  const localUpserts: Record<string, V> = {}
  const localDeletes: string[] = []
  const pendingDeletes: Array<PendingRemoteDeletion<V>> = []
  const conflicts: FieldConflict[] = []

  const keys = new Set([...Object.keys(local), ...Object.keys(remote.rows), ...Object.keys(remote.deleted), ...Object.keys(bases), ...Object.keys(localDeleted)])
  for (const key of keys) {
    const localRow = local[key]
    const remoteRow = remote.rows[key]
    const tombstone = remote.deleted[key]
    const base = bases[key] ?? null
    const changedSinceBase = (row: SyncRow<V>) => !base || hashValue(hashRowFields(row.v)) !== hashValue(base.hashes)

    if (localRow && remoteRow) {
      const merged = mergeRow({ key, base, local: localRow, remote: remoteRow, rules, localPristine: input.isPristine?.(key, localRow) })
      rows[key] = merged.row
      conflicts.push(...merged.conflicts)
      if (!sameValue(merged.row.v, localRow.v)) localUpserts[key] = merged.row.v
      delete deleted[key]
      continue
    }

    if (localRow && !remoteRow) {
      if (tombstone) {
        // 刪除對修改：本機在墓碑之後又改過 → 修改贏、清掉墓碑（同 84.8「本機較新就不擋」）。
        if (changedSinceBase(localRow) && localRow.u > tombstone.deletedAt) {
          rows[key] = localRow
          delete deleted[key]
        } else if (input.askOnRemoteDelete) {
          pendingDeletes.push({ key, tombstone, local: localRow })
        } else {
          localDeletes.push(key)
        }
        continue
      }
      // 本機新增，或遠端少了這列卻沒有墓碑（墓碑已過期等）→ 保守地保留並重新上傳。
      rows[key] = localRow
      continue
    }

    if (!localRow && remoteRow) {
      const knownLocalDeletion = localDeleted[key]
      if (base || knownLocalDeletion) {
        // 本機刪了：遠端在那之後又改過 → 救回（修改贏）；否則把刪除傳出去。
        const deletedAt = knownLocalDeletion?.deletedAt ?? now
        if (changedSinceBase(remoteRow) && remoteRow.u > (knownLocalDeletion?.deletedAt ?? 0)) {
          rows[key] = remoteRow
          localUpserts[key] = remoteRow.v
          delete deleted[key]
        } else {
          deleted[key] = { deletedAt, deviceId: knownLocalDeletion?.deviceId ?? deviceId }
        }
        continue
      }
      rows[key] = remoteRow
      localUpserts[key] = remoteRow.v
      delete deleted[key]
      continue
    }

    // 兩邊都沒有：保留遠端墓碑；本機刪了而遠端也沒有 → 記一個墓碑（另一台可能還留著）。
    if (!tombstone && localDeleted[key]) deleted[key] = localDeleted[key]
  }

  return { rows, deleted: pruneTombstones(deleted, now), localUpserts, localDeletes, pendingDeletes, conflicts }
}

// ---------- B 型：集合聯集 ----------

export interface SetEntry<T> {
  value: T
  at: number
}

/**
 * 兩邊的項目全部留下，同鍵合為一筆（pick 決定留哪筆，預設時間較晚的），
 * 墓碑時間晚於項目時間的拿掉。用在 source_outputs、scott_pins、RSS seen。
 */
export function mergeSetUnion<T>(
  local: Record<string, SetEntry<T>>,
  remote: Record<string, SetEntry<T>>,
  tombstones: Record<string, SyncTombstone> = {},
  pick: (left: SetEntry<T>, right: SetEntry<T>) => SetEntry<T> = (left, right) => (right.at > left.at ? right : left),
): Record<string, SetEntry<T>> {
  const merged: Record<string, SetEntry<T>> = { ...local }
  for (const [key, entry] of Object.entries(remote)) merged[key] = merged[key] ? pick(merged[key], entry) : entry
  for (const [key, tombstone] of Object.entries(tombstones)) {
    if (merged[key] && merged[key].at <= tombstone.deletedAt) delete merged[key]
  }
  return merged
}

// ---------- C 型：各裝置自己的追加檔 ----------

export interface AppendEntry {
  uid: string
  at: number
}

/** 聯集所有裝置的紀錄，依 at 排、同時間依 uid 排；uid 重複只留一筆。 */
export function mergeAppendEntries<E extends AppendEntry>(...lists: E[][]): E[] {
  const byUid = new Map<string, E>()
  for (const list of lists) for (const entry of list) if (!byUid.has(entry.uid)) byUid.set(entry.uid, entry)
  return [...byUid.values()].sort((left, right) => left.at - right.at || (left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : 0))
}

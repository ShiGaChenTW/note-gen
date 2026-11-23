// Fork（almanac ALMNC-69.1）：系統索引（id_index 表）的資料形狀。記「編號 ↔ 種類、上次的路徑與檔名」，
// MOC 另外記「名稱 ↔ M 編號」（筆記的 domains 存領域名稱，靠這裡換回 M 編號）。
// 斷鏈修復與掃描補號（ALMNC-69.5）讀這張表；這裡只放純函式，SQL 在 src/db/id-index.ts。
import { isId, type IdKind } from './identity'

export interface IdIndexEntry {
  id: string
  kind: IdKind
  /** 上次看到的 vault 相對路徑；章節（C）沒有自己的檔案時是所在 MOC 的路徑或空。 */
  path?: string
  /** 上次看到的檔名（不含資料夾與 .md）。 */
  lastName?: string
  /** MOC 的名稱（M 編號才有）。 */
  name?: string
  createdAt: number
  updatedAt: number
}

export interface IdIndexRow {
  id: string
  kind: string
  path: string | null
  lastName: string | null
  name: string | null
  createdAt: number
  updatedAt: number
}

/** 路徑 → 檔名（去掉資料夾與 .md）。 */
export function lastNameOf(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.md$/i, '')
}

export function idIndexEntryFromRow(row: IdIndexRow): IdIndexEntry {
  return {
    id: row.id,
    kind: row.kind as IdKind,
    path: row.path ?? undefined,
    lastName: row.lastName ?? undefined,
    name: row.name ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export interface RecordIdInput {
  id: string
  kind: IdKind
  path?: string
  name?: string
}

/** 驗證後組成要寫入的列；編號與類別不一致、或 name 用在 M 以外時丟錯。 */
export function idIndexValues(input: RecordIdInput, now: number): IdIndexEntry {
  if (!isId(input.id, input.kind)) throw new Error(`編號與類別不符：${input.id}（${input.kind}）`)
  const name = input.name?.trim() || undefined
  if (name && input.kind !== 'M') throw new Error('只有 MOC（M）在系統索引記名稱')
  const path = input.path?.trim() || undefined
  return { id: input.id, kind: input.kind, path, lastName: path ? lastNameOf(path) : undefined, name, createdAt: now, updatedAt: now }
}

// Fork（almanac ALMNC-85.2 骨架）：V3 同步的表註冊介面。
// 85.2（資料源、RSS、提案）、85.3（夥伴、活動紀錄）、85.4（MOC、ops）各自在 tables/ 下加一個檔、呼叫 registerAlmanacSyncTable。
// 骨架本身不註冊任何正式表；runtime 依註冊順序同步（例如先傳資料源桶、再傳 feeds.json，設計 2.2）。
import type { FieldConflict, FieldRules, PendingRemoteDeletion } from '../merge'
import type { SyncTombstone, SyncValue } from '../envelope'
import type { AlmanacSqlDb } from '../sql'
import type { AlmanacSyncLayer } from '../remote'
import type { AppendEntry } from '../merge'

export interface AlmanacTableContext {
  db: AlmanacSqlDb
  deviceId: string
  now(): number
  /** 這次是不是這台裝置第一次 V3 同步（M10：先拉、再合併、再推） */
  firstSync: boolean
}

export interface LocalSyncRow<V extends SyncValue> {
  v: V
  /** 本機最後修改時間（兩邊改同一欄、規則是較晚的贏時用） */
  u: number
}

export interface RowsTableChange<V extends SyncValue> {
  upserts: Record<string, V>
  deletes: string[]
}

/** 有修改的表（A 型為主，欄位可配 B／D／E 規則）。 */
export interface AlmanacRowsTable<V extends SyncValue = SyncValue> {
  kind: 'rows'
  /** 外殼的 table 名稱，也是基準表的 table_name */
  name: string
  layer: AlmanacSyncLayer
  /** 單一檔（相對於層根目錄，例如 'feeds.json'）或分桶（dir/index.json＋dir/b00.json…） */
  storage: { type: 'file'; path: string } | { type: 'buckets'; dir: string; count: number }
  rules?: FieldRules<V>
  /** 這張表從設定同步接手的 store.json key（M9：首次上傳成功後才加進設定排除清單） */
  storeKeys?: string[]
  /** 別台的刪除要先問 Scott（第 8 節 2A） */
  askOnRemoteDelete?: boolean
  /** 本機這列只是沒改過的預設值 → 讓位給遠端（2.6、M10） */
  isPristine?(key: string, row: LocalSyncRow<V>): boolean
  read(context: AlmanacTableContext): Promise<Record<string, LocalSyncRow<V>>>
  apply(context: AlmanacTableContext, change: RowsTableChange<V>): Promise<void>
  /** 本機已知的刪除（有時間比較準）；沒有就以「基準有、本機沒有」推斷 */
  localDeleted?(context: AlmanacTableContext): Promise<Record<string, SyncTombstone>>
  onPendingDeletes?(context: AlmanacTableContext, pending: Array<PendingRemoteDeletion<V>>): Promise<void>
  onConflicts?(context: AlmanacTableContext, conflicts: FieldConflict[]): Promise<void>
  /**
   * Fork（almanac ALMNC-85.2）：這張表所有檔都合併、寫回本機之後呼叫一次（不論有沒有變動）。
   * 給合併時順帶發現、但不改本機這列的事用：例如資料源兩台 id 不同時記別名、content 兩邊都改時另存落敗的那份。
   * 回傳 true＝本機資料有改動（畫面要重新載入）。
   */
  afterMerge?(context: AlmanacTableContext): Promise<boolean | void>
}

/** 只能新增的表（C 型）：每台只寫自己的 <dir>/<deviceId>/<YYYY-MM>.json。 */
export interface AlmanacAppendTable<E extends AppendEntry = AppendEntry> {
  kind: 'append'
  name: string
  layer: AlmanacSyncLayer
  /** 相對於層根目錄，例如 'activity' */
  dir: string
  /** 這台裝置寫的紀錄 */
  readOwn(context: AlmanacTableContext): Promise<E[]>
  /** 收進來的紀錄（含自己以前寫、但本機遺失的）；呼叫端保證依時間排序，實作要以 uid 去重 */
  applyRemote(context: AlmanacTableContext, entries: E[]): Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AlmanacSyncTable = AlmanacRowsTable<any> | AlmanacAppendTable<any>

const registry: AlmanacSyncTable[] = []

export function registerAlmanacSyncTable(table: AlmanacSyncTable): void {
  const index = registry.findIndex(item => item.name === table.name)
  if (index >= 0) registry[index] = table
  else registry.push(table)
}

export function getAlmanacSyncTables(): AlmanacSyncTable[] {
  return [...registry]
}

/** 只給測試用 */
export function resetAlmanacSyncTables(): void {
  registry.length = 0
}

/** 註冊的表接手的 store key（M9 換跑道用） */
export function getAlmanacSyncStoreKeys(tables = registry): string[] {
  return tables.flatMap(table => (table.kind === 'rows' ? table.storeKeys ?? [] : []))
}

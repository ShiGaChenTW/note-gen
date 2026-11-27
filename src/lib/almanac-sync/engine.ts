// Fork（almanac ALMNC-85.2 骨架）：V3 同步一輪的核心流程（不綁 Tauri，雙裝置模擬測試直接用）。
// 一輪 = devices.json → 依註冊順序逐表：拉遠端 → 讀本機與基準 → 合併 → 寫回本機 → 有變動才條件上傳 → 更新基準。
// almanac 領域一律走列層級合併，不走「整份覆蓋」（設計 1.9）。遠端在拉與推之間被別台改了（條件寫入失敗）→ 重拉重合併，最多 3 次。
import {
  envelopeContentHash, parseEnvelope, serializeEnvelope, ALMANAC_SYNC_FORMAT, ALMANAC_SYNC_VERSION,
  type SyncEnvelope, type SyncRow, type SyncTombstone, type SyncValue,
} from './envelope'
import { buildRowBase, hashRowFields, mergeAppendEntries, mergeTable, type AppendEntry, type FieldConflict, type RowBase } from './merge'
import { hashString, hashValue, stableStringify } from './hash'
import { allBuckets, bucketForKey, monthKey } from './keys'
import { getFileState, loadBases, saveBases, setFileState } from './base'
import { AlmanacRemoteConflictError, isAlmanacRemoteConflict, remoteRootFor, type AlmanacRemote, type AlmanacSyncLayer } from './remote'
import {
  ALMANAC_DEVICES_PATH, mergeDevicesDoc, parseDevicesDoc, serializeDevicesDoc,
  type AlmanacDevicesDoc, type PrimaryDeviceRequest,
} from './devices'
import type { AlmanacAppendTable, AlmanacRowsTable, AlmanacSyncTable, AlmanacTableContext, LocalSyncRow } from './tables/registry'
import { initAlmanacSyncTables, type AlmanacSqlDb } from './sql'

const MAX_CONFLICT_RETRIES = 3

export interface AlmanacSyncContext {
  db: AlmanacSqlDb
  deviceId: string
  deviceName: string
  appVersion?: string
  now(): number
  /** 每層一個遠端；筆記庫層拿不到（例如沒有筆記庫遠端）時給 null，該層的表跳過並記在報告裡 */
  remotes: Partial<Record<AlmanacSyncLayer, AlmanacRemote | null>>
  /** 筆記庫層的基準要依筆記庫分開（本機 ops 等表也是依 workspace 分） */
  libraryScope: string
  tables: AlmanacSyncTable[]
  firstSync?: boolean
  primaryRequest?: PrimaryDeviceRequest | null
}

export interface AlmanacTableReport {
  table: string
  appliedRows: number
  deletedRows: number
  uploadedFiles: string[]
  conflicts: FieldConflict[]
  pendingDeletes: string[]
  skipped?: string
}

export interface AlmanacSyncReport {
  devices: AlmanacDevicesDoc | null
  /** 這輪有改寫 devices.json（新裝置、指定主力裝置、6 小時一次的 lastSeenAt） */
  devicesWritten: boolean
  tables: AlmanacTableReport[]
  /** 本機資料有被遠端改動（畫面上的 store 要重新載入，設計 6 風險 6） */
  changedLocally: boolean
  uploadedFiles: string[]
}

function scopeFor(context: AlmanacSyncContext, layer: AlmanacSyncLayer) {
  return layer === 'account' ? 'account' : `library:${context.libraryScope}`
}

function joinPath(layer: AlmanacSyncLayer, ...parts: string[]) {
  return [remoteRootFor(layer), ...parts].join('/')
}

function tableContext(context: AlmanacSyncContext): AlmanacTableContext {
  return { db: context.db, deviceId: context.deviceId, now: context.now, firstSync: Boolean(context.firstSync), libraryScope: context.libraryScope }
}

async function withConflictRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (!isAlmanacRemoteConflict(error)) throw error
      lastError = error
    }
  }
  throw lastError
}

// ---------- devices.json ----------

export async function syncDevices(context: AlmanacSyncContext): Promise<{ doc: AlmanacDevicesDoc | null; written: boolean }> {
  const remote = context.remotes.account
  if (!remote) return { doc: null, written: false }
  const path = joinPath('account', ALMANAC_DEVICES_PATH)
  return withConflictRetry(async () => {
    const current = await remote.read(path)
    const remoteDoc = parseDevicesDoc(current?.content ?? null)
    const next = mergeDevicesDoc({
      remote: remoteDoc,
      self: { deviceId: context.deviceId, name: context.deviceName, appVersion: context.appVersion, syncVersion: ALMANAC_SYNC_VERSION },
      now: context.now(),
      primaryRequest: context.primaryRequest,
    })
    if (stableStringify(next) !== stableStringify(remoteDoc) || !current) {
      await remote.write(path, serializeDevicesDoc(next), { version: current?.version ?? null })
      return { doc: next, written: true }
    }
    return { doc: next, written: false }
  })
}

// ---------- 有修改的表 ----------

function toSyncRows<V extends SyncValue>(rows: Record<string, LocalSyncRow<V>>, deviceId: string): Record<string, SyncRow<V>> {
  return Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, { v: row.v, u: row.u, d: deviceId }]))
}

function rowChangedSinceBase(row: LocalSyncRow<SyncValue> | undefined, base: RowBase | undefined) {
  if (!row || !base) return true
  return hashValue(hashRowFields(row.v)) !== hashValue(base.hashes)
}

interface BucketIndex {
  format: typeof ALMANAC_SYNC_FORMAT
  table: string
  version: number
  buckets: Record<string, { hash: string; count: number }>
}

function parseBucketIndex(content: string | null, table: string): BucketIndex {
  const empty: BucketIndex = { format: ALMANAC_SYNC_FORMAT, table, version: ALMANAC_SYNC_VERSION, buckets: {} }
  if (!content) return empty
  try {
    const parsed = JSON.parse(content) as Partial<BucketIndex>
    if (parsed.format !== ALMANAC_SYNC_FORMAT || parsed.table !== table) throw new Error('format')
    return { ...empty, buckets: parsed.buckets && typeof parsed.buckets === 'object' ? parsed.buckets : {} }
  } catch {
    throw new Error(`SYNC_DATA_INVALID_SCHEMA: almanac ${table}/index.json`)
  }
}

async function syncRowsTable(context: AlmanacSyncContext, table: AlmanacRowsTable, report: AlmanacTableReport): Promise<boolean> {
  const remote = context.remotes[table.layer]
  if (!remote) {
    report.skipped = `no ${table.layer} remote`
    return false
  }
  const scope = scopeFor(context, table.layer)
  const ctx = tableContext(context)
  let changedLocally = false

  await withConflictRetry(async () => {
    const startedAt = context.now()
    // 85.4：過期的列（retain＝false）兩邊都當成不存在，基準也一起拿掉，所以不會被推斷成「本機刪了」而發墓碑。
    const expired = new Set<string>()
    const keepRows = <R extends { v: SyncValue }>(rows: Record<string, R>): Record<string, R> => {
      if (!table.retain) return rows
      return Object.fromEntries(Object.entries(rows).filter(([key, row]) => {
        if (table.retain?.(key, row.v, startedAt)) return true
        expired.add(key)
        return false
      }))
    }
    const localRows = keepRows(await table.read(ctx))
    const allBases = await loadBases(context.db, scope, table.name)
    const localDeleted = await table.localDeleted?.(ctx) ?? {}

    const files: Array<{ path: string; bucket?: string; keys: (key: string) => boolean }> = table.storage.type === 'file'
      ? [{ path: joinPath(table.layer, table.storage.path), keys: () => true }]
      : allBuckets(table.storage.count).map(bucket => ({
        path: joinPath(table.layer, (table.storage as { dir: string }).dir, `${bucket}.json`),
        bucket,
        keys: (key: string) => bucketForKey(key, (table.storage as { count: number }).count) === bucket,
      }))

    let index: BucketIndex | null = null
    let indexVersion: string | null = null
    const indexPath = table.storage.type === 'buckets' ? joinPath(table.layer, table.storage.dir, 'index.json') : ''
    if (table.storage.type === 'buckets') {
      const current = await remote.read(indexPath)
      index = parseBucketIndex(current?.content ?? null, table.name)
      indexVersion = current?.version ?? null
    }
    let indexChanged = false

    for (const file of files) {
      const keyOf = (record: Record<string, unknown>) => Object.keys(record).filter(file.keys)
      const fileLocalKeys = keyOf(localRows)
      const fileBaseKeys = keyOf(allBases)

      if (index && file.bucket) {
        // 分桶：遠端這桶沒變、本機這桶也沒變 → 不下載（設計 1.2「下載時只抓變了的桶」）。
        const state = await getFileState(context.db, scope, file.path)
        const remoteHash = index.buckets[file.bucket]?.hash ?? null
        const localDirty = fileLocalKeys.some(key => rowChangedSinceBase(localRows[key], allBases[key]))
          || fileBaseKeys.some(key => !localRows[key])
          || keyOf(localDeleted).length > 0
        if (!localDirty && (remoteHash ?? null) === (state?.hash ?? null)) continue
      }

      const current = await remote.read(file.path)
      const parsedEnvelope = parseEnvelope(current?.content ?? null, table.name, file.path)
      const remoteEnvelope = table.retain ? { ...parsedEnvelope, rows: keepRows(parsedEnvelope.rows) } : parsedEnvelope
      const bases = expired.size ? Object.fromEntries(Object.entries(allBases).filter(([key]) => !expired.has(key))) : allBases
      const pick = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => file.keys(key)))
      const result = mergeTable({
        local: toSyncRows(pick(localRows), context.deviceId),
        remote: remoteEnvelope,
        bases: pick(bases),
        localDeleted: pick(localDeleted),
        rules: table.rules,
        isPristine: table.isPristine
          ? (key, row) => Boolean(table.isPristine?.(key, { v: row.v, u: row.u }))
          : undefined,
        askOnRemoteDelete: table.askOnRemoteDelete,
        now: context.now(),
        deviceId: context.deviceId,
      })

      const upsertCount = Object.keys(result.localUpserts).length
      if (upsertCount || result.localDeletes.length) {
        await table.apply(ctx, { upserts: result.localUpserts, deletes: result.localDeletes })
        changedLocally = true
        report.appliedRows += upsertCount
        report.deletedRows += result.localDeletes.length
      }
      if (result.pendingDeletes.length) {
        await table.onPendingDeletes?.(ctx, result.pendingDeletes)
        report.pendingDeletes.push(...result.pendingDeletes.map(item => item.key))
      }
      if (result.conflicts.length) {
        await table.onConflicts?.(ctx, result.conflicts)
        report.conflicts.push(...result.conflicts)
      }

      // 待確認的刪除：遠端墓碑留著，本機那列不上傳（未確認前不復活，設計 3）。
      const outgoingRows = { ...result.rows }
      for (const pending of result.pendingDeletes) delete outgoingRows[pending.key]
      const outgoing: SyncEnvelope = {
        format: ALMANAC_SYNC_FORMAT,
        table: table.name,
        version: ALMANAC_SYNC_VERSION,
        updatedAt: context.now(),
        updatedBy: context.deviceId,
        rows: outgoingRows,
        deleted: result.deleted,
      }
      const outgoingHash = envelopeContentHash(outgoing)
      let version = current?.version ?? null
      if (!current || outgoingHash !== envelopeContentHash(remoteEnvelope)) {
        const written = await remote.write(file.path, serializeEnvelope(outgoing), { version })
        version = written.version
        report.uploadedFiles.push(file.path)
        if (index && file.bucket) {
          index.buckets[file.bucket] = { hash: outgoingHash, count: Object.keys(outgoingRows).length }
          indexChanged = true
        }
      } else if (index && file.bucket && index.buckets[file.bucket]?.hash !== outgoingHash) {
        index.buckets[file.bucket] = { hash: outgoingHash, count: Object.keys(outgoingRows).length }
        indexChanged = true
      }

      // 上傳成功（或內容本來就一致）且本機已寫回 → 更新基準與檔案狀態。
      const nextBases: Record<string, RowBase> = {}
      for (const [key, row] of Object.entries(result.rows)) nextBases[key] = buildRowBase(row.v, table.rules)
      const removals = [...new Set([...fileBaseKeys, ...Object.keys(result.deleted), ...result.localDeletes])]
        .filter(key => !nextBases[key] && !result.pendingDeletes.some(item => item.key === key))
      await saveBases(context.db, scope, table.name, nextBases, removals, context.now())
      await setFileState(context.db, scope, file.path, { hash: outgoingHash, version }, context.now())
    }

    if (index && indexChanged) {
      const written = await remote.write(indexPath, `${JSON.stringify(index, null, 2)}\n`, { version: indexVersion })
      indexVersion = written.version
      report.uploadedFiles.push(indexPath)
    }
    if (await table.afterMerge?.(ctx)) changedLocally = true
  })
  return changedLocally
}

// ---------- 只能新增的表 ----------

interface AppendFile<E> {
  format: typeof ALMANAC_SYNC_FORMAT
  table: string
  version: number
  device: string
  entries: E[]
}

interface AppendIndex {
  format: typeof ALMANAC_SYNC_FORMAT
  table: string
  version: number
  device: string
  months: Record<string, { hash: string; count: number }>
}

function parseAppendJson<T extends { format?: unknown; table?: unknown }>(content: string | null, table: string, path: string): T | null {
  if (!content) return null
  let parsed: T
  try {
    parsed = JSON.parse(content) as T
  } catch {
    throw new Error(`SYNC_DATA_INVALID_JSON: almanac ${path}`)
  }
  if (parsed.format !== ALMANAC_SYNC_FORMAT || parsed.table !== table) throw new Error(`SYNC_DATA_INVALID_SCHEMA: almanac ${path}`)
  return parsed
}

async function syncAppendTable(
  context: AlmanacSyncContext,
  table: AlmanacAppendTable,
  devices: AlmanacDevicesDoc | null,
  report: AlmanacTableReport,
): Promise<boolean> {
  const remote = context.remotes[table.layer]
  if (!remote) {
    report.skipped = `no ${table.layer} remote`
    return false
  }
  const scope = scopeFor(context, table.layer)
  const ctx = tableContext(context)
  let changedLocally = false
  const deviceDir = (deviceId: string, ...parts: string[]) => joinPath(table.layer, table.dir, deviceId, ...parts)

  // 1. 傳出這台自己的紀錄：只有這台會寫這些檔，所以不會有寫入衝突。
  const startedAt = context.now()
  const keep = <E extends AppendEntry>(entries: E[]) => (table.retain ? entries.filter(entry => table.retain?.(entry, startedAt)) : entries)
  const own = keep(await table.readOwn(ctx))
  const byMonth = new Map<string, AppendEntry[]>()
  for (const entry of own) {
    const month = monthKey(entry.at)
    byMonth.set(month, [...(byMonth.get(month) ?? []), entry])
  }
  const indexPath = deviceDir(context.deviceId, 'index.json')
  const currentIndex = await remote.read(indexPath)
  const index: AppendIndex = parseAppendJson<AppendIndex>(currentIndex?.content ?? null, table.name, indexPath)
    ?? { format: ALMANAC_SYNC_FORMAT, table: table.name, version: ALMANAC_SYNC_VERSION, device: context.deviceId, months: {} }
  let indexChanged = false
  const recovered: AppendEntry[] = []
  for (const month of new Set([...byMonth.keys(), ...Object.keys(index.months)])) {
    const path = deviceDir(context.deviceId, `${month}.json`)
    const localEntries = byMonth.get(month) ?? []
    const state = await getFileState(context.db, scope, path)
    const localHash = hashString(stableStringify(mergeAppendEntries(localEntries)))
    if (state?.hash === localHash && index.months[month]?.hash === localHash) continue
    // 本機資料庫還原過時，遠端可能有這台以前寫、本機已遺失的紀錄：讀回來聯集。
    const current = await remote.read(path)
    const remoteFile = parseAppendJson<AppendFile<AppendEntry>>(current?.content ?? null, table.name, path)
    const remoteEntries = keep(remoteFile?.entries ?? [])
    const localUids = new Set(localEntries.map(entry => entry.uid))
    recovered.push(...remoteEntries.filter(entry => !localUids.has(entry.uid)))
    const merged = mergeAppendEntries(localEntries, remoteEntries)
    const hash = hashString(stableStringify(merged))
    let version = current?.version ?? null
    if (hash !== hashString(stableStringify(mergeAppendEntries(remoteEntries))) || !current) {
      const file: AppendFile<AppendEntry> = { format: ALMANAC_SYNC_FORMAT, table: table.name, version: ALMANAC_SYNC_VERSION, device: context.deviceId, entries: merged }
      version = (await withConflictRetry(async () => {
        const latest = await remote.read(path)
        return remote.write(path, `${JSON.stringify(file, null, 2)}\n`, { version: latest?.version ?? null })
      })).version
      report.uploadedFiles.push(path)
    }
    if (index.months[month]?.hash !== hash) {
      index.months[month] = { hash, count: merged.length }
      indexChanged = true
    }
    await setFileState(context.db, scope, path, { hash, version }, context.now())
  }
  if (indexChanged) {
    await withConflictRetry(async () => {
      const latest = await remote.read(indexPath)
      await remote.write(indexPath, `${JSON.stringify(index, null, 2)}\n`, { version: latest?.version ?? null })
    })
    report.uploadedFiles.push(indexPath)
  }
  if (recovered.length) {
    await table.applyRemote(ctx, mergeAppendEntries(recovered))
    report.appliedRows += recovered.length
    changedLocally = true
  }

  // 2. 收別台的紀錄：裝置清單來自 devices.json，每台的 index.json 列出它有哪些月份。
  const otherDevices = Object.keys(devices?.devices ?? {}).filter(id => id !== context.deviceId).sort()
  for (const deviceId of otherDevices) {
    const otherIndexPath = deviceDir(deviceId, 'index.json')
    const otherIndex = parseAppendJson<AppendIndex>((await remote.read(otherIndexPath))?.content ?? null, table.name, otherIndexPath)
    if (!otherIndex) continue
    for (const [month, info] of Object.entries(otherIndex.months).sort(([left], [right]) => left.localeCompare(right))) {
      const path = deviceDir(deviceId, `${month}.json`)
      const state = await getFileState(context.db, scope, path)
      if (state?.hash === info.hash) continue
      const current = await remote.read(path)
      const file = parseAppendJson<AppendFile<AppendEntry>>(current?.content ?? null, table.name, path)
      if (!file) continue
      const all = mergeAppendEntries(file.entries)
      const entries = keep(all)
      if (entries.length) {
        await table.applyRemote(ctx, entries)
        report.appliedRows += entries.length
        changedLocally = true
      }
      // 記檔案本身的雜湊（跟那台 index.json 的一致），過期而沒收的紀錄不會讓下一輪又重讀一次。
      await setFileState(context.db, scope, path, { hash: hashString(stableStringify(all)), version: current?.version ?? null }, context.now())
    }
  }
  return changedLocally
}

// ---------- 一輪 ----------

export async function runAlmanacSync(context: AlmanacSyncContext): Promise<AlmanacSyncReport> {
  await initAlmanacSyncTables(context.db)
  const { doc: devices, written: devicesWritten } = await syncDevices(context)
  const report: AlmanacSyncReport = { devices, devicesWritten, tables: [], changedLocally: false, uploadedFiles: [] }
  for (const table of context.tables) {
    const tableReport: AlmanacTableReport = { table: table.name, appliedRows: 0, deletedRows: 0, uploadedFiles: [], conflicts: [], pendingDeletes: [] }
    const changed = table.kind === 'rows'
      ? await syncRowsTable(context, table, tableReport)
      : await syncAppendTable(context, table, devices, tableReport)
    report.changedLocally ||= changed
    report.uploadedFiles.push(...tableReport.uploadedFiles)
    report.tables.push(tableReport)
  }
  return report
}

export type { SyncTombstone }
export { AlmanacRemoteConflictError }

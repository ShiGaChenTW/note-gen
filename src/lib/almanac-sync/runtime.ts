// Fork（almanac ALMNC-85.2 骨架）：V3 同步接進 App（auto-data-sync-queue 的 almanac 領域、開關、首次同步、主力裝置）。
// 核心流程在 engine.ts（不綁 Tauri）；這裡負責組 context：note.db、目前同步方式的遠端、裝置編號、筆記庫路徑、註冊的表。
//
// 開關 almanacV3Sync 是裝置層級設定，UAT 通過前預設關（設計第 4 節整體回滾）。
// 第一次開（M8～M10）：先做一次受管備份 → 建同步表 → 排 almanac 任務（先拉、再合併、再推；本機只有預設值的列讓位給遠端）。
// 首次上傳成功後，註冊的表接手的 store key 才加進設定同步排除清單（M9）；關掉 V3 同步就恢復原狀。
'use client'

import { Store } from '@tauri-apps/plugin-store'
import emitter from '@/lib/emitter'
import { getOrCreateSyncDeviceId } from '@/lib/sync/deletion-tombstones'
import { setAlmanacLaneExcludedFields } from '@/config/sync-exclusions'
import { runAlmanacSync, type AlmanacSyncContext, type AlmanacSyncReport } from './engine'
import { createRemoteLibraryAlmanacRemote, type AlmanacRemote } from './remote'
import { getAlmanacSyncStoreKeys, getAlmanacSyncTables } from './tables/registry'
import { initAlmanacSyncTables } from './sql'
import { checkDeviceVersions, isPrimaryDevice, isPrimaryStale, type AlmanacDevicesDoc, type OutdatedDevice, type PrimaryDeviceRequest } from './devices'
import { ALMANAC_SYNC_VERSION } from './envelope'

export const ALMANAC_V3_SYNC_KEY = 'almanacV3Sync'
export const ALMANAC_V3_SYNC_FIRST_COMPLETED_KEY = 'almanacV3SyncFirstCompletedAt'
export const ALMANAC_V3_SYNC_LANE_KEYS_KEY = 'almanacV3SyncLaneKeys'
export const ALMANAC_PRIMARY_REQUEST_KEY = 'almanacPrimaryDeviceRequest'
export const ALMANAC_DEVICES_CACHE_KEY = 'almanacDevicesCache'

const FILE_SYNC_PLATFORMS = new Set(['github', 'gitee', 'gitlab', 'gitea', 's3', 'webdav', 'cloudFolder'])
/** ALMNC-85.5：自架同步也支援 V3 同步（一個同步檔＝一個 setting 物件，見 self-hosted-remote.ts） */
const ALMANAC_SYNC_PLATFORMS = new Set([...FILE_SYNC_PLATFORMS, 'selfHosted'])

async function loadStore() {
  return Store.load('store.json')
}

export async function isAlmanacV3SyncEnabled(): Promise<boolean> {
  return await (await loadStore()).get<boolean>(ALMANAC_V3_SYNC_KEY) === true
}

async function resolveDeviceName(): Promise<string> {
  try {
    const os = await import('@tauri-apps/plugin-os')
    return (await os.hostname()) || os.platform()
  } catch {
    return 'NoteGen'
  }
}

async function resolveAppVersion(): Promise<string | undefined> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    return await getVersion()
  } catch {
    return undefined
  }
}

async function createLibraryRemote(): Promise<AlmanacRemote | null> {
  try {
    return await createRemoteLibraryAlmanacRemote('library')
  } catch {
    return null
  }
}

/** 啟動時恢復 M9 的設定排除（只有 V3 同步開著且首次上傳成功過才排除） */
export async function applyAlmanacLaneExclusionsFromStore(): Promise<void> {
  const store = await loadStore()
  const enabled = await store.get<boolean>(ALMANAC_V3_SYNC_KEY) === true
  const firstCompletedAt = await store.get<number>(ALMANAC_V3_SYNC_FIRST_COMPLETED_KEY)
  const laneKeys = await store.get<string[]>(ALMANAC_V3_SYNC_LANE_KEYS_KEY)
  setAlmanacLaneExcludedFields(enabled && firstCompletedAt && Array.isArray(laneKeys) ? laneKeys : [])
}

export interface AlmanacSyncTaskResult {
  /** false：這次沒做（V3 同步關著、同步方式不支援） */
  ran: boolean
  /** 有寫到遠端：呼叫端才更新 meta.json 的 almanac 領域狀態 */
  uploaded: boolean
}

/**
 * auto-data-sync-queue 的 almanac 任務。錯誤直接丟出，交給佇列的重試與 failed 狀態。
 */
export async function runAlmanacSyncTask(reason: string): Promise<AlmanacSyncTaskResult> {
  const skipped = { ran: false, uploaded: false }
  const store = await loadStore()
  if (await store.get<boolean>(ALMANAC_V3_SYNC_KEY) !== true) return skipped
  const platform = await store.get<string>('primaryBackupMethod') || 'github'
  if (!ALMANAC_SYNC_PLATFORMS.has(platform)) return skipped

  let remotes: AlmanacSyncContext['remotes']
  if (platform === 'selfHosted') {
    // 先讓自架 runtime 收件一次，快取裡才有別台最新寫的 almanac 物件；沒有綁定個人資料工作區（還沒連線）就不跑。
    const { createSelfHostedAlmanacRemotes, refreshSelfHostedRemoteObjects } = await import('./self-hosted-transport')
    await refreshSelfHostedRemoteObjects()
    remotes = await createSelfHostedAlmanacRemotes()
    if (!remotes.account) return skipped
  } else {
    remotes = { account: await createRemoteLibraryAlmanacRemote('account'), library: await createLibraryRemote() }
  }

  const { getDb } = await import('@/db/index')
  const db = await getDb()
  await initAlmanacSyncTables(db)
  const firstSync = !await store.get<number>(ALMANAC_V3_SYNC_FIRST_COMPLETED_KEY)
  const primaryRequest = await store.get<PrimaryDeviceRequest>(ALMANAC_PRIMARY_REQUEST_KEY) ?? null
  // 85.2：資料源、RSS 訂閱、提案三張表（依序：先資料源、再 feeds.json、再 proposals.json）；
  // 85.3：夥伴（crew.json）、活動紀錄、ops（筆記庫層）。
  const { registerAlmanacAppTables } = await import('./tables/app')
  registerAlmanacAppTables()
  const tables = getAlmanacSyncTables()

  const report: AlmanacSyncReport = await runAlmanacSync({
    db,
    deviceId: await getOrCreateSyncDeviceId(),
    deviceName: await resolveDeviceName(),
    appVersion: await resolveAppVersion(),
    now: () => Date.now(),
    remotes,
    libraryScope: await store.get<string>('workspacePath') || '',
    tables,
    firstSync,
    primaryRequest,
  })

  if (report.devices) await store.set(ALMANAC_DEVICES_CACHE_KEY, report.devices)
  if (primaryRequest && report.devices && report.devices.primaryChangedAt >= primaryRequest.at) {
    await store.delete(ALMANAC_PRIMARY_REQUEST_KEY)
  }
  if (firstSync) await store.set(ALMANAC_V3_SYNC_FIRST_COMPLETED_KEY, Date.now())
  const laneKeys = getAlmanacSyncStoreKeys(tables)
  await store.set(ALMANAC_V3_SYNC_LANE_KEYS_KEY, laneKeys)
  await store.save()
  setAlmanacLaneExcludedFields(laneKeys)

  if (report.changedLocally) {
    emitter.emit('almanac-sync-applied', { tables: report.tables.filter(table => table.appliedRows || table.deletedRows).map(table => table.table) })
  }
  emitter.emit('almanac-sync-state-changed', undefined)
  void reason
  return { ran: true, uploaded: report.uploadedFiles.length > 0 || report.devicesWritten }
}

// ---------- 自架模式的排程（ALMNC-85.5） ----------
// 自架同步不走 auto-data-sync-queue（佇列在自架模式一律交給自架 runtime），所以 almanac 領域另有一個小排程：
// 本機改了、別台的 almanac 物件收到了、App 啟動，都排一輪；同時間只跑一輪，跑的時候又有人排就再跑一次。

const SELF_HOSTED_ALMANAC_DEBOUNCE_MS = 500
let selfHostedTimer: ReturnType<typeof setTimeout> | null = null
let selfHostedRunning: Promise<void> | null = null
let selfHostedRerun = false
let selfHostedLastError: string | null = null

export function getSelfHostedAlmanacSyncError(): string | null {
  return selfHostedLastError
}

async function runSelfHostedAlmanacRound(reason: string) {
  do {
    selfHostedRerun = false
    try {
      await runAlmanacSyncTask(reason)
      selfHostedLastError = null
    } catch (error) {
      selfHostedLastError = error instanceof Error ? error.message : String(error)
      console.warn('[almanac-sync] self-hosted round failed', { reason, error: selfHostedLastError })
      emitter.emit('almanac-sync-state-changed', undefined)
    }
  } while (selfHostedRerun)
}

/** 自架模式下排一輪 V3 同步（防抖 500ms）。V3 同步沒開或不是自架模式時 runAlmanacSyncTask 自己會略過。 */
export function scheduleSelfHostedAlmanacSync(reason: string, delayMs = SELF_HOSTED_ALMANAC_DEBOUNCE_MS): void {
  if (selfHostedTimer) clearTimeout(selfHostedTimer)
  selfHostedTimer = setTimeout(() => {
    selfHostedTimer = null
    if (selfHostedRunning) {
      selfHostedRerun = true
      return
    }
    selfHostedRunning = runSelfHostedAlmanacRound(reason).finally(() => { selfHostedRunning = null })
  }, delayMs)
}

/** 測試用：等目前排定與執行中的一輪結束 */
export async function flushSelfHostedAlmanacSyncForTest(): Promise<void> {
  if (selfHostedTimer) {
    clearTimeout(selfHostedTimer)
    selfHostedTimer = null
    selfHostedRunning ??= runSelfHostedAlmanacRound('flush').finally(() => { selfHostedRunning = null })
  }
  await selfHostedRunning
}

export interface EnableAlmanacV3SyncResult {
  ok: boolean
  error?: string
}

/**
 * 打開 V3 同步（M8～M10）。第一次開之前先做一次受管備份（含 note.db 快照）；備份失敗就不開，
 * 因為首次合併會改寫本機資料，沒有備份就沒有完整退路。
 */
export async function enableAlmanacV3Sync(options: { createBackup?: () => Promise<unknown> } = {}): Promise<EnableAlmanacV3SyncResult> {
  const store = await loadStore()
  const alreadyCompleted = Boolean(await store.get<number>(ALMANAC_V3_SYNC_FIRST_COMPLETED_KEY))
  if (!alreadyCompleted) {
    try {
      if (options.createBackup) await options.createBackup()
      else {
        const { createManagedBackup } = await import('@/lib/backup/managed-backup')
        await createManagedBackup('pre-v3-sync')
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const { getDb } = await import('@/db/index')
  await initAlmanacSyncTables(await getDb())
  await store.set(ALMANAC_V3_SYNC_KEY, true)
  await store.save()
  emitter.emit('almanac-sync-state-changed', undefined)
  const { enqueueAutoDataSync } = await import('@/lib/sync/auto-data-sync-queue')
  enqueueAutoDataSync('almanac', alreadyCompleted ? 'almanac-enabled' : 'almanac-first-sync', 'manual')
  return { ok: true }
}

/**
 * 關掉 V3 同步：停止讀寫 .data/almanac/、.almanac/v3/，設定排除恢復原狀（這些 key 回到設定同步）。
 * 基準表留著；下次再開時只要遠端沒換，就接著用。
 */
export async function disableAlmanacV3Sync(): Promise<void> {
  const store = await loadStore()
  await store.set(ALMANAC_V3_SYNC_KEY, false)
  await store.save()
  setAlmanacLaneExcludedFields([])
  emitter.emit('almanac-sync-state-changed', undefined)
}

export async function getCachedAlmanacDevices(): Promise<AlmanacDevicesDoc | null> {
  return await (await loadStore()).get<AlmanacDevicesDoc>(ALMANAC_DEVICES_CACHE_KEY) ?? null
}

/** 指定主力裝置（預設這台）；下一輪 almanac 同步寫進 devices.json，兩台同時改時較晚的贏。 */
export async function requestAlmanacPrimaryDevice(deviceId?: string): Promise<void> {
  const store = await loadStore()
  const request: PrimaryDeviceRequest = { deviceId: deviceId ?? await getOrCreateSyncDeviceId(), at: Date.now() }
  await store.set(ALMANAC_PRIMARY_REQUEST_KEY, request)
  // 先在本機快取反映，畫面與背景工作判斷立即生效；同步失敗時下一輪重送。
  const cached = await store.get<AlmanacDevicesDoc>(ALMANAC_DEVICES_CACHE_KEY)
  if (cached) {
    await store.set(ALMANAC_DEVICES_CACHE_KEY, { ...cached, primaryDeviceId: request.deviceId, primaryChangedAt: request.at })
  }
  await store.save()
  emitter.emit('almanac-sync-state-changed', undefined)
  if (await store.get<boolean>(ALMANAC_V3_SYNC_KEY) === true) {
    const { enqueueAutoDataSync } = await import('@/lib/sync/auto-data-sync-queue')
    enqueueAutoDataSync('almanac', 'almanac-primary-device', 'manual')
  }
}

/**
 * 背景工作（RSS 自動抓、指揮官自動分析、每週整理、研究員）跑之前問這個（第 8 節 1A）。
 * V3 同步沒開時一律 true（只有這一台）。85.2 起各背景工作接上這個判斷。
 */
export async function isThisDeviceAlmanacPrimary(): Promise<boolean> {
  if (!await isAlmanacV3SyncEnabled()) return true
  return isPrimaryDevice(await getCachedAlmanacDevices(), await getOrCreateSyncDeviceId())
}

export interface AlmanacSyncStatus {
  enabled: boolean
  firstCompletedAt: number | null
  deviceId: string
  devices: AlmanacDevicesDoc | null
  isPrimary: boolean
  primaryStale: boolean
  /** 版本比這台舊的其他裝置（可能不認得 V3 資料，ALMNC-85.5）；舊的 status 物件可能沒有這欄 */
  outdatedDevices?: OutdatedDevice[]
  /** 有別台比這台新：這台該升級 */
  selfOutdated?: boolean
}

export async function getAlmanacSyncStatus(now = Date.now()): Promise<AlmanacSyncStatus> {
  const store = await loadStore()
  const enabled = await store.get<boolean>(ALMANAC_V3_SYNC_KEY) === true
  const deviceId = await getOrCreateSyncDeviceId()
  const devices = await store.get<AlmanacDevicesDoc>(ALMANAC_DEVICES_CACHE_KEY) ?? null
  const versions = checkDeviceVersions(enabled ? devices : null, { deviceId, appVersion: await resolveAppVersion(), syncVersion: ALMANAC_SYNC_VERSION })
  return {
    enabled,
    firstCompletedAt: await store.get<number>(ALMANAC_V3_SYNC_FIRST_COMPLETED_KEY) ?? null,
    deviceId,
    devices,
    isPrimary: !enabled || isPrimaryDevice(devices, deviceId),
    primaryStale: enabled && isPrimaryStale(devices, deviceId, now),
    outdatedDevices: versions.outdated,
    selfOutdated: versions.selfOutdated,
  }
}

// Fork（almanac ALMNC-85.2 骨架）：devices.json 與主力裝置（設計 1.8、第 8 節 1A）。
// 背景工作（RSS 自動抓、指揮官自動分析、每週整理、研究員）只在主力裝置跑；預設是第一台開 V3 同步的裝置，設定頁可以改。
// 主力裝置超過 3 天沒出現，其他裝置提示「要不要改由這台跑」，不自動搶。

export const ALMANAC_DEVICES_PATH = 'devices.json'
export const ALMANAC_DEVICES_FORMAT = 'almanac-v3-devices'
export const PRIMARY_STALE_MS = 3 * 24 * 60 * 60 * 1000
/** lastSeenAt 太常更新會讓每次同步都多一次遠端寫入（Git 類是一個 commit），6 小時更新一次就夠提示用 */
export const LAST_SEEN_REFRESH_MS = 6 * 60 * 60 * 1000

export interface AlmanacDeviceInfo {
  name: string
  lastSeenAt: number
  appVersion?: string
}

export interface AlmanacDevicesDoc {
  format: typeof ALMANAC_DEVICES_FORMAT
  version: 1
  primaryDeviceId: string | null
  /** 主力裝置最後一次被指定的時間與裝置（兩台同時改時較晚的贏） */
  primaryChangedAt: number
  primaryChangedBy: string | null
  devices: Record<string, AlmanacDeviceInfo>
}

export interface PrimaryDeviceRequest {
  deviceId: string
  at: number
}

export function emptyDevicesDoc(): AlmanacDevicesDoc {
  return { format: ALMANAC_DEVICES_FORMAT, version: 1, primaryDeviceId: null, primaryChangedAt: 0, primaryChangedBy: null, devices: {} }
}

export function parseDevicesDoc(content: string | null): AlmanacDevicesDoc {
  if (!content) return emptyDevicesDoc()
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('SYNC_DATA_INVALID_JSON: almanac devices.json')
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { format?: unknown }).format !== ALMANAC_DEVICES_FORMAT) {
    throw new Error('SYNC_DATA_INVALID_SCHEMA: almanac devices.json')
  }
  const data = parsed as Partial<AlmanacDevicesDoc>
  const devices: Record<string, AlmanacDeviceInfo> = {}
  for (const [id, info] of Object.entries(data.devices ?? {})) {
    if (!info || typeof info !== 'object' || typeof info.lastSeenAt !== 'number') continue
    devices[id] = { name: typeof info.name === 'string' ? info.name : id, lastSeenAt: info.lastSeenAt, ...(typeof info.appVersion === 'string' ? { appVersion: info.appVersion } : {}) }
  }
  return {
    format: ALMANAC_DEVICES_FORMAT,
    version: 1,
    primaryDeviceId: typeof data.primaryDeviceId === 'string' ? data.primaryDeviceId : null,
    primaryChangedAt: typeof data.primaryChangedAt === 'number' ? data.primaryChangedAt : 0,
    primaryChangedBy: typeof data.primaryChangedBy === 'string' ? data.primaryChangedBy : null,
    devices,
  }
}

export interface MergeDevicesInput {
  remote: AlmanacDevicesDoc
  self: { deviceId: string; name: string; appVersion?: string }
  now: number
  /** 這台在設定頁按了「設為主力裝置」（或改指定別台），尚未傳出去 */
  primaryRequest?: PrimaryDeviceRequest | null
}

/**
 * 純函式：把這台的資訊與主力裝置指定併進遠端的 devices.json。
 * 沒有主力裝置時由這台認領（第一台開 V3 同步的裝置）；兩台同時指定時較晚的贏、同時間比裝置字串。
 */
export function mergeDevicesDoc(input: MergeDevicesInput): AlmanacDevicesDoc {
  const { remote, self, now, primaryRequest } = input
  const next: AlmanacDevicesDoc = { ...remote, devices: { ...remote.devices } }
  const known = remote.devices[self.deviceId]
  const needsRefresh = !known
    || now - known.lastSeenAt >= LAST_SEEN_REFRESH_MS
    || known.name !== self.name
    || (self.appVersion !== undefined && known.appVersion !== self.appVersion)
  if (needsRefresh) {
    next.devices[self.deviceId] = { name: self.name, lastSeenAt: now, ...(self.appVersion ? { appVersion: self.appVersion } : {}) }
  }

  if (primaryRequest) {
    const requestWins = primaryRequest.at > remote.primaryChangedAt
      || (primaryRequest.at === remote.primaryChangedAt && self.deviceId > (remote.primaryChangedBy ?? ''))
    if (requestWins) {
      next.primaryDeviceId = primaryRequest.deviceId
      next.primaryChangedAt = primaryRequest.at
      next.primaryChangedBy = self.deviceId
    }
  } else if (!remote.primaryDeviceId) {
    next.primaryDeviceId = self.deviceId
    next.primaryChangedAt = now
    next.primaryChangedBy = self.deviceId
  }
  return next
}

export function isPrimaryDevice(doc: AlmanacDevicesDoc | null, deviceId: string): boolean {
  // 還沒有 devices.json（V3 同步沒開）：這台就是唯一的裝置，照舊跑背景工作。
  if (!doc || !doc.primaryDeviceId) return true
  return doc.primaryDeviceId === deviceId
}

/** 主力裝置超過 3 天沒出現 → 其他裝置提示可以接手（不自動搶） */
export function isPrimaryStale(doc: AlmanacDevicesDoc | null, deviceId: string, now: number): boolean {
  if (!doc?.primaryDeviceId || doc.primaryDeviceId === deviceId) return false
  const primary = doc.devices[doc.primaryDeviceId]
  return !primary || now - primary.lastSeenAt > PRIMARY_STALE_MS
}

export function serializeDevicesDoc(doc: AlmanacDevicesDoc): string {
  const devices = Object.fromEntries(Object.keys(doc.devices).sort().map(id => [id, doc.devices[id]]))
  return `${JSON.stringify({ ...doc, devices }, null, 2)}\n`
}

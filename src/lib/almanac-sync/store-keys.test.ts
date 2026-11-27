// Fork（almanac ALMNC-85.2 骨架）：writeSyncedStoreKey 依 key 決定同步領域；M9 換跑道只在 runtime 設定後生效。
import { afterEach, describe, expect, it, vi } from 'vitest'

const storeData = new Map<string, unknown>()
const enqueue = vi.fn()

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: async () => ({
      get: async (key: string) => storeData.get(key),
      set: async (key: string, value: unknown) => { storeData.set(key, value) },
      delete: async (key: string) => { storeData.delete(key) },
      save: async () => undefined,
    }),
  },
}))
vi.mock('@/lib/sync/auto-data-sync-queue', () => ({ enqueueAutoDataSync: (...args: unknown[]) => enqueue(...args) }))

import { resolveStoreKeySyncDomain, writeSyncedStoreKey } from './store-keys'
import { setAlmanacLaneExcludedFields, shouldExcludeFromSync } from '@/config/sync-exclusions'
import { isPrimaryDevice, isPrimaryStale, mergeDevicesDoc, emptyDevicesDoc, PRIMARY_STALE_MS } from './devices'

afterEach(() => {
  setAlmanacLaneExcludedFields([])
  storeData.clear()
  enqueue.mockReset()
})

describe('writeSyncedStoreKey', () => {
  it('帳號層級 key → settings；裝置層級 key → 不排上傳', async () => {
    expect(await writeSyncedStoreKey('almanacAutoOrganize', true)).toBe('settings')
    expect(enqueue).toHaveBeenCalledWith('settings', 'store:almanacAutoOrganize')
    expect(storeData.get('almanacAutoOrganize')).toBe(true)
    expect(await writeSyncedStoreKey('almanacV3Sync', true)).toBeNull()
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('換跑道後的 key → almanac，且設定同步排除它；清空後回到設定同步', () => {
    expect(resolveStoreKeySyncDomain('almanacRssFeeds')).toBe('settings')
    setAlmanacLaneExcludedFields(['almanacRssFeeds'])
    expect(resolveStoreKeySyncDomain('almanacRssFeeds')).toBe('almanac')
    expect(shouldExcludeFromSync('almanacRssFeeds')).toBe(true)
    setAlmanacLaneExcludedFields([])
    expect(shouldExcludeFromSync('almanacRssFeeds')).toBe(false)
  })
})

describe('devices.json 與主力裝置', () => {
  it('沒有主力裝置時由這台認領；已有就不搶', () => {
    const first = mergeDevicesDoc({ remote: emptyDevicesDoc(), self: { deviceId: 'dev-a', name: 'A' }, now: 10 })
    expect(first.primaryDeviceId).toBe('dev-a')
    const second = mergeDevicesDoc({ remote: first, self: { deviceId: 'dev-b', name: 'B' }, now: 20 })
    expect(second.primaryDeviceId).toBe('dev-a')
    expect(isPrimaryDevice(second, 'dev-b')).toBe(false)
  })

  it('兩台同時指定主力裝置 → 較晚的贏', () => {
    const doc = { ...emptyDevicesDoc(), primaryDeviceId: 'dev-a', primaryChangedAt: 50, primaryChangedBy: 'dev-a' }
    expect(mergeDevicesDoc({ remote: doc, self: { deviceId: 'dev-b', name: 'B' }, now: 60, primaryRequest: { deviceId: 'dev-b', at: 40 } }).primaryDeviceId).toBe('dev-a')
    expect(mergeDevicesDoc({ remote: doc, self: { deviceId: 'dev-b', name: 'B' }, now: 60, primaryRequest: { deviceId: 'dev-b', at: 55 } }).primaryDeviceId).toBe('dev-b')
  })

  it('主力裝置超過 3 天沒出現 → 提示（不自動搶）；沒開 V3 同步時這台就是主力', () => {
    const doc = { ...emptyDevicesDoc(), primaryDeviceId: 'dev-a', devices: { 'dev-a': { name: 'A', lastSeenAt: 0 } } }
    expect(isPrimaryStale(doc, 'dev-b', PRIMARY_STALE_MS + 1)).toBe(true)
    expect(isPrimaryStale(doc, 'dev-a', PRIMARY_STALE_MS + 1)).toBe(false)
    expect(isPrimaryDevice(null, 'dev-b')).toBe(true)
  })
})

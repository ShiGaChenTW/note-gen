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

import { enqueueStoreKeySync, resolveStoreKeySyncDomain, writeSyncedStoreKey } from './store-keys'
import { notifyStoreKeyWritten } from './notify'
import { filterSyncData, mergeSyncData, setAlmanacLaneExcludedFields, shouldExcludeFromSync } from '@/config/sync-exclusions'
import { PROPOSAL_STORE_KEYS } from './tables/proposals'
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

// Fork（almanac ALMNC-85.4，設計 2.16、第 8 節 4A）
const DEVICE_KEYS = [
  'almanacUiMode',
  'almanacSidebarVaultCollapsed',
  'almanacSidebarAgentsCollapsed',
  'almanacJobCardsV1',
  'almanacReviewLastRun',
  'almanacExplorationResearchUsage',
  'almanacAwaitingRemote',
]
const ACCOUNT_KEYS = ['almanacAutoAcceptLinks', 'almanacAutoOrganize', 'almanacReviewSettings', 'threadProjects', 'threadTags']

describe('V3 設定 key 的分類（85.4 #3）', () => {
  it.each(DEVICE_KEYS)('裝置層級 %s：設定同步排除、寫入不排上傳', async key => {
    expect(shouldExcludeFromSync(key)).toBe(true)
    expect(shouldExcludeFromSync(key, { excludeSensitiveConfig: false })).toBe(true)
    expect(resolveStoreKeySyncDomain(key)).toBeNull()
    expect(await enqueueStoreKeySync(key)).toBeNull()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it.each(ACCOUNT_KEYS)('帳號層級 %s：留在設定同步，寫入後排 settings', async key => {
    expect(shouldExcludeFromSync(key)).toBe(false)
    expect(await enqueueStoreKeySync(key)).toBe('settings')
    expect(enqueue).toHaveBeenCalledWith('settings', `store:${key}`)
  })

  it('先放著、等你回話：V3 同步接手後排 almanac（逐筆合併），沒接手前照舊走 settings', async () => {
    expect(PROPOSAL_STORE_KEYS).toEqual(expect.arrayContaining(['workbenchAside', 'awaitingReplies']))
    expect(await enqueueStoreKeySync('workbenchAside')).toBe('settings')
    setAlmanacLaneExcludedFields(PROPOSAL_STORE_KEYS)
    expect(await enqueueStoreKeySync('workbenchAside')).toBe('almanac')
    expect(await enqueueStoreKeySync('awaitingReplies')).toBe('almanac')
    expect(shouldExcludeFromSync('awaitingReplies')).toBe(true)
  })

  it('notifyStoreKeyWritten：fork 程式自己存檔後呼叫，照 key 排上傳', async () => {
    notifyStoreKeyWritten('threadTags')
    notifyStoreKeyWritten('almanacUiMode')
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledWith('settings', 'store:threadTags'))
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('A 切到舊介面、收合側欄 → 設定同步到 B 後，B 的介面模式與側欄不變；帳號層級設定照常跟過去', () => {
    const deviceA = { almanacUiMode: 'v2', almanacSidebarVaultCollapsed: true, almanacReviewLastRun: 200, almanacAutoOrganize: false, threadTags: { 'sync-1': 'work' } }
    const deviceB = { almanacUiMode: 'v3', almanacSidebarVaultCollapsed: false, almanacReviewLastRun: 100, almanacAutoOrganize: true, threadTags: {} }
    const uploaded = filterSyncData(deviceA)
    expect(Object.keys(uploaded).sort()).toEqual(['almanacAutoOrganize', 'threadTags'])
    const merged = mergeSyncData(deviceB, uploaded)
    expect(merged).toEqual({ almanacUiMode: 'v3', almanacSidebarVaultCollapsed: false, almanacReviewLastRun: 100, almanacAutoOrganize: false, threadTags: { 'sync-1': 'work' } })
    // 就算遠端的設定檔裡還留著舊版寫進去的 almanacUiMode，B 收到也忽略。
    expect(mergeSyncData(deviceB, { almanacUiMode: 'v2' } as Partial<typeof deviceB>).almanacUiMode).toBe('v3')
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

// Fork（almanac ALMNC-85.5 #1）：自架模式下 runAlmanacSyncTask 不再略過；先讓自架 runtime 收件，再用自架遠端跑一輪。
// 自架排程：短時間內排很多次只跑一輪；跑的途中又排就再跑一次。設定頁狀態帶出舊版裝置。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeData = new Map<string, unknown>()
const calls: string[] = []
const runAlmanacSync = vi.fn()
const refreshSelfHostedRemoteObjects = vi.fn(async () => { calls.push('refresh') })
const createSelfHostedAlmanacRemotes = vi.fn()

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
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.4.0' }))
vi.mock('@tauri-apps/plugin-os', () => ({ hostname: async () => 'Mac-A', platform: () => 'macos' }))
vi.mock('@/db/index', () => ({ getDb: async () => ({ execute: async () => ({ changes: 0 }), select: async () => [] }) }))
vi.mock('@/lib/sync/deletion-tombstones', () => ({ getOrCreateSyncDeviceId: async () => 'dev-a' }))
vi.mock('./sql', () => ({ initAlmanacSyncTables: async () => undefined }))
vi.mock('./tables/app', () => ({ registerAlmanacAppTables: () => undefined }))
vi.mock('./engine', () => ({ runAlmanacSync: (...args: unknown[]) => runAlmanacSync(...args) }))
vi.mock('./self-hosted-transport', () => ({ refreshSelfHostedRemoteObjects, createSelfHostedAlmanacRemotes }))
vi.mock('./remote', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remote')>()),
  createRemoteLibraryAlmanacRemote: vi.fn(async () => { throw new Error('file remote must not be used in self-hosted mode') }),
}))

const runtime = await import('./runtime')

const emptyReport = { devices: null, devicesWritten: false, tables: [], changedLocally: false, uploadedFiles: [] }

beforeEach(() => {
  storeData.clear()
  calls.length = 0
  runAlmanacSync.mockReset()
  runAlmanacSync.mockImplementation(async () => { calls.push('engine'); return emptyReport })
  refreshSelfHostedRemoteObjects.mockClear()
  createSelfHostedAlmanacRemotes.mockReset()
  createSelfHostedAlmanacRemotes.mockImplementation(async () => ({ account: { name: 'account' }, library: { name: 'library' } }))
  storeData.set('primaryBackupMethod', 'selfHosted')
  storeData.set('almanacV3Sync', true)
})

describe('runAlmanacSyncTask：自架模式', () => {
  it('先收件、再用自架的帳號層與筆記庫層遠端跑 engine', async () => {
    const result = await runtime.runAlmanacSyncTask('test')
    expect(result.ran).toBe(true)
    expect(calls).toEqual(['refresh', 'engine'])
    const context = runAlmanacSync.mock.calls[0][0] as { remotes: unknown; appVersion: string }
    expect(context.remotes).toEqual({ account: { name: 'account' }, library: { name: 'library' } })
    expect(context.appVersion).toBe('1.4.0')
  })

  it('還沒連上自架伺服器（沒有個人資料工作區）→ 略過，不跑 engine', async () => {
    createSelfHostedAlmanacRemotes.mockResolvedValue({ account: null, library: null })
    await expect(runtime.runAlmanacSyncTask('test')).resolves.toEqual({ ran: false, uploaded: false })
    expect(runAlmanacSync).not.toHaveBeenCalled()
  })

  it('V3 同步關著 → 略過', async () => {
    storeData.set('almanacV3Sync', false)
    await expect(runtime.runAlmanacSyncTask('test')).resolves.toEqual({ ran: false, uploaded: false })
    expect(refreshSelfHostedRemoteObjects).not.toHaveBeenCalled()
  })
})

describe('scheduleSelfHostedAlmanacSync', () => {
  it('短時間內排很多次只跑一輪', async () => {
    vi.useFakeTimers()
    try {
      runtime.scheduleSelfHostedAlmanacSync('a')
      runtime.scheduleSelfHostedAlmanacSync('b')
      runtime.scheduleSelfHostedAlmanacSync('c')
      await vi.advanceTimersByTimeAsync(600)
      await runtime.flushSelfHostedAlmanacSyncForTest()
      expect(runAlmanacSync).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('跑的途中又排 → 跑完再跑一次；失敗時記下錯誤，不丟出', async () => {
    let release!: () => void
    runAlmanacSync.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(emptyReport) }))
    runAlmanacSync.mockImplementationOnce(async () => { throw new Error('boom') })
    runtime.scheduleSelfHostedAlmanacSync('first', 0)
    await vi.waitFor(() => expect(runAlmanacSync).toHaveBeenCalledTimes(1))
    runtime.scheduleSelfHostedAlmanacSync('second', 0)
    await new Promise(resolve => setTimeout(resolve, 5))
    release()
    await vi.waitFor(() => expect(runAlmanacSync).toHaveBeenCalledTimes(2))
    await runtime.flushSelfHostedAlmanacSyncForTest()
    expect(runtime.getSelfHostedAlmanacSyncError()).toBe('boom')
  })
})

describe('getAlmanacSyncStatus：舊版裝置', () => {
  it('devices.json 裡版本比這台舊的裝置列出來', async () => {
    storeData.set('almanacDevicesCache', {
      format: 'almanac-v3-devices', version: 1, primaryDeviceId: 'dev-a', primaryChangedAt: 1, primaryChangedBy: 'dev-a',
      devices: {
        'dev-a': { name: 'Mac-A', lastSeenAt: 1, appVersion: '1.4.0', syncVersion: 1 },
        'dev-b': { name: 'iPhone', lastSeenAt: 1, appVersion: '1.2.0', syncVersion: 1 },
      },
    })
    const status = await runtime.getAlmanacSyncStatus()
    expect(status.outdatedDevices).toEqual([{ deviceId: 'dev-b', name: 'iPhone', appVersion: '1.2.0' }])
    expect(status.selfOutdated).toBe(false)
  })
})

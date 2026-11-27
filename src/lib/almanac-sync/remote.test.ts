// ALMNC-95.3：雙裝置 E2E 抓到桌面版雲端資料夾的筆記庫層一律寫失敗（remote-library 的 'workspace' 範圍在桌面沒有實作）。
// 這裡鎖住修正：桌面雲端資料夾的筆記庫層改走同步資料夾（'data' 範圍）；OneDrive／Android 這類有筆記庫遠端的照舊走 'workspace'。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeValues = new Map<string, unknown>()
// 小小的遠端檔案表：寫進去的讀得回來（雲端資料夾的寫後重讀要用）
const remoteFiles = new Map<string, Uint8Array>()
let etagCounter = 0
const uploadRemoteBytes = vi.fn(async (path: string, bytes: Uint8Array) => {
  remoteFiles.set(path, bytes)
  return `etag-${++etagCounter}`
})
const getRemoteFileMetadata = vi.fn(async (path: string) => (remoteFiles.has(path) ? { version: `etag-${path}` } : null))
const downloadRemoteBytesWithVersion = vi.fn(async (path: string) => ({ content: remoteFiles.get(path)!, version: `etag-${path}` }))
const supportsCloudFolderWorkspace = vi.fn((config: { provider?: string }) => config.provider === 'oneDrive')

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async (key: string) => storeValues.get(key) }) },
}))
vi.mock('@/lib/sync/remote-library', () => ({
  uploadRemoteBytes,
  getRemoteFileMetadata,
  downloadRemoteBytesWithVersion,
}))
vi.mock('@/lib/sync/cloud-folder', () => ({ supportsCloudFolderWorkspace }))

const { createRemoteLibraryAlmanacRemote, resolveAlmanacRemoteScope } = await import('./remote')

beforeEach(() => {
  storeValues.clear()
  remoteFiles.clear()
  uploadRemoteBytes.mockClear()
  getRemoteFileMetadata.mockClear()
})

describe('resolveAlmanacRemoteScope', () => {
  it('帳號層一律用資料同步庫', async () => {
    await expect(resolveAlmanacRemoteScope('account', null)).resolves.toBe('data')
    await expect(resolveAlmanacRemoteScope('account', { path: '/cloud' })).resolves.toBe('data')
  })

  it('Git、S3、WebDAV 的筆記庫層用筆記庫遠端', async () => {
    await expect(resolveAlmanacRemoteScope('library', null)).resolves.toBe('workspace')
  })

  it('桌面雲端資料夾沒有筆記庫遠端：筆記庫層改放同步資料夾', async () => {
    await expect(resolveAlmanacRemoteScope('library', { path: '/Users/me/iCloud/Notes', provider: 'folder' })).resolves.toBe('data')
  })

  it('OneDrive 這類有筆記庫遠端的雲端資料夾照舊用筆記庫遠端', async () => {
    await expect(resolveAlmanacRemoteScope('library', { path: 'onedrive', provider: 'oneDrive' })).resolves.toBe('workspace')
  })
})

describe('createRemoteLibraryAlmanacRemote（雲端資料夾）', () => {
  it('桌面雲端資料夾的筆記庫層讀寫都走同步資料夾', async () => {
    storeValues.set('primaryBackupMethod', 'cloudFolder')
    storeValues.set('cloudFolderSyncConfig', { path: '/Users/me/iCloud/Notes' })
    const remote = await createRemoteLibraryAlmanacRemote('library')

    await expect(remote.read('.almanac/v3/ops/dev/index.json')).resolves.toBeNull()
    expect(getRemoteFileMetadata).toHaveBeenCalledWith('.almanac/v3/ops/dev/index.json', 'data', 'cloudFolder')

    await remote.write('.almanac/v3/moc-baselines.json', '{}', { version: null })
    expect(uploadRemoteBytes).toHaveBeenCalledWith(
      '.almanac/v3/moc-baselines.json', expect.any(Uint8Array), expect.any(String), 'application/json', 'data', undefined, 'cloudFolder',
    )
  })

  it('OneDrive 以外的雲端資料夾沒有條件寫入：寫前重讀比對、寫後重讀確認（ALMNC-85.5）', async () => {
    storeValues.set('primaryBackupMethod', 'cloudFolder')
    storeValues.set('cloudFolderSyncConfig', { path: '/Users/me/iCloud/Notes' })
    const remote = await createRemoteLibraryAlmanacRemote('account')
    await expect(remote.read('.data/almanac/demo.json')).resolves.toBeNull()
    getRemoteFileMetadata.mockClear()
    await remote.write('.data/almanac/demo.json', '{"a":1}', { version: null })
    // 寫前一次、寫後一次
    expect(getRemoteFileMetadata).toHaveBeenCalledTimes(2)
    // 別台在這台讀完之後寫了 → 這台寫入前就發現，丟衝突讓 engine 重合併
    remoteFiles.set('.data/almanac/demo.json', new TextEncoder().encode('{"b":2}'))
    await expect(remote.write('.data/almanac/demo.json', '{"a":2}', { version: 'etag-.data/almanac/demo.json' }))
      .rejects.toThrow(/SYNC_SWITCH_STALE/)
    expect(new TextDecoder().decode(remoteFiles.get('.data/almanac/demo.json'))).toBe('{"b":2}')
  })

  it('OneDrive 有條件寫入：直接帶 guard，不多讀', async () => {
    storeValues.set('primaryBackupMethod', 'cloudFolder')
    storeValues.set('cloudFolderSyncConfig', { path: 'onedrive', provider: 'oneDrive' })
    const remote = await createRemoteLibraryAlmanacRemote('account')
    await remote.write('.data/almanac/demo.json', '{}', { version: null })
    expect(getRemoteFileMetadata).not.toHaveBeenCalled()
    expect(uploadRemoteBytes).toHaveBeenCalledWith(
      '.data/almanac/demo.json', expect.any(Uint8Array), expect.any(String), 'application/json', 'data', { version: null }, 'cloudFolder',
    )
  })
})

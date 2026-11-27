// ALMNC-95.3：雙裝置 E2E 抓到桌面版雲端資料夾的筆記庫層一律寫失敗（remote-library 的 'workspace' 範圍在桌面沒有實作）。
// 這裡鎖住修正：桌面雲端資料夾的筆記庫層改走同步資料夾（'data' 範圍）；OneDrive／Android 這類有筆記庫遠端的照舊走 'workspace'。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeValues = new Map<string, unknown>()
const uploadRemoteBytes = vi.fn(async () => 'etag-1')
const getRemoteFileMetadata = vi.fn(async () => null)
const supportsCloudFolderWorkspace = vi.fn((config: { provider?: string }) => config.provider === 'oneDrive')

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async (key: string) => storeValues.get(key) }) },
}))
vi.mock('@/lib/sync/remote-library', () => ({
  uploadRemoteBytes,
  getRemoteFileMetadata,
  downloadRemoteBytesWithVersion: vi.fn(),
}))
vi.mock('@/lib/sync/cloud-folder', () => ({ supportsCloudFolderWorkspace }))

const { createRemoteLibraryAlmanacRemote, resolveAlmanacRemoteScope } = await import('./remote')

beforeEach(() => {
  storeValues.clear()
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
})

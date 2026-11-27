// Fork（almanac ALMNC-85.5 #2）：行動版「同步」設定頁也有 V3 跨裝置同步開關與主力裝置（沿用桌面的 AlmanacV3SyncSection）。
// 只 mock 測試邊界：Tauri 外掛、同步設定 store、各同步方式的連線面板（葉子元件，跟這張票無關）、almanac runtime 的狀態讀取。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderV3, screen } from '@/test/render-v3'
import type { AlmanacSyncStatus } from '@/lib/almanac-sync/runtime'

const storeValues = new Map<string, unknown>()
const settingState: Record<string, unknown> = {}
const getAlmanacSyncStatus = vi.fn<() => Promise<AlmanacSyncStatus>>()

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'ios', hostname: async () => 'iPhone' }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(async () => true) }))
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async (key: string) => storeValues.get(key) }) },
}))
vi.mock('@/stores/setting', () => {
  const useSettingStore = Object.assign(() => settingState, { getState: () => settingState })
  const useSettingsHydrationStore = Object.assign(
    (selector: (state: { status: string }) => unknown) => selector({ status: 'ready' }),
    { getState: () => ({ status: 'ready' }) },
  )
  return { default: useSettingStore, useSettingsHydrationStore }
})
vi.mock('@/stores/sync', () => {
  const state = { providerChecks: {}, selfHostedConnected: true, cloudFolderConnected: true }
  return { default: Object.assign(() => state, { getState: () => state }) }
})
vi.mock('@/stores/sync-platform-switch', () => ({
  restorePlatformSwitchRecovery: vi.fn(async () => undefined),
  usePlatformSwitchStore: { getState: () => ({ platform: null }) },
}))
vi.mock('@/lib/diagnostics/self-hosted', () => ({ hasConfiguredSelfHostedSync: vi.fn(async () => true) }))
vi.mock('@/lib/sync/provider-status', () => ({ checkSyncProviderStatus: vi.fn(async () => undefined) }))
vi.mock('@/lib/sync/workspace-repos', () => ({ getWorkspaceSyncRepos: vi.fn(async () => ({})) }))
vi.mock('@/lib/almanac-sync/runtime', () => ({
  getAlmanacSyncStatus: () => getAlmanacSyncStatus(),
  enableAlmanacV3Sync: vi.fn(async () => ({ ok: true })),
  disableAlmanacV3Sync: vi.fn(async () => undefined),
  requestAlmanacPrimaryDevice: vi.fn(async () => undefined),
}))
// 各同步方式的連線面板與無關的狀態列：葉子元件，換成空殼
const stub = (name: string) => ({ [name]: () => null })
vi.mock('@/app/core/setting/sync/github-sync', () => stub('GithubSync'))
vi.mock('@/app/core/setting/sync/gitee-sync', () => stub('GiteeSync'))
vi.mock('@/app/core/setting/sync/gitlab-sync', () => stub('GitlabSync'))
vi.mock('@/app/core/setting/sync/gitea-sync', () => stub('GiteaSync'))
vi.mock('@/app/core/setting/sync/s3-sync', () => stub('S3Sync'))
vi.mock('@/app/core/setting/sync/webdav-sync', () => stub('WebDAVSync'))
vi.mock('@/app/core/setting/sync/self-hosted-sync', () => stub('SelfHostedSync'))
vi.mock('@/app/core/setting/sync/self-hosted-personal-data-options', () => stub('SelfHostedPersonalDataOptions'))
vi.mock('@/app/core/setting/sync/components/use-platform-button', () => stub('UsePlatformButton'))
vi.mock('@/app/core/setting/sync/components/platform-switch-progress', () => stub('PlatformSwitchProgress'))
vi.mock('@/app/core/setting/sync/components/workspace-repo-mapping', () => stub('WorkspaceRepoMapping'))
vi.mock('@/app/core/setting/sync/components/data-sync-overview', () => stub('DataSyncOverview'))
vi.mock('@/app/mobile/setting/pages/sync/android-cloud-folder-sync', () => stub('OneDriveCloudFolderSync'))
vi.mock('@/app/mobile/setting/pages/sync/ios-cloud-folder-sync', () => stub('ICloudFolderSync'))
vi.mock('@/components/record-sync-status-banner', () => stub('RecordSyncStatusBanner'))

const { default: SyncPage } = await import('./page')

const status = (overrides: Partial<AlmanacSyncStatus> = {}): AlmanacSyncStatus => ({
  enabled: true,
  firstCompletedAt: 1,
  deviceId: 'dev-phone',
  devices: {
    format: 'almanac-v3-devices',
    version: 1,
    primaryDeviceId: 'dev-mac',
    primaryChangedAt: 1,
    primaryChangedBy: 'dev-mac',
    devices: { 'dev-mac': { name: 'Scott 的 MacBook', lastSeenAt: 1 }, 'dev-phone': { name: 'iPhone', lastSeenAt: 1 } },
  },
  isPrimary: false,
  primaryStale: false,
  ...overrides,
})

function usePlatform(method: string) {
  storeValues.clear()
  storeValues.set('primaryBackupMethod', method)
  Object.assign(settingState, {
    primaryBackupMethod: method,
    workspacePath: '/vault',
    workspaceHistory: [],
    autoSync: '0',
    developerMode: false,
    setAutoSync: vi.fn(),
  })
}

beforeEach(() => {
  getAlmanacSyncStatus.mockResolvedValue(status())
})

describe('行動版同步設定頁：V3 跨裝置同步', () => {
  it('自架同步：顯示 V3 同步開關、主力裝置，以及「改由這台跑背景工作」', async () => {
    usePlatform('selfHosted')
    renderV3(<SyncPage />)
    expect(await screen.findByRole('switch', { name: 'V3 跨裝置同步' })).toBeChecked()
    expect(await screen.findByText('主力裝置：Scott 的 MacBook')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '改由這台跑背景工作' })).toBeInTheDocument()
  })

  it('iCloud 雲端資料夾：一樣顯示；別台版本較舊時出提示', async () => {
    usePlatform('cloudFolder')
    storeValues.set('cloudFolderSyncConfig', { path: '/icloud', provider: 'folder' })
    getAlmanacSyncStatus.mockResolvedValue(status({ outdatedDevices: [{ deviceId: 'dev-mac', name: 'Scott 的 MacBook', appVersion: '0.27.1' }] }))
    renderV3(<SyncPage />)
    expect(await screen.findByRole('switch', { name: 'V3 跨裝置同步' })).toBeInTheDocument()
    expect(await screen.findByText(/Scott 的 MacBook（0\.27\.1）的 App 版本比這台舊/)).toBeInTheDocument()
  })

  it('本機（不同步）：不顯示 V3 同步開關', async () => {
    usePlatform('local')
    renderV3(<SyncPage />)
    expect(await screen.findByText('同步方式')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'V3 跨裝置同步' })).not.toBeInTheDocument()
  })
})

// Fork（almanac ALMNC-85.2 骨架）：設定頁同步區塊的 V3 同步開關與主力裝置（最小 UI）。
// ALMNC-85.5：舊版裝置提示；哪些同步方式顯示開關（自架也顯示，本機不顯示）。
import { describe, expect, it, vi } from 'vitest'
import { renderV3, screen } from '@/test/render-v3'
import type { AlmanacSyncStatus } from '@/lib/almanac-sync/runtime'

const getAlmanacSyncStatus = vi.fn<() => Promise<AlmanacSyncStatus>>()
vi.mock('@/lib/almanac-sync/runtime', () => ({
  getAlmanacSyncStatus: () => getAlmanacSyncStatus(),
  enableAlmanacV3Sync: vi.fn(async () => ({ ok: true })),
  disableAlmanacV3Sync: vi.fn(async () => undefined),
  requestAlmanacPrimaryDevice: vi.fn(async () => undefined),
}))

const { AlmanacV3SyncPanel, AlmanacV3SyncSlot } = await import('./almanac-v3-sync-panel')

const devices = (primary: string) => ({
  format: 'almanac-v3-devices' as const,
  version: 1 as const,
  primaryDeviceId: primary,
  primaryChangedAt: 1,
  primaryChangedBy: primary,
  devices: {
    'dev-a': { name: 'Scott 的 MacBook', lastSeenAt: 1 },
    'dev-b': { name: 'Mac mini', lastSeenAt: 1 },
  },
})

const status = (overrides: Partial<AlmanacSyncStatus> = {}): AlmanacSyncStatus => ({
  enabled: false,
  firstCompletedAt: null,
  deviceId: 'dev-a',
  devices: null,
  isPrimary: true,
  primaryStale: false,
  ...overrides,
})

describe('AlmanacV3SyncPanel', () => {
  it('關著時可以打開 V3 同步，並說明會先備份', async () => {
    const onToggle = vi.fn()
    const { user } = renderV3(<AlmanacV3SyncPanel status={status()} busy={false} error={null} onToggle={onToggle} onMakePrimary={vi.fn()} />)
    expect(screen.getByText(/第一次開啟前會先做一次備份/)).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'V3 跨裝置同步' })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(onToggle).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('button', { name: '改由這台跑背景工作' })).not.toBeInTheDocument()
  })

  it('開著且這台是主力裝置：顯示主力裝置名稱，不顯示接手按鈕', () => {
    renderV3(<AlmanacV3SyncPanel status={status({ enabled: true, firstCompletedAt: 1, devices: devices('dev-a') })} busy={false} error={null} onToggle={vi.fn()} onMakePrimary={vi.fn()} />)
    expect(screen.getByRole('switch', { name: 'V3 跨裝置同步' })).toBeChecked()
    expect(screen.getByText('主力裝置：Scott 的 MacBook（這台）')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '改由這台跑背景工作' })).not.toBeInTheDocument()
  })

  it('別台是主力裝置：可以改由這台跑背景工作；主力裝置太久沒出現時提示', async () => {
    const onMakePrimary = vi.fn()
    const { user } = renderV3(<AlmanacV3SyncPanel status={status({ enabled: true, firstCompletedAt: 1, devices: devices('dev-b'), isPrimary: false, primaryStale: true })} busy={false} error={null} onToggle={vi.fn()} onMakePrimary={onMakePrimary} />)
    expect(screen.getByText('主力裝置：Mac mini')).toBeInTheDocument()
    expect(screen.getByText(/超過 3 天沒有同步/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '改由這台跑背景工作' }))
    expect(onMakePrimary).toHaveBeenCalledOnce()
  })

  it('處理中時開關停用；有錯誤時顯示錯誤', () => {
    renderV3(<AlmanacV3SyncPanel status={status()} busy error="Backup directory is not configured" onToggle={vi.fn()} onMakePrimary={vi.fn()} />)
    expect(screen.getByRole('switch', { name: 'V3 跨裝置同步' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Backup directory is not configured')
  })

  it('別台版本比這台舊：列出裝置名稱與版本，提示先升級那台', () => {
    renderV3(<AlmanacV3SyncPanel status={status({
      enabled: true, firstCompletedAt: 1, devices: devices('dev-a'),
      outdatedDevices: [{ deviceId: 'dev-b', name: 'Mac mini', appVersion: '0.27.1' }],
    })} busy={false} error={null} onToggle={vi.fn()} onMakePrimary={vi.fn()} />)
    expect(screen.getByText('Mac mini（0.27.1）的 App 版本比這台舊，可能不認得 V3 資料。請先把那台升到最新版。')).toBeInTheDocument()
  })

  it('有別台比這台新：提示升級這台；沒有版本問題時不出提示', () => {
    const { unmount } = renderV3(<AlmanacV3SyncPanel status={status({ enabled: true, firstCompletedAt: 1, devices: devices('dev-a'), selfOutdated: true })} busy={false} error={null} onToggle={vi.fn()} onMakePrimary={vi.fn()} />)
    expect(screen.getByText(/有其他裝置的 App 版本比這台新/)).toBeInTheDocument()
    unmount()
    renderV3(<AlmanacV3SyncPanel status={status({ enabled: true, firstCompletedAt: 1, devices: devices('dev-a'), outdatedDevices: [] })} busy={false} error={null} onToggle={vi.fn()} onMakePrimary={vi.fn()} />)
    expect(screen.queryByText(/App 版本比這台/)).not.toBeInTheDocument()
  })

  it('V3 同步關著時不出版本提示（還沒開就不用升級提醒）', () => {
    renderV3(<AlmanacV3SyncPanel status={status({ outdatedDevices: [{ deviceId: 'dev-b', name: 'Mac mini' }] })} busy={false} error={null} onToggle={vi.fn()} onMakePrimary={vi.fn()} />)
    expect(screen.queryByText(/App 版本比這台舊/)).not.toBeInTheDocument()
  })
})

describe('AlmanacV3SyncSlot：哪些同步方式顯示 V3 同步開關', () => {
  it.each(['selfHosted', 'github', 'cloudFolder', 'webdav'] as const)('%s：顯示開關與主力裝置', async (platform) => {
    getAlmanacSyncStatus.mockResolvedValue(status({ enabled: true, firstCompletedAt: 1, devices: devices('dev-a') }))
    renderV3(<AlmanacV3SyncSlot platform={platform} />)
    expect(await screen.findByRole('switch', { name: 'V3 跨裝置同步' })).toBeChecked()
    expect(await screen.findByText('主力裝置：Scott 的 MacBook（這台）')).toBeInTheDocument()
  })

  it('本機（不同步）：不顯示', () => {
    renderV3(<AlmanacV3SyncSlot platform="local" />)
    expect(screen.queryByRole('switch', { name: 'V3 跨裝置同步' })).not.toBeInTheDocument()
  })
})

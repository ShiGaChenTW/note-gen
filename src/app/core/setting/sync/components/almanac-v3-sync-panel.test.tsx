// Fork（almanac ALMNC-85.2 骨架）：設定頁同步區塊的 V3 同步開關與主力裝置（最小 UI）。
import { describe, expect, it, vi } from 'vitest'
import { renderV3, screen } from '@/test/render-v3'
import { AlmanacV3SyncPanel } from './almanac-v3-sync-panel'
import type { AlmanacSyncStatus } from '@/lib/almanac-sync/runtime'

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
})

// Fork（almanac ALMNC-84.8）：同步刪除確認 UI（最近刪除頁內嵌清單 + 全域彈窗 / 抽屜）ARIA + userEvent 測試。
import { act, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingSyncDeletion } from '@/db/sync-deletions'
import emitter from '@/lib/emitter'
import { renderV3 } from '@/test/render-v3'

const mocks = vi.hoisted(() => ({
  listPendingSyncDeletions: vi.fn<() => Promise<PendingSyncDeletion[]>>(async () => []),
  confirmPendingSyncDeletion: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  rejectPendingSyncDeletion: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  confirmAllPendingSyncDeletions: vi.fn(async () => 0),
  rejectAllPendingSyncDeletions: vi.fn(async () => 0),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
  isMobile: false,
}))

vi.mock('@/db/sync-deletions', () => ({
  listPendingSyncDeletions: mocks.listPendingSyncDeletions,
}))

vi.mock('@/lib/sync/deletion-tombstones', () => ({
  confirmPendingSyncDeletion: mocks.confirmPendingSyncDeletion,
  rejectPendingSyncDeletion: mocks.rejectPendingSyncDeletion,
  confirmAllPendingSyncDeletions: mocks.confirmAllPendingSyncDeletions,
  rejectAllPendingSyncDeletions: mocks.rejectAllPendingSyncDeletions,
}))

vi.mock('sonner', () => ({
  toast: mocks.toast,
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mocks.isMobile,
}))

vi.mock('@/lib/check', () => ({
  isMobileDevice: () => mocks.isMobile,
}))

const { PendingSyncDeletionsPanel, PendingSyncDeletionsPrompt } = await import('./pending-sync-deletions')

function makePending(): PendingSyncDeletion[] {
  return [
    {
      id: 'del-1',
      workspaceRoot: '/vault',
      platform: 'github',
      path: 'Projects/notes.md',
      kind: 'file',
      deletedAt: 1_700_000_000_000,
      deviceId: 'remote-mac',
      status: 'pending',
      remoteRef: null,
      resolvedAt: null,
      createdAt: 1_700_000_001_000,
    },
    {
      id: 'del-2',
      workspaceRoot: '/vault',
      platform: 'github',
      path: 'Archive',
      kind: 'folder',
      deletedAt: 1_700_000_002_000,
      deviceId: 'remote-iphone',
      status: 'pending',
      remoteRef: null,
      resolvedAt: null,
      createdAt: 1_700_000_003_000,
    },
  ]
}

describe('PendingSyncDeletions UI (ALMNC-84.8)', () => {
  let state: PendingSyncDeletion[]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isMobile = false
    state = makePending()
    mocks.listPendingSyncDeletions.mockImplementation(async () => state)
    mocks.confirmPendingSyncDeletion.mockImplementation(async (id: string) => {
      state = state.filter(item => item.id !== id)
      return true
    })
    mocks.rejectPendingSyncDeletion.mockImplementation(async (id: string) => {
      state = state.filter(item => item.id !== id)
      return true
    })
    mocks.confirmAllPendingSyncDeletions.mockImplementation(async () => {
      const count = state.length
      state = []
      return count
    })
    mocks.rejectAllPendingSyncDeletions.mockImplementation(async () => {
      const count = state.length
      state = []
      return count
    })
  })

  it('列出待確認的遠端刪除並可單筆移至最近刪除或保留本機檔案', async () => {
    const { user } = renderV3(<PendingSyncDeletionsPanel />)

    const fileRow = await screen.findByRole('listitem', { name: 'Projects/notes.md' })
    expect(within(fileRow).getByText('檔案')).toBeInTheDocument()
    const folderRow = screen.getByRole('listitem', { name: 'Archive' })
    expect(within(folderRow).getByText('資料夾')).toBeInTheDocument()

    await user.click(within(fileRow).getByRole('button', { name: '移至最近刪除' }))
    expect(mocks.confirmPendingSyncDeletion).toHaveBeenCalledWith('del-1')
    expect(screen.queryByRole('listitem', { name: 'Projects/notes.md' })).not.toBeInTheDocument()

    const remainingRow = screen.getByRole('listitem', { name: 'Archive' })
    await user.click(within(remainingRow).getByRole('button', { name: '保留本機檔案' }))
    expect(mocks.rejectPendingSyncDeletion).toHaveBeenCalledWith('del-2')
    expect(screen.queryByRole('heading', { name: '遠端同步刪除確認' })).not.toBeInTheDocument()
  })

  it('支援全部移至最近刪除與全部保留本機的批次操作', async () => {
    const { user, unmount } = renderV3(<PendingSyncDeletionsPanel />)
    await screen.findByRole('listitem', { name: 'Projects/notes.md' })

    await user.click(screen.getByRole('button', { name: '全部移至最近刪除' }))
    expect(mocks.confirmAllPendingSyncDeletions).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('listitem', { name: 'Projects/notes.md' })).not.toBeInTheDocument()

    unmount()
    state = makePending()
    const next = renderV3(<PendingSyncDeletionsPanel />)
    await screen.findByRole('listitem', { name: 'Projects/notes.md' })
    await next.user.click(screen.getByRole('button', { name: '全部保留本機' }))
    expect(mocks.rejectAllPendingSyncDeletions).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('listitem', { name: 'Archive' })).not.toBeInTheDocument()
  })

  it('收到 pending-sync-deletions-changed 事件時跳出確認對話框，點「稍後決定」可關閉且不清除待確認項目', async () => {
    state = []
    const { user } = renderV3(<PendingSyncDeletionsPrompt />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    state = makePending()
    await act(async () => {
      emitter.emit('pending-sync-deletions-changed')
    })

    const dialog = await screen.findByRole('dialog', { name: '遠端同步刪除確認' })
    expect(within(dialog).getByRole('listitem', { name: 'Projects/notes.md' })).toBeInTheDocument()
    expect(within(dialog).getByRole('listitem', { name: 'Archive' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '稍後決定' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.confirmPendingSyncDeletion).not.toHaveBeenCalled()
    expect(mocks.rejectPendingSyncDeletion).not.toHaveBeenCalled()
    expect(state).toHaveLength(2)
  })
})

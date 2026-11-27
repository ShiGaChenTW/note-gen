// Fork（almanac ALMNC-84.8）：同步刪除確認 UI（最近刪除頁內嵌清單 + 全域彈窗 / 抽屜）ARIA + userEvent 測試。
import { act, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingSyncDeletion } from '@/db/sync-deletions'
import type { PendingRecordDeletion } from '@/lib/almanac-sync/tables/pending-records'
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
  listPendingRecordDeletionsForUi: vi.fn<() => Promise<PendingRecordDeletion[]>>(async () => []),
  confirmPendingRecordDeletion: vi.fn<(table: string, key: string) => Promise<boolean>>(async () => true),
  rejectPendingRecordDeletion: vi.fn<(table: string, key: string) => Promise<boolean>>(async () => true),
}))

vi.mock('@/lib/almanac-sync/pending-record-actions', () => ({
  listPendingRecordDeletionsForUi: mocks.listPendingRecordDeletionsForUi,
  confirmPendingRecordDeletion: mocks.confirmPendingRecordDeletion,
  rejectPendingRecordDeletion: mocks.rejectPendingRecordDeletion,
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

// Fork（almanac ALMNC-85.2，第 8 節 2A）：別台刪了 RSS 訂閱：併進同一份待確認清單，多一個「設定與夥伴」分組。
describe('PendingSyncDeletions UI：設定與夥伴分組（ALMNC-85.2）', () => {
  let records: PendingRecordDeletion[]
  const makeRecords = (): PendingRecordDeletion[] => [{
    tableName: 'feeds', syncKey: 'rss_1', title: 'Example Blog', snapshot: { id: 'rss_1' },
    deletedAt: 1_700_000_000_000, deviceId: 'remote-mac', status: 'pending', resolvedAt: null, createdAt: 1_700_000_001_000,
  }]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isMobile = false
    records = makeRecords()
    mocks.listPendingSyncDeletions.mockImplementation(async () => [])
    mocks.listPendingRecordDeletionsForUi.mockImplementation(async () => records)
    mocks.confirmPendingRecordDeletion.mockImplementation(async (_table: string, key: string) => {
      records = records.filter(item => item.syncKey !== key)
      return true
    })
    mocks.rejectPendingRecordDeletion.mockImplementation(async (_table: string, key: string) => {
      records = records.filter(item => item.syncKey !== key)
      return true
    })
  })

  it('別台刪的 RSS 訂閱列在「設定與夥伴」分組，可以移至最近刪除', async () => {
    const { user } = renderV3(<PendingSyncDeletionsPanel />)
    const group = await screen.findByRole('group', { name: '設定與夥伴' })
    const row = within(group).getByRole('listitem', { name: 'Example Blog' })
    expect(within(row).getByText('RSS 訂閱')).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: '移至最近刪除' }))
    expect(mocks.confirmPendingRecordDeletion).toHaveBeenCalledWith('feeds', 'rss_1')
    expect(screen.queryByRole('group', { name: '設定與夥伴' })).not.toBeInTheDocument()
  })

  // Fork（almanac ALMNC-85.3，第 8 節 2A）：別台刪的專家也在同一個分組，標「夥伴」。
  it('別台刪的專家列在「設定與夥伴」分組、標「夥伴」；保留＝推回另一台', async () => {
    records = [{
      tableName: 'crew', syncKey: 'agent:exp-1', title: 'Iris（工業工程）', snapshot: { agent: { id: 'exp-1' } },
      deletedAt: 1_700_000_000_000, deviceId: 'remote-mac', status: 'pending', resolvedAt: null, createdAt: 1_700_000_001_000,
    }]
    const { user } = renderV3(<PendingSyncDeletionsPanel />)
    const group = await screen.findByRole('group', { name: '設定與夥伴' })
    const row = within(group).getByRole('listitem', { name: 'Iris（工業工程）' })
    expect(within(row).getByText('夥伴')).toBeInTheDocument()
    expect(within(row).queryByText('RSS 訂閱')).not.toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: '保留' }))
    expect(mocks.rejectPendingRecordDeletion).toHaveBeenCalledWith('crew', 'agent:exp-1')
  })

  it('選「保留」：保留這台的訂閱（之後推回另一台）', async () => {
    const { user } = renderV3(<PendingSyncDeletionsPanel />)
    const row = await screen.findByRole('listitem', { name: 'Example Blog' })
    await user.click(within(row).getByRole('button', { name: '保留' }))
    expect(mocks.rejectPendingRecordDeletion).toHaveBeenCalledWith('feeds', 'rss_1')
    expect(mocks.confirmPendingRecordDeletion).not.toHaveBeenCalled()
  })

  it('只有別台刪的訂閱時也會跳出確認對話框；全部移至最近刪除會一起處理', async () => {
    records = []
    const { user } = renderV3(<PendingSyncDeletionsPrompt />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    records = makeRecords()
    await act(async () => {
      emitter.emit('pending-sync-deletions-changed')
    })
    const dialog = await screen.findByRole('dialog', { name: '遠端同步刪除確認' })
    expect(within(dialog).getByRole('group', { name: '設定與夥伴' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '全部移至最近刪除' }))
    expect(mocks.confirmPendingRecordDeletion).toHaveBeenCalledWith('feeds', 'rss_1')
  })
})

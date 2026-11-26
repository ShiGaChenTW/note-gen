// Fork（almanac ALMNC-84.6）：「最近刪除」頁 UI 互動與可達性測試（真實 Radix Tabs / AlertDialog，純 ARIA 查詢）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderV3 } from '@/test/render-v3'
import { TRASH_RETENTION_MS, type TrashItem } from '@/lib/trash/types'

const DAY_MS = 24 * 60 * 60 * 1000

const mocks = vi.hoisted(() => ({
  listTrashItems: vi.fn<() => Promise<TrashItem[]>>(async () => []),
  restoreTrashItem: vi.fn(async (id: string) => ({
    status: 'restored' as const,
    item: { id } as TrashItem,
    renamed: false,
  })),
  permanentlyDeleteTrashItem: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  emptyAppTrash: vi.fn(async () => ({ deletedCount: 0, failedIds: [] })),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
  loadFileTree: vi.fn(async () => undefined),
  loadProjects: vi.fn(async () => undefined),
  fetchMarks: vi.fn(async () => undefined),
  fetchMarkPreviews: vi.fn(async () => undefined),
  fetchTags: vi.fn(async () => undefined),
  initConversations: vi.fn(async () => undefined),
  loadMemories: vi.fn(async () => undefined),
  loadStats: vi.fn(async () => undefined),
}))

vi.mock('@/lib/trash/runtime', () => ({
  listTrashItems: mocks.listTrashItems,
  restoreTrashItem: mocks.restoreTrashItem,
  permanentlyDeleteTrashItem: mocks.permanentlyDeleteTrashItem,
  emptyAppTrash: mocks.emptyAppTrash,
}))

vi.mock('sonner', () => ({
  toast: mocks.toast,
}))

vi.mock('@/stores/article', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ loadFileTree: mocks.loadFileTree })) }
})

vi.mock('@/stores/canvas', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ loadProjects: mocks.loadProjects })) }
})

vi.mock('@/stores/mark', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({
      fetchMarks: mocks.fetchMarks,
      fetchMarkPreviews: mocks.fetchMarkPreviews,
    })),
  }
})

vi.mock('@/stores/tag', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ fetchTags: mocks.fetchTags })) }
})

vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ initConversations: mocks.initConversations })) }
})

vi.mock('@/stores/memories', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({
      loadMemories: mocks.loadMemories,
      loadStats: mocks.loadStats,
    })),
  }
})

const { RecentlyDeletedView } = await import('./recently-deleted-view')

function makeItems(now = Date.now()): TrashItem[] {
  return [
    {
      id: 't-file',
      workspace: '/vault',
      entityType: 'file',
      entityId: 't-file',
      title: '過時筆記.md',
      originalPath: 'Projects/過時筆記.md',
      trashPath: '.almanac-trash/t-file/過時筆記.md',
      deletedBy: 'partner',
      actorRole: 'partner',
      source: 'workbench-proposal',
      sizeBytes: 128,
      metadata: null,
      deletedAt: now - 5 * DAY_MS,
      expiresAt: now + 25 * DAY_MS,
    },
    {
      id: 't-folder',
      workspace: '/vault',
      entityType: 'folder',
      entityId: 't-folder',
      title: '舊草稿夾',
      originalPath: 'Archive/舊草稿夾',
      trashPath: '.almanac-trash/t-folder/舊草稿夾',
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'file-tree',
      sizeBytes: 512,
      metadata: null,
      deletedAt: now - 2 * DAY_MS,
      expiresAt: now + 28 * DAY_MS,
    },
    {
      id: 't-canvas',
      workspace: '',
      entityType: 'canvas',
      entityId: 'canvas-1',
      title: '系統架構圖',
      originalPath: null,
      trashPath: null,
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'canvas-sidebar',
      sizeBytes: 0,
      metadata: null,
      deletedAt: now - 10 * DAY_MS,
      expiresAt: now + 20 * DAY_MS,
    },
    {
      id: 't-mark',
      workspace: '',
      entityType: 'mark',
      entityId: '42',
      title: '靈感摘錄片段',
      originalPath: null,
      trashPath: null,
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'mark-list',
      sizeBytes: 0,
      metadata: null,
      deletedAt: now - DAY_MS,
      expiresAt: now - DAY_MS + TRASH_RETENTION_MS,
    },
    {
      id: 't-conv',
      workspace: '',
      entityType: 'conversation',
      entityId: '99',
      title: '季度檢討對話',
      originalPath: null,
      trashPath: null,
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'chat-header',
      sizeBytes: 0,
      metadata: null,
      deletedAt: now - 3 * DAY_MS,
      expiresAt: now + 27 * DAY_MS,
    },
    {
      id: 't-mem',
      workspace: '',
      entityType: 'memory',
      entityId: 'mem-1',
      title: '回答盡量條列重點',
      originalPath: null,
      trashPath: null,
      deletedBy: 'partner',
      actorRole: 'partner',
      source: 'agent-tool',
      sizeBytes: 0,
      metadata: null,
      deletedAt: now - 15 * DAY_MS,
      expiresAt: now + 15 * DAY_MS,
    },
  ]
}

describe('RecentlyDeletedView (ALMNC-84.6)', () => {
  let itemsState: TrashItem[]

  beforeEach(() => {
    vi.clearAllMocks()
    itemsState = makeItems()
    mocks.listTrashItems.mockImplementation(async () => itemsState)
    mocks.restoreTrashItem.mockImplementation(async (id: string) => {
      const target = itemsState.find(item => item.id === id)!
      itemsState = itemsState.filter(item => item.id !== id)
      return {
        status: 'restored',
        item: target,
        restoredPath: target.originalPath ?? undefined,
        renamed: false,
      }
    })
    mocks.permanentlyDeleteTrashItem.mockImplementation(async (id: string) => {
      itemsState = itemsState.filter(item => item.id !== id)
      return true
    })
    mocks.emptyAppTrash.mockImplementation(async () => {
      const deletedCount = itemsState.length
      itemsState = []
      return { deletedCount, failedIds: [] }
    })
  })

  it('列出各類型最近刪除項目並顯示刪除者、來源、原路徑與剩餘天數', async () => {
    renderV3(<RecentlyDeletedView />)

    const fileRow = await screen.findByRole('listitem', { name: '過時筆記.md' })
    expect(within(fileRow).getByText('檔案')).toBeInTheDocument()
    expect(within(fileRow).getByText('刪除者：夥伴')).toBeInTheDocument()
    expect(within(fileRow).getByText('來源：工作台提案')).toBeInTheDocument()
    expect(within(fileRow).getByText('原路徑：Projects/過時筆記.md')).toBeInTheDocument()
    expect(within(fileRow).getByText('剩餘 25 天')).toBeInTheDocument()

    expect(screen.getByRole('listitem', { name: '舊草稿夾' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: '系統架構圖' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: '靈感摘錄片段' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: '季度檢討對話' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: '回答盡量條列重點' })).toBeInTheDocument()
  })

  it('點擊分類分頁可以篩選筆記與資料夾、畫布、記錄、對話與記憶', async () => {
    const { user } = renderV3(<RecentlyDeletedView />)
    await screen.findByRole('listitem', { name: '過時筆記.md' })

    await user.click(screen.getByRole('tab', { name: /筆記與資料夾/ }))
    expect(screen.getByRole('listitem', { name: '過時筆記.md' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: '舊草稿夾' })).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: '系統架構圖' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /畫布/ }))
    expect(screen.getByRole('listitem', { name: '系統架構圖' })).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: '過時筆記.md' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /記錄/ }))
    expect(screen.getByRole('listitem', { name: '靈感摘錄片段' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /對話/ }))
    expect(screen.getByRole('listitem', { name: '季度檢討對話' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /記憶/ }))
    expect(screen.getByRole('listitem', { name: '回答盡量條列重點' })).toBeInTheDocument()
  })

  it('點擊還原會呼叫 restoreTrashItem、同步對應 store 並在改名衝突時通知新路徑', async () => {
    mocks.restoreTrashItem.mockImplementationOnce(async (id: string) => {
      const target = itemsState.find(item => item.id === id)!
      itemsState = itemsState.filter(item => item.id !== id)
      return {
        status: 'restored',
        item: target,
        restoredPath: 'Projects/過時筆記 (restored).md',
        renamed: true,
      }
    })

    const { user } = renderV3(<RecentlyDeletedView />)
    const fileRow = await screen.findByRole('listitem', { name: '過時筆記.md' })
    await user.click(within(fileRow).getByRole('button', { name: '還原' }))

    expect(mocks.restoreTrashItem).toHaveBeenCalledWith('t-file')
    expect(mocks.loadFileTree).toHaveBeenCalled()
    expect(mocks.toast.success).toHaveBeenCalledWith(
      '原位置已有同名項目，已還原為 Projects/過時筆記 (restored).md',
    )
    expect(screen.queryByRole('listitem', { name: '過時筆記.md' })).not.toBeInTheDocument()
  })

  it('點擊永久刪除先跳出真實 AlertDialog 確認，取消保留項目、確認才永久刪除', async () => {
    const { user } = renderV3(<RecentlyDeletedView />)
    const canvasRow = await screen.findByRole('listitem', { name: '系統架構圖' })

    await user.click(within(canvasRow).getByRole('button', { name: '永久刪除' }))
    const cancelDialog = await screen.findByRole('alertdialog')
    await user.click(within(cancelDialog).getByRole('button', { name: '取消' }))
    expect(mocks.permanentlyDeleteTrashItem).not.toHaveBeenCalled()
    expect(screen.getByRole('listitem', { name: '系統架構圖' })).toBeInTheDocument()

    await user.click(within(canvasRow).getByRole('button', { name: '永久刪除' }))
    const confirmDialog = await screen.findByRole('alertdialog')
    await user.click(within(confirmDialog).getByRole('button', { name: '永久刪除' }))
    expect(mocks.permanentlyDeleteTrashItem).toHaveBeenCalledWith('t-canvas')
    expect(screen.queryByRole('listitem', { name: '系統架構圖' })).not.toBeInTheDocument()
  })

  it('外部 MCP 顧問刪除的項目顯示客戶端名稱與顧問身分', async () => {
    const now = Date.now()
    itemsState = [
      {
        id: 't-advisor',
        workspace: '/vault',
        entityType: 'file',
        entityId: 't-advisor',
        title: '顧問刪的筆記.md',
        originalPath: 'Projects/顧問刪的筆記.md',
        trashPath: '.almanac-trash/t-advisor/顧問刪的筆記.md',
        deletedBy: 'Claude Code',
        actorRole: 'advisor',
        source: 'mcp',
        sizeBytes: 64,
        metadata: null,
        deletedAt: now - DAY_MS,
        expiresAt: now - DAY_MS + TRASH_RETENTION_MS,
      },
    ]

    renderV3(<RecentlyDeletedView />)

    const row = await screen.findByRole('listitem', { name: '顧問刪的筆記.md' })
    expect(within(row).getByText('刪除者：Claude Code · 顧問 / MCP')).toBeInTheDocument()
    expect(within(row).getByText('來源：本機 MCP')).toBeInTheDocument()
  })

  it('點擊清空最近刪除並確認後呼叫 emptyAppTrash 並顯示空狀態', async () => {
    const { user } = renderV3(<RecentlyDeletedView mobile />)
    await screen.findByRole('listitem', { name: '過時筆記.md' })

    await user.click(screen.getByRole('button', { name: '清空最近刪除' }))
    const confirmDialog = await screen.findByRole('alertdialog')
    await user.click(within(confirmDialog).getByRole('button', { name: '清空最近刪除' }))

    expect(mocks.emptyAppTrash).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('最近刪除是空的')).toBeInTheDocument()
  })
})

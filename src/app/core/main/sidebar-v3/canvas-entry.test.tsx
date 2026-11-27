// Fork（almanac ALMNC-93）：V3 畫布入口。側欄「＋」選單新增畫布、命令面板新增與開啟既有畫布，都不經過整理頁。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderV3, screen, waitFor } from '@/test/render-v3'
import emitter from '@/lib/emitter'
import { useAnywhereStore } from '@/lib/anywhere/store'
import useArticleStore from '@/stores/article'
import useCanvasStore from '@/stores/canvas'
import type { CanvasProject } from '@/types/canvas'

const db = vi.hoisted(() => ({
  insertCanvasProject: vi.fn(),
  getCanvasProjects: vi.fn(),
  getCanvasProject: vi.fn(),
}))

vi.mock('@/db/canvases', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/db/canvases')>(),
  ...db,
}))

vi.mock('../file', () => ({
  FileSidebar: () => null,
}))

vi.mock('../file/file-actions', () => ({
  FileActions: () => null,
}))

vi.mock('@/lib/workbench/use-workbench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workbench/use-workbench')>()
  return { ...actual, useWorkbenchCount: () => 0 }
})

vi.mock('@/db/agents', () => ({
  ensureDefaultRoster: vi.fn(async () => []),
  listAgentSettings: vi.fn(async () => []),
}))

vi.mock('@/stores/eink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/eink')>()
  actual.default.setState({ init: async () => {}, pins: [] })
  return actual
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/core/main',
  useSearchParams: () => new URLSearchParams(),
}))

const { SidebarV3 } = await import('./sidebar-v3')
const { AnywhereCommandPalette } = await import('../anywhere/command-palette')

function project(id: string, title: string, updatedAt: number): CanvasProject {
  return {
    id,
    title,
    canvasType: 'blank',
    schemaVersion: 1,
    document: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } as unknown as CanvasProject['document'],
    thumbnailPath: null,
    createdAt: updatedAt,
    updatedAt,
  }
}

const initialCanvas = useCanvasStore.getState()
const initialArticle = useArticleStore.getState()
const addTab = vi.fn(async () => {})
const showEditor = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  db.getCanvasProjects.mockResolvedValue([])
  db.insertCanvasProject.mockImplementation(async (input: { id: string, title: string }) => project(input.id, input.title, 3000))
  useCanvasStore.setState({
    ...initialCanvas,
    projects: [],
    refreshThumbnail: async () => {},
    repairThumbnail: async () => {},
  }, true)
  useArticleStore.setState({ addTab, activeFilePath: '' })
  useAnywhereStore.setState({ paletteOpen: false })
  emitter.on('show-editor', showEditor)
})

afterEach(() => {
  emitter.off('show-editor', showEditor)
  useCanvasStore.setState(initialCanvas, true)
  useArticleStore.setState({ addTab: initialArticle.addTab })
  useAnywhereStore.setState({ paletteOpen: false })
})

describe('側欄＋選單：新增畫布', () => {
  it('選「新增畫布」會建立空白畫布並直接在編輯區開啟', async () => {
    const { user } = renderV3(<SidebarV3 />)

    await user.click(screen.getByRole('button', { name: '新增' }))
    await user.click(await screen.findByRole('menuitem', { name: '新增畫布' }))

    await waitFor(() => expect(addTab).toHaveBeenCalledOnce())
    expect(db.insertCanvasProject).toHaveBeenCalledWith(expect.objectContaining({ title: '空白畫布', canvasType: 'blank' }))
    const [tab] = addTab.mock.calls[0] as unknown as [{ kind: string, name: string }]
    expect(tab).toMatchObject({ kind: 'canvas', name: '空白畫布' })
    expect(showEditor).toHaveBeenCalled()
  })
})

describe('命令面板：畫布', () => {
  it('不輸入時列出最近畫布（依修改時間），選了直接開啟', async () => {
    db.getCanvasProjects.mockResolvedValue([
      project('old', '舊的畫布', 1000),
      project('roadmap', '產品路線圖', 2000),
    ])
    act(() => useAnywhereStore.setState({ paletteOpen: true }))
    const { user } = renderV3(<AnywhereCommandPalette />)

    const options = await screen.findAllByRole('option', { name: /^開啟畫布：/ })
    expect(options.map(option => option.textContent)).toEqual(['開啟畫布：產品路線圖', '開啟畫布：舊的畫布'])
    expect(screen.getByRole('group', { name: '畫布' })).toBeInTheDocument()

    await user.click(options[0])

    await waitFor(() => expect(addTab).toHaveBeenCalledOnce())
    const [tab] = addTab.mock.calls[0] as unknown as [{ kind: string, canvasId: string }]
    expect(tab).toMatchObject({ kind: 'canvas', canvasId: 'roadmap' })
    expect(useCanvasStore.getState().activeCanvasId).toBe('roadmap')
    expect(showEditor).toHaveBeenCalled()
    expect(useAnywhereStore.getState().paletteOpen).toBe(false)
  })

  it('輸入畫布名稱可搜尋到「開啟畫布：<名稱>」', async () => {
    db.getCanvasProjects.mockResolvedValue([
      project('roadmap', '產品路線圖', 2000),
      project('swot', '競品分析', 1000),
    ])
    act(() => useAnywhereStore.setState({ paletteOpen: true }))
    const { user } = renderV3(<AnywhereCommandPalette />)
    await screen.findAllByRole('option', { name: /^開啟畫布：/ })

    await user.type(screen.getByRole('combobox'), '路線')

    expect(await screen.findByRole('option', { name: '開啟畫布：產品路線圖' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '開啟畫布：競品分析' })).not.toBeInTheDocument()
  })

  it('「新增畫布」指令建立空白畫布並開啟', async () => {
    act(() => useAnywhereStore.setState({ paletteOpen: true }))
    const { user } = renderV3(<AnywhereCommandPalette />)

    await user.type(await screen.findByRole('combobox'), '新增畫布')
    await user.click(await screen.findByRole('option', { name: '新增畫布' }))

    await waitFor(() => expect(addTab).toHaveBeenCalledOnce())
    expect(db.insertCanvasProject).toHaveBeenCalledWith(expect.objectContaining({ title: '空白畫布' }))
    expect(showEditor).toHaveBeenCalled()
  })

  it('最近刪除的畫布不出現在命令面板', async () => {
    db.getCanvasProjects.mockResolvedValue([
      project('roadmap', '產品路線圖', 2000),
      { ...project('gone', '已刪除畫布', 3000), deletedAt: 3500 },
    ])
    act(() => useAnywhereStore.setState({ paletteOpen: true }))
    const { user } = renderV3(<AnywhereCommandPalette />)
    await screen.findByRole('option', { name: '開啟畫布：產品路線圖' })

    await user.type(screen.getByRole('combobox'), '畫布')
    await screen.findByRole('option', { name: '開啟畫布：產品路線圖' })
    expect(screen.queryByRole('option', { name: '開啟畫布：已刪除畫布' })).not.toBeInTheDocument()
  })
})

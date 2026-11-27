import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { renderV3 } from '@/test/render-v3'
import { useKnowledgeOverlay } from '@/lib/sidebar-v3/knowledge'
import { useAnywhereStore } from '@/lib/anywhere/store'
import useArticleStore from '@/stores/article'
import { V3_ENTRY_INVENTORY } from './v3-entry-inventory'

vi.mock('../file', () => ({
  FileSidebar: () => null,
}))

vi.mock('../file/file-actions', () => ({
  FileActions: () => null,
}))

vi.mock('../timeline/timeline-sidebar', () => ({
  TimelineSidebar: () => null,
}))

vi.mock('../canvas/canvas-sidebar', () => ({
  CanvasActions: () => null,
  CanvasSidebar: () => null,
}))

vi.mock('../note-tags/note-tags-sidebar', () => ({
  default: () => null,
}))

vi.mock('./domains-tab', () => ({
  DomainsTab: () => null,
}))

vi.mock('../editor/markdown/outline', () => ({
  Outline: () => null,
}))

vi.mock('@/lib/workbench/use-workbench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workbench/use-workbench')>()
  return {
    ...actual,
    useWorkbenchCount: () => 0,
  }
})

vi.mock('@/db/canvases', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/db/canvases')>(),
  getCanvasProjects: vi.fn(async () => []),
}))

vi.mock('@/db/agents', () => ({
  ensureDefaultRoster: vi.fn(async () => []),
  listAgentSettings: vi.fn(async () => []),
}))

vi.mock('@/hooks/use-workspace-display-name', () => ({
  useWorkspaceDisplayName: () => (_path: string, defaultName: string) => defaultName,
}))

vi.mock('@/stores/eink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/eink')>()
  actual.default.setState({ init: async () => {}, pins: [] })
  return actual
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/core/main',
  useSearchParams: () => new URLSearchParams(),
}))

const { SidebarV3 } = await import('./sidebar-v3')
const { KnowledgeScreen } = await import('./knowledge-screen')
const { AnywhereCommandPalette } = await import('../anywhere/command-palette')

/**
 * Strip trailing shortcut badges (e.g. `⌘⇧A`, `⌘⇧H`) from an option's
 * accessible name so assertions match the localized command title cleanly.
 */
function stripShortcutSuffix(label: string): string {
  return label.replace(/\s*[⌘⇧⌥⌃][A-Z0-9⌘⇧⌥⌃+\s]*$/u, '').trim()
}

/**
 * Collect ordered accessible labels for rendered ARIA role nodes via Testing
 * Library's accessible name calculation.
 */
function getAccessibleLabels(
  role: string,
  container?: HTMLElement,
  normalize: (name: string) => string = (name) => name.trim(),
): string[] {
  const queries = container ? within(container) : screen
  const byElement = new Map<Element, string>()
  const elements = queries.getAllByRole(role, {
    name: (accessibleName, element) => {
      byElement.set(element, normalize(accessibleName))
      return true
    },
  })
  return elements.map((element) => byElement.get(element) ?? '')
}

describe('V3 entry inventory', () => {
  beforeEach(() => {
    useKnowledgeOverlay.setState({ visible: false, tab: 'timeline' })
    useAnywhereStore.setState({ paletteOpen: false })
    useArticleStore.setState({ activeFilePath: '' })
  })

  afterEach(() => {
    useKnowledgeOverlay.setState({ visible: false, tab: 'timeline' })
    useAnywhereStore.setState({ paletteOpen: false })
    useArticleStore.setState({ activeFilePath: '' })
  })

  it('主導覽按鈕與清單完全一致', () => {
    renderV3(<SidebarV3 />)

    const nav = screen.getByRole('navigation', { name: '主要導覽' })
    for (const label of V3_ENTRY_INVENTORY.mainNav) {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(getAccessibleLabels('button', nav)).toEqual([
      ...V3_ENTRY_INVENTORY.mainNav,
    ])
  })

  it('整理頁面分頁與清單完全一致且保留畫布分頁', () => {
    useKnowledgeOverlay.setState({ visible: true, tab: 'timeline' })
    renderV3(<KnowledgeScreen />)

    const tablist = screen.getByRole('tablist', { name: '整理頁面' })
    for (const label of V3_ENTRY_INVENTORY.knowledgeTabs) {
      expect(within(tablist).getByRole('tab', { name: label })).toBeInTheDocument()
    }
    expect(getAccessibleLabels('tab', tablist)).toEqual([
      ...V3_ENTRY_INVENTORY.knowledgeTabs,
    ])
    expect(within(tablist).getByRole('tab', { name: '畫布' })).toBeInTheDocument()
  })

  it('開啟＋選單後項目與清單完全一致', async () => {
    const { user } = renderV3(<SidebarV3 />)

    await user.click(screen.getByRole('button', { name: '新增' }))
    await screen.findAllByRole('menuitem')

    for (const label of V3_ENTRY_INVENTORY.quickMenu) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument()
    }
    expect(getAccessibleLabels('menuitem')).toEqual([
      ...V3_ENTRY_INVENTORY.quickMenu,
    ])
  })

  it('命令面板預設顯示前 7 項且可搜尋全部項目，與清單完全一致', async () => {
    useAnywhereStore.setState({ paletteOpen: true })
    const { user } = renderV3(<AnywhereCommandPalette />)

    await screen.findAllByRole('option')
    const initialExpected = V3_ENTRY_INVENTORY.commandPalette.slice(0, 7)
    const initialActual = getAccessibleLabels('option', undefined, stripShortcutSuffix)

    expect(initialActual).toEqual([...initialExpected])

    const seen = new Set(initialActual)
    const searchInput = screen.getByRole('combobox')

    for (const query of ['切換', '開啟', '畫布']) {
      await user.clear(searchInput)
      await user.type(searchInput, query)

      const filteredExpected = V3_ENTRY_INVENTORY.commandPalette.filter((label) =>
        label.includes(query),
      )
      await screen.findAllByRole('option')
      const filteredActual = getAccessibleLabels('option', undefined, stripShortcutSuffix)

      expect(filteredActual).toHaveLength(filteredExpected.length)
      expect(new Set(filteredActual)).toEqual(new Set(filteredExpected))

      for (const label of filteredActual) {
        seen.add(label)
      }
    }

    expect(seen.size).toBe(V3_ENTRY_INVENTORY.commandPalette.length)
    expect(seen).toEqual(new Set(V3_ENTRY_INVENTORY.commandPalette))
  })

  it('新增畫布同時出現在＋選單與命令面板（ALMNC-93）', async () => {
    const { user } = renderV3(
      <>
        <SidebarV3 />
        <AnywhereCommandPalette />
      </>,
    )

    await user.click(screen.getByRole('button', { name: '新增' }))
    expect(
      await screen.findByRole('menuitem', { name: '新增畫布' }),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')

    act(() => useAnywhereStore.setState({ paletteOpen: true }))
    await user.type(await screen.findByRole('combobox'), '新增畫布')
    expect(
      await screen.findByRole('option', {
        name: (accessibleName) => stripShortcutSuffix(accessibleName) === '新增畫布',
      }),
    ).toBeInTheDocument()
  })
})

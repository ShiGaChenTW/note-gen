// @vitest-environment jsdom
// Fork（almanac ALMNC-56.7，RPT-2026-009 P07）：V3 左側欄在元件開頭就換成新側欄，不先跑 classic 才需要的 hooks；classic 照舊。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'

const spies = vi.hoisted(() => ({
  useDecisions: vi.fn(() => []),
  useInboxPendingCount: vi.fn(() => 0),
  usePluginLocalization: vi.fn(),
}))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

vi.mock('./sidebar-v3/sidebar-v3', () => ({ SidebarV3: () => 'v3 sidebar' }))
vi.mock('@/lib/decide/use-decisions', () => ({ useDecisions: spies.useDecisions }))
vi.mock('@/lib/inbox/use-inbox-pending', () => ({ useInboxPendingCount: spies.useInboxPendingCount }))
vi.mock('@/lib/plugins/localization', () => ({ usePluginLocalization: spies.usePluginLocalization }))
vi.mock('./file', () => ({ FileSidebar: () => null }))
vi.mock('./file/file-actions', () => ({ FileActions: () => null }))
vi.mock('./daily/sidebar-calendar', () => ({ SidebarCalendar: () => null, openDailyNoteFromSidebar: vi.fn() }))
vi.mock('./canvas/canvas-sidebar', () => ({ CanvasActions: () => null, CanvasSidebar: () => null }))
vi.mock('./sidebar-search', () => ({ SidebarSearch: () => null }))
vi.mock('./timeline/timeline-sidebar', () => ({ TimelineSidebar: () => null }))
vi.mock('./note-tags/note-tags-sidebar', () => ({ default: () => null }))
vi.mock('./editor/markdown/outline', () => ({ Outline: () => null }))

const { LeftSidebar } = await import('./left-sidebar')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  for (const spy of Object.values(spies)) spy.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render() {
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(LeftSidebar) })))
}

it('P07: V3 renders the new sidebar without running the classic-only hooks', () => {
  useUiModeStore.setState({ mode: 'v3' })
  render()
  expect(container.textContent).toBe('v3 sidebar')
  expect(spies.useDecisions).not.toHaveBeenCalled()
  expect(spies.useInboxPendingCount).not.toHaveBeenCalled()
  expect(spies.usePluginLocalization).not.toHaveBeenCalled()
})

it('classic still renders the classic sidebar (with its hooks)', () => {
  useUiModeStore.setState({ mode: 'classic' })
  render()
  expect(container.querySelector('[data-left-sidebar]')).not.toBeNull()
  expect(container.querySelector('nav')?.textContent).toContain('Overview')
  expect(spies.useInboxPendingCount).toHaveBeenCalled()
  expect(spies.usePluginLocalization).toHaveBeenCalled()
})

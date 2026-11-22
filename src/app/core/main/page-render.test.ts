// @vitest-environment jsdom
// Fork（almanac ALMNC-56.3 P02）：拖分隔線、縮放視窗時，ResizeObserver 量到的尺寸沒變就不更新 state；
// 側欄 store 無關欄位變動不重繪；外層真的重繪時，各面板內容（memo）也不跟著重繪。
import { act, createElement as h, createContext, lazy, Profiler, Suspense, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const renders = vi.hoisted(() => ({ left: 0, editor: 0, noteList: 0, right: 0 }))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  // Node 的 localStorage 全域會蓋掉 jsdom 的 Storage。
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<ComponentType>) => lazy(() => loader().then(component => ({ default: component }))),
}))
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) },
}))
vi.mock('@/lib/editor-windows', () => ({ restoreEditorWindows: async () => {} }))
vi.mock('@/lib/fork-overlays/use-page-visibility', () => ({ useWorkspaceCovered: () => false }))
vi.mock('./left-sidebar', () => ({ LeftSidebar: () => { renders.left++; return null } }))
// 真正的 EditorLayout 本身就是 memo（editor-layout.tsx；editor-layout-render.test.ts 驗證父層重繪時不重繪）。
vi.mock('./editor/editor-layout', async () => {
  const { memo } = await import('react')
  return { EditorLayout: memo(() => { renders.editor++; return null }) }
})
vi.mock('./note-list/note-list-column', () => ({ NoteListColumn: () => { renders.noteList++; return null } }))
vi.mock('@/components/plugins/plugin-right-sidebar', () => ({ PluginRightSidebar: () => { renders.right++; return null } }))
vi.mock('./main-status-bar', () => ({ MainStatusBar: () => null, WorkspaceCoveredContext: createContext(false) }))
vi.mock('./fork-services', () => ({ ForkServices: () => null }))

const { useSidebarStore } = await import('@/stores/sidebar')
const { default: Page } = await import('./page')

let observers: { callback: ResizeObserverCallback, targets: Element[] }[] = []
class FakeResizeObserver {
  private entry: { callback: ResizeObserverCallback, targets: Element[] }
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: [] }
    observers.push(this.entry)
  }
  observe(target: Element) { this.entry.targets.push(target) }
  unobserve() {}
  disconnect() { this.entry.targets = [] }
}

let container: HTMLDivElement
let root: Root
let commits = 0

const pageRoot = () => container.querySelector<HTMLElement>('[style*="--page-top"]')!
/** 頁框的 ResizeObserver（觀察最外層容器的那一個）。 */
const fireBoxObserver = () => {
  const entry = observers.find(observer => observer.targets.includes(pageRoot()))!
  act(() => entry.callback([], {} as ResizeObserver))
}

beforeEach(async () => {
  observers = []
  renders.left = renders.editor = renders.noteList = renders.right = 0
  commits = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(h(Profiler, { id: 'page', onRender: () => { commits++ }, children: h(Suspense, { fallback: null }, h(Page)) }))
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)) })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('P02: resizing and sidebar updates', () => {
  it('skips the state update when the observed sizes did not change', () => {
    expect(pageRoot()).not.toBeNull()
    const before = commits
    for (let frame = 0; frame < 10; frame++) fireBoxObserver()
    expect(commits).toBe(before)
  })

  it('does not re-render when an unrelated sidebar field changes', () => {
    const before = commits
    act(() => useSidebarStore.setState({ leftSidebarTab: 'outline' }))
    act(() => useSidebarStore.setState({ sidebarSearchFocusRequest: useSidebarStore.getState().sidebarSearchFocusRequest + 1 }))
    expect(commits).toBe(before)
  })

  it('re-measures when the size really changes, without re-rendering the panel contents', () => {
    const counts = { ...renders }
    const before = commits
    const element = pageRoot()
    element.querySelector<HTMLElement>('[data-slot="resizable-panel-group"]')!.style.padding = '0px'
    element.getBoundingClientRect = () => ({ top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    fireBoxObserver()
    expect(commits).toBeGreaterThan(before)
    expect(element.style.getPropertyValue('--page-right')).toBe('1200px')
    expect(renders).toEqual(counts)
    // 同樣的尺寸再量一次：不再更新
    const settled = commits
    fireBoxObserver()
    expect(commits).toBe(settled)
  })
})

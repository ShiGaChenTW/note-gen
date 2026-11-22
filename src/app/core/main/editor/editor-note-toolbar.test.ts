// @vitest-environment jsdom
// almanac：V3 編輯區右上角筆記工具列——按鈕分組、各按鈕接到既有機制、標籤寫回 frontmatter、窄版收合。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import zhTW from '../../../../../messages/zh-TW.json'
import { useAnywhereStore } from '@/lib/anywhere/store'
import emitter from '@/lib/emitter'
import { useActiveNoteEditorStore } from '@/stores/active-note-editor'
import useNoteMarksStore from '@/stores/note-marks'
import useSettingStore from '@/stores/setting'
import { EditorNoteToolbar } from './editor-note-toolbar'
import type { TabInfo } from './tab-bar'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'macos' }))
// platform() 被 mock 後 checkIsTauri() 為真，置頂／收藏會寫 note-marks.json：換成記憶體裡的 store。
const persisted = vi.hoisted(() => new Map<string, Map<string, unknown>>())
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: async (file: string) => {
      const data = persisted.get(file) ?? new Map<string, unknown>()
      persisted.set(file, data)
      return {
        get: async (key: string) => data.get(key),
        set: async (key: string, value: unknown) => { data.set(key, value) },
        save: async () => {},
      }
    },
  },
}))
vi.mock('@/lib/obsidian-types', () => ({ loadObsidianPropertyTypes: async () => ({}) }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  stat: async () => ({ birthtime: new Date(2026, 0, 2, 3, 4), mtime: new Date(2026, 10, 20, 9, 30) }),
}))
vi.mock('@/lib/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspace')>()),
  getFilePathOptions: async (path: string) => ({ path }),
}))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const FrontmatterNode = Node.create({
  name: 'frontmatter',
  group: 'block',
  atom: true,
  addAttributes() { return { raw: { default: '' } } },
  parseHTML() { return [{ tag: 'pre[data-type="frontmatter"]' }] },
  renderHTML() { return ['pre', { 'data-type': 'frontmatter' }] },
})

const NOTE: TabInfo = { id: 't1', path: 'work/a.md', name: 'a.md', isFolder: false, kind: 'file' }
let host: HTMLDivElement
let root: Root
let editors: Editor[] = []
let observedWidth = 0

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  observedWidth = 0
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { if (observedWidth) this.callback([{ contentRect: { width: observedWidth } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve() {}
    disconnect() {}
  })
  useSettingStore.setState({ showEditorUndoRedo: true, workspacePath: '' })
  useNoteMarksStore.setState({ loaded: true, pinned: {}, favorites: {} })
  useAnywhereStore.setState({ paletteOpen: false, chatOpen: false })
  useActiveNoteEditorStore.setState({ active: null })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  editors.forEach(editor => editor.destroy())
  editors = []
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function makeEditor(content: Record<string, unknown>) {
  const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, FrontmatterNode], content })
  editors.push(editor)
  return editor
}

async function render(props: Partial<React.ComponentProps<typeof EditorNoteToolbar>> = {}) {
  const toolbar = React.createElement(EditorNoteToolbar, {
    activeTab: NOTE,
    isActiveGroup: true,
    canGoBack: true,
    canGoForward: false,
    onNavigate: () => {},
    ...props,
  })
  // 父元素當作編輯區（工具列量它的寬度決定要不要收合）
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: React.createElement('section', null, toolbar) }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
}

const toolbarButtons = () => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="editor-note-toolbar"] button')]
const labels = () => toolbarButtons().map(button => button.getAttribute('aria-label'))
const button = (label: string) => toolbarButtons().find(item => item.getAttribute('aria-label')?.startsWith(label))!

async function typeAndEnter(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
}

it('shows the four groups for a markdown note, in order, with shortcuts in the labels', async () => {
  await render()
  expect(labels()).toEqual([
    '返回 (⌘[)', '前進 (⌘])',
    '在筆記中尋找 (⌘F)', '標籤', '置頂', '收藏',
    '開啟大綱 (⇧⌘O)', '版本歷史', '筆記資訊', '命令面板 (⌘K)',
    '復原 (⌘Z)', '重做 (⌘Shift+Z)',
  ])
  expect(host.querySelectorAll('[data-testid="editor-note-toolbar"] > span[aria-hidden]')).toHaveLength(3)
})

it('wires navigation, find, version history and the command palette to the existing mechanisms', async () => {
  const onNavigate = vi.fn()
  const search = vi.fn()
  const history = vi.fn()
  emitter.on('editor-search-trigger', search)
  emitter.on('editor-open-version-history', history)
  await render({ onNavigate })
  expect(button('前進').disabled).toBe(true)
  await act(async () => button('返回').click())
  expect(onNavigate).toHaveBeenCalledWith('back')
  await act(async () => button('在筆記中尋找').click())
  expect(search).toHaveBeenCalledTimes(1)
  await act(async () => button('版本歷史').click())
  expect(history).toHaveBeenCalledTimes(1)
  await act(async () => button('命令面板').click())
  expect(useAnywhereStore.getState().paletteOpen).toBe(true)
  emitter.off('editor-search-trigger', search)
  emitter.off('editor-open-version-history', history)
})

it('toggles pin and favorite per workspace and shows the pressed state', async () => {
  await render()
  await act(async () => button('置頂').click())
  expect(useNoteMarksStore.getState().pinned).toEqual({ __default__: ['work/a.md'] })
  expect(button('取消置頂').getAttribute('aria-pressed')).toBe('true')
  expect(button('取消置頂').className).toContain('bg-active')
  await act(async () => button('收藏').click())
  expect(useNoteMarksStore.getState().favorites).toEqual({ __default__: ['work/a.md'] })
  expect(persisted.get('note-marks.json')?.get('favorites')).toEqual({ __default__: ['work/a.md'] })
  await act(async () => button('取消置頂').click())
  expect(useNoteMarksStore.getState().pinned).toEqual({ __default__: [] })
  expect(persisted.get('note-marks.json')?.get('pinned')).toEqual({ __default__: [] })
  expect(button('置頂').getAttribute('aria-pressed')).toBe('false')
})

it('follows renamed and deleted notes in the current workspace', async () => {
  useNoteMarksStore.setState({ loaded: true, pinned: { __default__: ['work/a.md', 'b.md'] }, favorites: { __default__: ['work/a.md'] } })
  emitter.emit('editor-navigation-path-moved', { oldPath: 'work', newPath: 'jobs' })
  expect(useNoteMarksStore.getState().pinned).toEqual({ __default__: ['jobs/a.md', 'b.md'] })
  expect(useNoteMarksStore.getState().favorites).toEqual({ __default__: ['jobs/a.md'] })
  emitter.emit('editor-navigation-path-deleted', { path: 'b.md', isFolder: false })
  expect(useNoteMarksStore.getState().pinned).toEqual({ __default__: ['jobs/a.md'] })
})

it('toggles the outline through the active editor and reflects its state', async () => {
  const toggleOutline = vi.fn()
  const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] })
  useActiveNoteEditorStore.getState().register({ editor: editor as never, path: 'work/a.md', outlineOpen: true, toggleOutline })
  await render()
  const outline = button('關閉大綱')
  expect(outline.getAttribute('aria-pressed')).toBe('true')
  await act(async () => outline.click())
  expect(toggleOutline).toHaveBeenCalledTimes(1)
})

it('adds and removes tags in the existing frontmatter', async () => {
  const editor = makeEditor({ type: 'doc', content: [
    { type: 'frontmatter', attrs: { raw: '---\ntitle: A\ntags:\n  - a\n---\n' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
  ] })
  useActiveNoteEditorStore.getState().register({ editor: editor as never, path: 'work/a.md', outlineOpen: false, toggleOutline: () => {} })
  await render()
  await act(async () => button('標籤').click())
  const input = document.querySelector<HTMLInputElement>('input[aria-label="新增標籤，按 Enter"]')!
  expect(input).not.toBeNull()
  expect(document.body.textContent).toContain('#a')
  await typeAndEnter(input, '#b')
  expect(editor.state.doc.firstChild?.attrs.raw).toBe('---\ntitle: A\ntags:\n  - a\n  - b\n---\n')
  expect(input.value).toBe('')
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="移除 a"]')!.click())
  expect(editor.state.doc.firstChild?.attrs.raw).toBe('---\ntitle: A\ntags:\n  - b\n---\n')
})

it('creates a frontmatter block when the note has none', async () => {
  const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] })
  useActiveNoteEditorStore.getState().register({ editor: editor as never, path: 'work/a.md', outlineOpen: false, toggleOutline: () => {} })
  await render()
  await act(async () => button('標籤').click())
  expect(document.body.textContent).toContain('還沒有標籤')
  await typeAndEnter(document.querySelector<HTMLInputElement>('input[aria-label="新增標籤，按 Enter"]')!, 'idea')
  expect(editor.state.doc.firstChild?.type.name).toBe('frontmatter')
  expect(editor.state.doc.firstChild?.attrs.raw).toBe('---\ntags:\n  - idea\n---\n')
  expect(editor.state.doc.child(1).textContent).toBe('hello')
})

it('shows file name, folder, times and length in the note info popover', async () => {
  const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好世界' }] }] })
  useActiveNoteEditorStore.getState().register({ editor: editor as never, path: 'work/a.md', outlineOpen: false, toggleOutline: () => {} })
  await render()
  await act(async () => button('筆記資訊').click())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  const text = document.body.textContent ?? ''
  expect(text).toContain('a.md')
  expect(text).toContain('work')
  expect(text).toContain('2026')
  expect(text).toContain('4 字元')
  expect(text).not.toContain('…')
})

it('keeps only navigation, the command palette and undo/redo for canvas tabs', async () => {
  await render({ activeTab: { id: 'c', path: 'canvas://1', name: 'Board', isFolder: false, kind: 'canvas', canvasId: '1' } })
  expect(labels()).toEqual(['返回 (⌘[)', '前進 (⌘])', '命令面板 (⌘K)', '復原 (⌘Z)', '重做 (⌘Shift+Z)'])
})

it('hides the toolbar for record tabs and outside the active group', async () => {
  await render({ activeTab: { id: 'r', path: 'record://1', name: 'R', isFolder: false, kind: 'record' } })
  expect(host.querySelector('[data-testid="editor-note-toolbar"]')).toBeNull()
  await render({ isActiveGroup: false })
  expect(host.querySelector('[data-testid="editor-note-toolbar"]')).toBeNull()
})

it('collapses the third and fourth groups into a more menu on narrow editors', async () => {
  observedWidth = 600
  await render()
  expect(labels()).toEqual(['返回 (⌘[)', '前進 (⌘])', '在筆記中尋找 (⌘F)', '標籤', '置頂', '收藏', '更多'])
})

it('hides only undo/redo when the undo/redo setting is off', async () => {
  useSettingStore.setState({ showEditorUndoRedo: false })
  await render()
  expect(labels().at(-1)).toBe('命令面板 (⌘K)')
  expect(labels()).toHaveLength(10)
})

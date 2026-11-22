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
// ALMNC-54.20：「送給指揮官」讀筆記庫裡的檔案、交給工作台；toast 換成記錄呼叫的假的。
const send = vi.hoisted(() => ({
  files: new Map<string, string>(),
  outcome: vi.fn<(note: { path: string, content: string }) => Promise<string>>(async () => 'added'),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/daily/note-io', () => ({ readNote: async (path: string) => send.files.get(path) ?? null }))
vi.mock('@/lib/workbench/actions', () => ({ sendNoteToCommander: send.outcome }))
vi.mock('sonner', () => ({ toast: send.toast }))
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
    '在筆記中尋找 (⌘F)', '標籤', '置頂', '收藏', '送給指揮官',
    '開啟大綱 (⇧⌘O)', '版本歷史', '筆記資訊', '命令面板 (⌘⇧P)',
    '復原 (⌘Z)', '重做 (⌘Shift+Z)',
  ])
  expect(host.querySelectorAll('[data-testid="editor-note-toolbar"] > span[aria-hidden]')).toHaveLength(3)
})

// ALMNC-56.2 A11、V07：整列只有一個 Tab 停靠點，左右鍵在列內移動（跳過停用的「前進」）；按鈕用共用元件，列本身不帶底色。
it('is a single tab stop with arrow-key movement, shared buttons and no panel background', async () => {
  await render()
  const toolbar = host.querySelector<HTMLElement>('[data-testid="editor-note-toolbar"]')!
  expect(toolbar.getAttribute('role')).toBe('toolbar')
  expect(toolbar.className).not.toMatch(/\bbg-/)
  expect(toolbarButtons().filter(item => item.tabIndex === 0).map(item => item.getAttribute('aria-label'))).toEqual(['返回 (⌘[)'])
  for (const item of toolbarButtons()) {
    expect(item.className).toContain('rounded-md')
    expect(item.className).toContain('enabled:hover:bg-hover')
  }
  const press = async (key: string) => {
    const target = document.activeElement as HTMLElement
    await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
  }
  await act(async () => button('返回').focus())
  await press('ArrowRight')
  expect(document.activeElement).toBe(button('在筆記中尋找'))
  expect(button('在筆記中尋找').tabIndex).toBe(0)
  expect(button('返回').tabIndex).toBe(-1)
  // 沒有編輯器時復原／重做是停用的，End 停在最後一顆可用的按鈕
  await press('End')
  expect(document.activeElement).toBe(button('命令面板'))
  await press('ArrowRight')
  expect(document.activeElement).toBe(button('返回'))
})

// ALMNC-54.18（取代 56.2 A09）：⌘K 在編輯器裡是插入連結，提示只寫編輯器內外都能用的 ⌘⇧P；按鈕本身照樣打開命令面板。
it('labels the command palette shortcut as ⌘⇧P only, also in the narrow more menu', async () => {
  await render()
  expect(button('命令面板').getAttribute('aria-label')).toBe('命令面板 (⌘⇧P)')
  observedWidth = 600
  await act(async () => root.unmount())
  root = createRoot(host)
  await render()
  const more = button('更多')
  await act(async () => {
    more.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
  })
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(entry => entry.textContent?.startsWith('命令面板'))
  expect(item?.textContent).toBe('命令面板⌘⇧P')
  await act(async () => (item as HTMLElement).click())
  expect(useAnywhereStore.getState().paletteOpen).toBe(true)
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
  // A10：移除鈕的點擊範圍 20 px（size-5）
  expect(document.querySelector<HTMLButtonElement>('button[aria-label="移除 a"]')!.className).toContain('size-5')
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
  expect(labels()).toEqual(['返回 (⌘[)', '前進 (⌘])', '命令面板 (⌘⇧P)', '復原 (⌘Z)', '重做 (⌘Shift+Z)'])
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
  // ALMNC-54.20：「送給指揮官」在第二組，不收進「⋯」，窄版也看得到。
  expect(labels()).toEqual(['返回 (⌘[)', '前進 (⌘])', '在筆記中尋找 (⌘F)', '標籤', '置頂', '收藏', '送給指揮官', '更多'])
})

it('hides only undo/redo when the undo/redo setting is off', async () => {
  useSettingStore.setState({ showEditorUndoRedo: false })
  await render()
  expect(labels().at(-1)).toBe('命令面板 (⌘⇧P)')
  expect(labels()).toHaveLength(11)
})

// ALMNC-54.20 AC#2：右上筆記工具列的「送給指揮官」——送目前這篇筆記，結果用 toast 告訴 Scott。
it('sends the current note to the commander and reports each outcome with a toast', async () => {
  send.files.set('work/a.md', '# A\n內容')
  send.outcome.mockClear()
  send.toast.mockClear(); send.toast.success.mockClear(); send.toast.error.mockClear()
  await render()
  const sendButton = button('送給指揮官')
  expect(sendButton.querySelector('svg.lucide-send')).not.toBeNull()
  await act(async () => sendButton.click())
  expect(send.outcome).toHaveBeenCalledWith({ path: 'work/a.md', content: '# A\n內容' })
  expect(send.toast.success).toHaveBeenLastCalledWith('已送給指揮官')

  send.outcome.mockResolvedValueOnce('unchanged')
  await act(async () => button('送給指揮官').click())
  expect(send.toast).toHaveBeenLastCalledWith('這篇已經送過了，內容沒有變')

  send.outcome.mockResolvedValueOnce('versioned')
  await act(async () => button('送給指揮官').click())
  expect(send.toast.success).toHaveBeenLastCalledWith('內容有更新，已把新版本送給指揮官')

  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  send.outcome.mockRejectedValueOnce(new Error('db down'))
  await act(async () => button('送給指揮官').click())
  expect(send.toast.error).toHaveBeenLastCalledWith('送給指揮官失敗', { description: 'db down' })
})

it('does not offer 送給指揮官 for canvas tabs', async () => {
  await render({ activeTab: { id: 'c', path: 'canvas://1', name: 'Board', isFolder: false, kind: 'canvas', canvasId: '1' } })
  expect(labels()).not.toContain('送給指揮官')
})

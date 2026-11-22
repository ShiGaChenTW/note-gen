// @vitest-environment jsdom
// Fork（almanac ALMNC-56.3 P01）：AI 回覆串流時 chat store 每段都會更新；編輯區只取用到的欄位，
// 不因串流重繪（用 React Profiler 數 commit，並數編輯器本身的 render 次數）。
import { act, createElement as h, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'

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

const editorRenders = vi.hoisted(() => ({ count: 0 }))

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) },
}))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => { throw new Error('not tauri') } }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main', hide: async () => {} }) }))
vi.mock('@/lib/tauri-event-listener', () => ({ listenTauriEvent: async () => () => {} }))
vi.mock('@/lib/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspace')>()),
  getWorkspacePath: async () => ({ path: '/vault', isCustom: true }),
}))
vi.mock('./markdown/md-editor-wrapper', () => ({
  MdEditor: ({ filePath }: { filePath: string }) => {
    editorRenders.count++
    return h('div', { 'data-testid': 'md-editor' }, filePath)
  },
}))
vi.mock('./editor-note-toolbar', () => ({ EditorNoteToolbar: () => null }))
vi.mock('@/components/plugins/plugin-embedded-views', () => ({ PluginEmbeddedViews: () => null }))
vi.mock('@/components/plugins/plugin-document-preview', () => ({ PluginDocumentPreview: () => null }))
vi.mock('@/components/plugins/plugin-view-surface', () => ({ PluginViewSurface: () => null }))
vi.mock('./browser-panel', () => ({ BrowserPanel: () => null }))
vi.mock('./image/image-editor', () => ({ ImageEditor: () => null }))
vi.mock('./folder', () => ({ FolderView: () => null }))
vi.mock('@/app/core/main/bases/bases-page', () => ({ default: () => null }))
vi.mock('@/app/core/main/obsidian-canvas/obsidian-canvas-page', () => ({ default: () => null }))
vi.mock('../mark/mark-detail-panel', () => ({ MarkDetailPanel: () => null }))
vi.mock('../canvas/canvas-editor', () => ({ CanvasEditor: () => null }))

const { useUiModeStore } = await import('@/lib/fork-ui')
const { default: useArticleStore } = await import('@/stores/article')
const { default: useChatStore } = await import('@/stores/chat')
const { useSidebarStore } = await import('@/stores/sidebar')
const { EditorLayout } = await import('./editor-layout')

let container: HTMLDivElement
let root: Root
let commits = 0

function renderTree() {
  root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children:
    h(Profiler, { id: 'editor', onRender: () => { commits++ }, children: h(EditorLayout) }),
  }))
}

async function flush() {
  for (let index = 0; index < 5; index++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useUiModeStore.setState({ mode: 'v3' })
  const tab = { id: 't1', path: 'note.md', name: 'note.md', isFolder: false, kind: 'file' as const }
  useArticleStore.setState({
    initOpenTabs: async () => {},
    initShowCloudFiles: async () => {},
    openTabs: [tab],
    activeTabId: 't1',
    activeFilePath: 'note.md',
  })
  editorRenders.count = 0
  commits = 0
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => renderTree())
  await flush()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('P01: the editor ignores AI streaming updates', () => {
  it('mounts the markdown editor for the open note', () => {
    expect(container.querySelector('[data-testid="md-editor"]')?.textContent).toBe('note.md')
    expect(editorRenders.count).toBeGreaterThan(0)
  })

  it('does not re-render while the chat store streams a reply chunk by chunk', () => {
    const commitsBefore = commits
    const editorBefore = editorRenders.count
    for (let chunk = 1; chunk <= 20; chunk++) {
      act(() => {
        useChatStore.setState({
          chats: [{ id: 1, role: 'system', content: 'x'.repeat(chunk), createdAt: Date.now() } as never],
          loading: true,
        })
      })
    }
    act(() => useChatStore.setState({ loading: false }))
    expect(commits).toBe(commitsBefore)
    expect(editorRenders.count).toBe(editorBefore)
  })

  it('does not re-render when an unrelated sidebar field changes', () => {
    const commitsBefore = commits
    act(() => useSidebarStore.setState({ sidebarSearchFocusRequest: useSidebarStore.getState().sidebarSearchFocusRequest + 1 }))
    act(() => useSidebarStore.setState({ fileSidebarVisible: !useSidebarStore.getState().fileSidebarVisible }))
    expect(commits).toBe(commitsBefore)
  })
})

describe('P02: the editor is memoised', () => {
  it('does not re-render when the parent (the resizable page) re-renders', () => {
    const editorBefore = editorRenders.count
    for (let frame = 0; frame < 5; frame++) act(() => renderTree())
    expect(editorRenders.count).toBe(editorBefore)
  })
})

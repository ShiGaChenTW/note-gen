// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../messages/zh-TW.json'
import { useAnywhereStore } from '@/lib/anywhere/store'
import { useNoteListStore } from '@/lib/note-list/note-list'
import { useSidebarCollapse } from '@/lib/sidebar-v3/collapse'
import emitter from '@/lib/emitter'
import { useUiModeStore } from '@/lib/fork-ui'
import { useWeekOverlay } from '@/lib/week/overlay'
import useCollectStore from '@/stores/collect'
import useDecideStore from '@/stores/decide'
import useHomeStore from '@/stores/home'
import useInboxStore from '@/stores/inbox'
import useSettingStore from '@/stores/setting'
import { useSidebarStore } from '@/stores/sidebar'
import { usePluginUiStore } from '@/lib/plugins/ui-registry'
import { AnywhereService } from './anywhere/anywhere-service'
import { LeftSidebar } from './left-sidebar'
import { PageSurface } from './page-ui'
import { TodayComposer } from './today-v3/composer'
import { RightSidebarCollapsedContext } from './right-sidebar-visibility'
import { CopyButton } from './editor/markdown/footer-bar/copy-button'
import { ExportButton } from './editor/markdown/footer-bar/export-button'
import type { Editor } from '@tiptap/react'

// The sidebar routes via the real overlay stores. File, calendar and plugin
// views are outside this flow and would start desktop IO in jsdom.
vi.mock('./file', () => ({ FileSidebar: () => null }))
vi.mock('./file/file-actions', () => ({ FileActions: () => null }))
vi.mock('./daily/sidebar-calendar', () => ({ SidebarCalendar: () => null }))
vi.mock('./canvas/canvas-sidebar', () => ({ CanvasActions: () => null, CanvasSidebar: () => null }))
vi.mock('./sidebar-search', () => ({ SidebarSearch: () => null }))
vi.mock('./editor/markdown/outline', () => ({ Outline: () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./anywhere/chat-panel', () => ({ AnywhereChatPanel: () => null }))
vi.mock('@/lib/collect/ai', () => ({ askCollectModel: async () => null }))
vi.mock('@/db/agents', () => ({ listAgentSettings: async () => [], ensureDefaultRoster: async () => false }))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  // Node's optional localStorage global can shadow jsdom's Storage.
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useUiModeStore.setState({ mode: 'v3' })
  useSidebarStore.setState({ rightSidebarVisible: false })
  usePluginUiStore.setState({ activeRightView: null })
  useAnywhereStore.setState({ chatOpen: false, paletteOpen: false })
  useCollectStore.setState({ items: [], visible: false })
  useHomeStore.getState().hide()
  useWeekOverlay.getState().hide()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function render(children: React.ReactNode) {
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
}

function keyDown(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  target.dispatchEvent(event)
  return event
}

it('maps the visible Plan entry to the week overlay and removes the V3 navigation in classic', async () => {
  await render(React.createElement(LeftSidebar))
  const nav = host.querySelector('[data-sidebar-v3] nav')!
  expect(nav.textContent).toContain('工作台')
  const plan = [...nav.querySelectorAll('button')].find(button => button.textContent === zhTW.sidebarV3.nav.plan)!
  await act(async () => plan.click())
  expect(useWeekOverlay.getState().visible).toBe(true)
  expect(plan.getAttribute('aria-current')).toBe('page')

  const storage = { get: async () => 'v3', set: async () => {}, save: async () => {} }
  await act(async () => useUiModeStore.getState().setMode('classic', storage))
  expect(host.querySelector('[data-sidebar-v3]')).toBeNull()
  expect(host.querySelector('nav')?.textContent).toContain('Overview')
  expect(host.querySelector('nav')?.textContent).not.toContain('Decide')
})

// Fork（almanac ALMNC-54.8、54.16、54.18、69.3、79.3）：搜尋右側一顆「＋」，選單裡是新增資料源、新增對話；主導覽沒有「收集」。
async function openQuickMenu() {
  const trigger = host.querySelector<HTMLButtonElement>('[data-testid="sidebar-quick"]')!
  await act(async () => { keyDown(trigger, 'Enter') })
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

it('puts 新增資料源, 新增對話 and 新增畫布 in the ＋ menu next to search and no 收集 in the nav', async () => {
  await render(React.createElement(LeftSidebar))
  const nav = host.querySelector('[data-sidebar-v3] nav')!
  expect([...nav.querySelectorAll('button')].map(button => button.textContent?.replace(/\d+$/, ''))).toEqual(['今天', '工作台', '對話', '整理', '計畫'])
  const trigger = host.querySelector<HTMLButtonElement>('[data-testid="sidebar-quick"]')!
  expect(trigger.getAttribute('aria-label')).toBe(zhTW.workbench.quick.label)
  const items = await openQuickMenu()
  // ALMNC-93：加「新增畫布」
  expect(items.map(item => item.dataset.quick)).toEqual(['source', 'thread', 'canvas'])
  expect(items.map(item => item.textContent)).toEqual(['新增資料源', '新增對話', '新增畫布'])
  // ALMNC-56.4：工作台沒開時單鍵 N／T 不作用，就不標（見下一則測試）
  expect(items.map(item => item.getAttribute('aria-keyshortcuts'))).toEqual([null, null, null])
  const opened = vi.fn()
  emitter.on('unified-record-open', opened)
  await act(async () => items[0].click())
  expect(opened).toHaveBeenCalledWith({ target: 'source' })
  emitter.off('unified-record-open', opened)
})

// Fork（almanac ALMNC-56.4，A02）：單鍵 N／T 只在工作台開著、設定沒關時有效，選單也只在那時標快捷鍵。
it('labels N / T in the ＋ menu only while the workbench is open and the setting is on', async () => {
  useSettingStore.setState({ workbenchSingleKeys: true })
  await act(async () => useDecideStore.setState({ visible: true }))
  await render(React.createElement(LeftSidebar))
  let items = await openQuickMenu()
  // 新增畫布沒有單鍵快捷鍵
  expect(items.map(item => item.getAttribute('aria-keyshortcuts'))).toEqual(['N', 'T', null])
  expect(items.map(item => item.textContent)).toEqual(['新增資料源N', '新增對話T', '新增畫布'])
  await act(async () => { keyDown(items[0], 'Escape') })

  await act(async () => useSettingStore.setState({ workbenchSingleKeys: false }))
  items = await openQuickMenu()
  expect(items.map(item => item.getAttribute('aria-keyshortcuts'))).toEqual([null, null, null])
  await act(async () => { keyDown(items[0], 'Escape') })

  await act(async () => {
    useSettingStore.setState({ workbenchSingleKeys: true })
    useDecideStore.setState({ visible: false })
  })
})

// Fork（almanac ALMNC-56.2 A08、ALMNC-79.3）：區段標題整列是收合鈕，「全部筆記」一列開清單；新增鈕 24 px 常駐。
it('collapses 我的筆記 from its header and opens the list from 全部筆記', async () => {
  useSidebarCollapse.setState({ vault: false, agents: false })
  useNoteListStore.setState({ visible: true, folder: '' })
  await render(React.createElement(LeftSidebar))
  await act(async () => useSidebarCollapse.setState({ vault: false, agents: false }))
  const vault = host.querySelector<HTMLElement>(`[data-sidebar-v3] section[aria-label="${zhTW.sidebarV3.vault}"]`)!
  const toggle = vault.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  expect(toggle.getAttribute('aria-label')).toBe('收合我的筆記')
  expect(toggle.textContent).toBe('我的筆記')
  const all = vault.querySelector<HTMLButtonElement>('button[aria-current="page"]')!
  expect(all.textContent).toBe(zhTW.sidebarV3.allNotes)
  expect(all.className).toContain('bg-active')
  await act(async () => useSidebarCollapse.setState({ vault: true, agents: false }))
  expect(toggle.getAttribute('aria-label')).toBe('展開我的筆記')
  expect(vault.textContent).not.toContain(zhTW.sidebarV3.allNotes)
  const addAgent = host.querySelector<HTMLButtonElement>(`[data-sidebar-v3] button[title="${zhTW.sidebarV3.agents.add}"]`)!
  expect(addAgent.className).toContain('size-6')
  useNoteListStore.setState({ visible: false })
})

// Fork（almanac ALMNC-79.3）：底部是設定入口，不再常駐「規則」說明；品牌列 56px。
it('ends with a settings row instead of the rules note', async () => {
  await render(React.createElement(LeftSidebar))
  const sidebar = host.querySelector<HTMLElement>('[data-sidebar-v3]')!
  expect(sidebar.textContent).not.toContain(zhTW.sidebarV3.rules.text)
  expect(sidebar.lastElementChild!.textContent).toContain(zhTW.sidebarV3.settings)
  expect(sidebar.querySelector('[data-sidebar-brand]')!.className).toContain('h-14')
})

// Fork（almanac ALMNC-43.12）：檔案樹標題顯示筆記庫資料夾名稱，切換筆記庫時跟著變；讀屏名稱一起換。
it('titles the file tree with the vault folder name and follows workspace switches', async () => {
  useSidebarCollapse.setState({ vault: false, agents: false })
  useSettingStore.setState({ workspacePath: '/Users/scott/Documents/Almanac' })
  await render(React.createElement(LeftSidebar))
  await act(async () => useSidebarCollapse.setState({ vault: false, agents: false }))
  const section = () => host.querySelector<HTMLElement>('[data-sidebar-v3] section:last-of-type')!
  expect(section().getAttribute('aria-label')).toBe('Almanac')
  expect(section().querySelector('button[aria-expanded]')!.getAttribute('aria-label')).toBe('收合Almanac')
  expect(section().querySelector('button[aria-expanded]')!.textContent).toBe('Almanac')
  await act(async () => useSettingStore.setState({ workspacePath: '/Users/scott/Personal/' }))
  expect(section().getAttribute('aria-label')).toBe('Personal')
  expect(section().querySelector('button[aria-expanded]')!.getAttribute('aria-label')).toBe('收合Personal')
  useSettingStore.setState({ workspacePath: '' })
})

it('switches to Ask with Tab and lets the next Tab and Shift+Tab leave the input', async () => {
  await render(React.createElement(TodayComposer))
  const input = host.querySelector('input')!
  let first!: KeyboardEvent
  await act(async () => { first = keyDown(input, 'Tab') })
  expect(first.defaultPrevented).toBe(true)
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toBe(zhTW.todayV3.composer.ask)
  await act(async () => { first = keyDown(input, 'Tab') })
  expect(first.defaultPrevented).toBe(false)
  expect(keyDown(input, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false)
})

it('moves focus into a V3 page and returns focus to its opener after Escape', async () => {
  function Launcher() {
    const [open, setOpen] = React.useState(false)
    const surfaceProps = { label: 'Review', onDismiss: () => setOpen(false), children: 'Review' }
    return React.createElement(React.Fragment, null,
      React.createElement('button', { onClick: () => setOpen(true) }, 'Open'),
      open && React.createElement(PageSurface, surfaceProps),
    )
  }
  await render(React.createElement(Launcher))
  const opener = host.querySelector('button')!
  opener.focus()
  await act(async () => opener.click())
  const surface = host.querySelector<HTMLElement>('[aria-label="Review"]')!
  expect(document.activeElement).toBe(surface)
  await act(async () => keyDown(surface, 'Escape', { isComposing: true }))
  expect(surface.isConnected).toBe(true)
  await act(async () => keyDown(surface, 'Escape'))
  expect(surface.isConnected).toBe(false)
  expect(document.activeElement).toBe(opener)
})

it('localizes the visible copy and export actions in the editor status bar', async () => {
  // Neither trigger touches the editor until an export format is selected.
  const editor = {} as Editor
  await render(React.createElement(React.Fragment, null,
    React.createElement(CopyButton, { editor }),
    React.createElement(ExportButton, { editor }),
  ))
  expect([...host.querySelectorAll('button')].map(button => button.textContent)).toEqual(['複製', '匯出'])
})

it('opens the command palette with ⌘K, restores focus and opens Sources by keyword', async () => {
  const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} })
  try {
    await render(React.createElement(React.Fragment, null,
      React.createElement('button', null, 'Workspace'),
      React.createElement(AnywhereService),
    ))
    const opener = host.querySelector('button')!
    opener.focus()
    await act(async () => keyDown(opener, 'k', { metaKey: true, code: 'KeyK' }))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(zhTW.anywhere.palette.title)
    expect(document.activeElement?.getAttribute('aria-label')).toBe(zhTW.anywhere.palette.placeholder)
    await act(async () => keyDown(document.activeElement as HTMLElement, 'Escape'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(opener))

    await act(async () => keyDown(opener, 'k', { metaKey: true, code: 'KeyK' }))
    await typeIn(document.activeElement as HTMLInputElement, '新增資料源')
    const command = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find(option => option.textContent === '開啟資料源')
    expect(command).toBeDefined()
    await act(async () => command!.click())
    expect(useCollectStore.getState().visible).toBe(true)
    expect(useInboxStore.getState().visible).toBe(false)
  } finally {
    if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

// Fork（almanac ALMNC-54.18）：⌘⇧P 在編輯器裡也打開命令面板（⌘K 在那裡是插入連結），而且不讓編輯器或外掛命令面板再接一次。
it('opens the command palette with ⌘⇧P even from inside the note editor', async () => {
  const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} })
  try {
    await render(React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'ProseMirror', contentEditable: true, suppressContentEditableWarning: true, tabIndex: 0 }, 'note'),
      React.createElement(AnywhereService),
    ))
    expect(useAnywhereStore.getState().paletteHosted).toBe(true)
    const editor = host.querySelector<HTMLElement>('.ProseMirror')!
    const editorSaw = vi.fn()
    editor.addEventListener('keydown', editorSaw)
    // ⌘K 在編輯器裡不攔
    await act(async () => keyDown(editor, 'k', { metaKey: true, code: 'KeyK' }))
    expect(useAnywhereStore.getState().paletteOpen).toBe(false)
    // ⌘⇧P（注音下 key 不是 p 也用實體鍵位認）
    let event!: KeyboardEvent
    await act(async () => { event = keyDown(editor, 'ㄣ', { metaKey: true, shiftKey: true, code: 'KeyP' }) })
    expect(event.defaultPrevented).toBe(true)
    expect(useAnywhereStore.getState().paletteOpen).toBe(true)
    expect(editorSaw).toHaveBeenCalledTimes(1) // 只有前面那次 ⌘K
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    // Ctrl+Shift+P 再按一次關掉
    await act(async () => keyDown(document.activeElement as HTMLElement, 'P', { ctrlKey: true, shiftKey: true, code: 'KeyP' }))
    expect(useAnywhereStore.getState().paletteOpen).toBe(false)
    // classic 不接，交還給外掛命令面板
    await act(async () => useUiModeStore.setState({ mode: 'classic' }))
    expect(useAnywhereStore.getState().paletteHosted).toBe(false)
    await act(async () => keyDown(editor, 'p', { metaKey: true, shiftKey: true, code: 'KeyP' }))
    expect(useAnywhereStore.getState().paletteOpen).toBe(false)
  } finally {
    if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

async function typeIn(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('submits a note with Enter after IME composition ends', async () => {
  await render(React.createElement(TodayComposer))
  const input = host.querySelector('input')!
  expect(input.placeholder).toContain('新增資料源')
  expect([...host.querySelectorAll('button')].some(button => button.textContent === '新增資料源')).toBe(true)
  await typeIn(input, '先閱讀提案')

  await act(async () => keyDown(input, 'Enter', { isComposing: true }))
  expect(useCollectStore.getState().items).toHaveLength(0)
  await act(async () => keyDown(input, 'Enter'))
  expect(useCollectStore.getState().items[0]?.input.text).toBe('先閱讀提案')
  expect(input.value).toBe('')
})

it('opens Anywhere chat and sends the question when Enter is pressed in Ask mode', async () => {
  const originalModel = useSettingStore.getState().primaryModel
  useSettingStore.setState({ primaryModel: 'test-model' })
  const prompts: string[] = []
  const onSend = (prompt: string) => prompts.push(prompt)
  emitter.on('quick-prompt-send', onSend)
  try {
    await render(React.createElement(TodayComposer))
    const input = host.querySelector('input')!
    await act(async () => keyDown(input, 'Tab'))
    await typeIn(input, '提案要改哪裡？')
    await act(async () => keyDown(input, 'Enter'))
    expect(useAnywhereStore.getState().chatOpen).toBe(true)
    expect(input.value).toBe('')
    await vi.waitFor(() => expect(prompts).toEqual(['提案要改哪裡？']))
    expect(useCollectStore.getState().items).toEqual([])
  } finally {
    await act(async () => useSettingStore.setState({ primaryModel: originalModel }))
    emitter.off('quick-prompt-send', onSend)
  }
})


it('returns Ask to Note when right sidebar chat opens and preserves the draft', async () => {
  await render(React.createElement(TodayComposer))
  const input = host.querySelector('input')!
  await act(async () => keyDown(input, 'Tab'))
  await typeIn(input, '未送出的草稿')

  await act(async () => useSidebarStore.setState({ rightSidebarVisible: true }))
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toBe(zhTW.todayV3.composer.note)
  expect(host.querySelector('[aria-pressed="false"]')).toBeNull()
  expect(host.querySelector('kbd')).toBeNull()
  expect(input.placeholder).not.toContain('Tab')
  expect(input.value).toBe('未送出的草稿')
  expect(keyDown(input, 'Tab').defaultPrevented).toBe(false)

  await act(async () => useSidebarStore.setState({ rightSidebarVisible: false }))
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toBe(zhTW.todayV3.composer.note)
  expect(host.querySelector('[aria-pressed="false"]')?.textContent).toBe(zhTW.todayV3.composer.ask)
  expect(host.querySelector('kbd')?.textContent).toBe('Tab')
})

it('offers Ask when the visible sidebar shows a different tab or in classic', async () => {
  useSidebarStore.setState({ rightSidebarVisible: true })
  usePluginUiStore.setState({ activeRightView: '@backlinks' })
  await render(React.createElement(TodayComposer))
  expect(host.querySelector('[aria-pressed="false"]')?.textContent).toBe(zhTW.todayV3.composer.ask)

  await act(async () => usePluginUiStore.setState({ activeRightView: null }))
  expect(host.querySelector('[aria-pressed="false"]')).toBeNull()

  await act(async () => useUiModeStore.setState({ mode: 'classic' }))
  expect(host.querySelector('[aria-pressed="false"]')?.textContent).toBe(zhTW.todayV3.composer.ask)
})


it('offers Ask after the right sidebar is collapsed by dragging its panel', async () => {
  useSidebarStore.setState({ rightSidebarVisible: true })
  const composer = React.createElement(TodayComposer)
  await render(React.createElement(RightSidebarCollapsedContext.Provider, { value: false }, composer))
  expect(host.querySelector('[aria-pressed="false"]')).toBeNull()

  await render(React.createElement(RightSidebarCollapsedContext.Provider, { value: true }, composer))
  expect(host.querySelector('[aria-pressed="false"]')?.textContent).toBe(zhTW.todayV3.composer.ask)
})

// @vitest-environment jsdom
// almanac ALMNC-56.2：V3 底部格式列——打字時不重繪（P04）、roving tabindex（A11）、scrollMargin（A03）、共用按鈕與陰影 token（V07、V10）。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import zhTW from '../../../../../../messages/zh-TW.json'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'macos' }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('./slash-command/suggestion', () => ({ createMarkdownLinksForFilePaths: vi.fn() }))
// 顏色鈕換成會計數的替身：格式列每重繪一次，它就被呼叫兩次（螢光、文字色）。
const colorMenuRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('./color-menu', async () => {
  const { createElement } = await import('react')
  return {
    ColorMenu: ({ highlight }: { highlight?: boolean }) => {
      colorMenuRenders.count += 1
      return createElement('button', { type: 'button', 'aria-label': highlight ? '螢光筆' : '文字顏色' })
    },
  }
})

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const { BOTTOM_TOOLBAR_SCROLL_MARGIN, BOTTOM_TOOLBAR_SCROLL_THRESHOLD, BottomFormatToolbar } = await import('./bottom-format-toolbar')

let host: HTMLDivElement
let root: Root
let editor: Editor

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // 聚焦按鈕會打開 Radix Tooltip，它量尺寸要用 ResizeObserver
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  colorMenuRenders.count = 0
  editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit], content: '<p>hello</p>' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  editor.destroy()
  vi.unstubAllGlobals()
})

async function render() {
  const toolbar = React.createElement(BottomFormatToolbar, { editor, onInsertImage: () => {}, onOpenLink: () => {} })
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: toolbar }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
}

const toolbar = () => host.querySelector<HTMLElement>('[data-testid="bottom-format-toolbar"]')!
const buttons = () => [...toolbar().querySelectorAll<HTMLButtonElement>('button')]
const button = (label: string) => buttons().find(item => item.getAttribute('aria-label')?.startsWith(label))!

it('does not re-render while typing plain text, only when a button lights up', async () => {
  await render()
  const rendersAfterMount = colorMenuRenders.count
  expect(rendersAfterMount).toBeGreaterThan(0)
  await act(async () => { editor.commands.insertContent(' world') })
  await act(async () => { editor.commands.insertContent('!') })
  await act(async () => { editor.commands.setTextSelection(2) })
  expect(colorMenuRenders.count).toBe(rendersAfterMount)
  expect(button('粗體').getAttribute('aria-pressed')).toBe('false')

  await act(async () => { editor.commands.toggleBold() })
  expect(colorMenuRenders.count).toBe(rendersAfterMount + 2)
  expect(button('粗體').getAttribute('aria-pressed')).toBe('true')
  // 粗體狀態下繼續打字，亮起狀態不變，也不重繪
  await act(async () => { editor.commands.insertContent('x') })
  expect(colorMenuRenders.count).toBe(rendersAfterMount + 2)
})

it('is a single tab stop and moves between buttons with the arrow keys', async () => {
  await render()
  expect(toolbar().getAttribute('role')).toBe('toolbar')
  expect(buttons().filter(item => item.tabIndex === 0).map(item => item.getAttribute('aria-label'))).toEqual(['粗體 (⌘B)'])
  const press = async (key: string) => {
    const target = document.activeElement as HTMLElement
    await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
  }
  await act(async () => button('粗體').focus())
  await press('ArrowRight')
  expect(document.activeElement).toBe(button('斜體'))
  expect(button('斜體').tabIndex).toBe(0)
  expect(button('粗體').tabIndex).toBe(-1)
  await press('End')
  expect(document.activeElement).toBe(button('更多'))
  await press('ArrowRight')
  expect(document.activeElement).toBe(button('粗體'))
})

it('keeps the caret line above the toolbar while it is shown', async () => {
  expect(editor.view.someProp('scrollMargin')).toBeUndefined()
  expect(editor.view.someProp('scrollThreshold')).toBeUndefined()
  await render()
  // 游標行一進到離底 64 px（列高 36＋離底 16＝52 px）就捲動，捲完停在離底 64 px
  expect(editor.view.someProp('scrollThreshold')).toEqual(BOTTOM_TOOLBAR_SCROLL_THRESHOLD)
  expect(editor.view.someProp('scrollMargin')).toEqual(BOTTOM_TOOLBAR_SCROLL_MARGIN)
  expect(BOTTOM_TOOLBAR_SCROLL_THRESHOLD.bottom).toBeGreaterThanOrEqual(64)
  expect(BOTTOM_TOOLBAR_SCROLL_MARGIN.bottom).toBeGreaterThanOrEqual(64)
  await act(async () => root.unmount())
  root = createRoot(host)
  expect(editor.view.someProp('scrollMargin')).toBeUndefined()
  expect(editor.view.someProp('scrollThreshold')).toBeUndefined()
})

it('uses the shared toolbar buttons and the float shadow token', async () => {
  await render()
  expect(toolbar().className).toContain('shadow-float')
  expect(toolbar().className).not.toMatch(/\bshadow-(sm|md|lg)\b/)
  expect(toolbar().className).not.toContain('rounded-full')
  for (const item of buttons().filter(entry => !['螢光筆', '文字顏色'].includes(entry.getAttribute('aria-label') ?? ''))) {
    expect(item.className).toContain('rounded-md')
    expect(item.className).toContain('enabled:hover:bg-hover')
    expect(item.className).toContain('focus-visible:ring-1')
  }
})

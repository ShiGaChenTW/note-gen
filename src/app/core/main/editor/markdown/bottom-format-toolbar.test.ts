// @vitest-environment jsdom
// almanac ALMNC-56.2：V3 底部格式列——roving tabindex（A11）。
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
// 顏色鈕換成簡單的替身（不碰 bubble menu 的下拉選單）。
vi.mock('./color-menu', async () => {
  const { createElement } = await import('react')
  return {
    ColorMenu: ({ highlight }: { highlight?: boolean }) => createElement('button', { type: 'button', 'aria-label': highlight ? '螢光筆' : '文字顏色' }),
  }
})

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const { BottomFormatToolbar } = await import('./bottom-format-toolbar')

let host: HTMLDivElement
let root: Root
let editor: Editor

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // 聚焦按鈕會打開 Radix Tooltip，它量尺寸要用 ResizeObserver
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
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


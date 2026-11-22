// @vitest-environment jsdom
// Fork（almanac ALMNC-54.18）：V3 主畫面的命令面板掛著時，⌘⇧P 讓給它；沒掛（classic、獨立編輯器視窗）時外掛命令面板照舊。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../messages/zh-TW.json'
import { useAnywhereStore } from '@/lib/anywhere/store'
import { PluginCommandPalette } from './plugin-command-palette'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useAnywhereStore.setState({ paletteHosted: false })
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

async function pressShortcut() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }))
  })
}

const dialogTitle = () => [...document.querySelectorAll('[role="dialog"]')].map(dialog => dialog.textContent ?? '').join('')

it('leaves ⌘⇧P to the V3 command palette while it is mounted, and opens otherwise', async () => {
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: React.createElement(PluginCommandPalette) }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))

  useAnywhereStore.setState({ paletteHosted: true })
  await pressShortcut()
  expect(document.querySelector('[role="dialog"]')).toBeNull()

  useAnywhereStore.setState({ paletteHosted: false })
  await pressShortcut()
  expect(dialogTitle()).toContain(zhTW.settings.plugins.commandPalette.title)
})

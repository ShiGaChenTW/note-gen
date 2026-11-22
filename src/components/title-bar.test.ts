// @vitest-environment jsdom
// Fork（almanac ALMNC-54.18）：標題列左上的＋在 V3 打開新增資料源（和側欄↓同一個對話框），classic 照舊開記錄對話框。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../messages/zh-TW.json'
import emitter from '@/lib/emitter'
import { useUiModeStore } from '@/lib/fork-ui'
import { TitleBar } from './title-bar'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'macos' }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }))
vi.mock('@/lib/check', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/check')>()), isMobileDevice: () => false }))
vi.mock('./plugins/plugin-title-bar', () => ({ PluginTitleBar: () => null }))
vi.mock('./pin-toggle', () => ({ PinToggle: () => null }))
vi.mock('./app-status', () => ({ default: () => null }))
vi.mock('@/components/wiki/use-wiki-navigation', () => ({ useWikiNavigation: () => ({ openFolder: async () => {} }) }))

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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useUiModeStore.setState({ mode: 'v3' })
})

async function clickPlus() {
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: React.createElement(TitleBar) }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
  const plus = host.querySelector<HTMLButtonElement>('#onboarding-target-record-toolbar button')!
  const opened = vi.fn()
  emitter.on('unified-record-open', opened)
  await act(async () => plus.click())
  emitter.off('unified-record-open', opened)
  return { plus, opened }
}

it('opens 新增資料源 from the top-left ＋ in V3', async () => {
  useUiModeStore.setState({ mode: 'v3' })
  const { plus, opened } = await clickPlus()
  expect(plus.getAttribute('aria-label')).toBe(zhTW.workbench.quick.addSource)
  expect(plus.getAttribute('title')).toBe('新增資料源')
  expect(opened).toHaveBeenCalledWith({ target: 'source' })
})

it('keeps the record dialog behind the ＋ in classic', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  const { plus, opened } = await clickPlus()
  expect(plus.getAttribute('aria-label')).toBe(zhTW.record.mark.unified.title)
  expect(opened).toHaveBeenCalledTimes(1)
  expect(opened.mock.calls[0][0]).toBeUndefined()
})

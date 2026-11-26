// @vitest-environment jsdom
// almanac ALMNC-83.3：提示詞功能關閉時，每日筆記設定不顯示「提示詞資料夾」（設定值保留）。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import { PROMPT_LIBRARY_ENABLED } from '@/lib/prompt-library/feature'
import useDailySettingsStore from '@/stores/daily-settings'

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) } }))
vi.mock('@/lib/daily/open-daily-note', () => ({ openDailyNote: async () => {} }))
vi.mock('@/lib/reminders/service', () => ({ ensureNotificationPermission: async () => true, notify: async () => {} }))

const { default: DailySettingPage } = await import('./page')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

it('hides the prompt folder setting while the prompt library is off', async () => {
  expect(PROMPT_LIBRARY_ENABLED).toBe(false)
  useDailySettingsStore.setState({ initialized: true, promptFolder: 'Prompts' })
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: React.createElement(DailySettingPage) }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
  const text = host.textContent ?? ''
  expect(text).toContain(zhTW.settings.daily.inboxFolder.title)
  expect(text).not.toContain(zhTW.settings.daily.promptFolder.title)
  expect(useDailySettingsStore.getState().promptFolder).toBe('Prompts')
})

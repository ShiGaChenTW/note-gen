// @vitest-environment jsdom
// almanac ALMNC-83.3 驗收 #1：設定選單沒有「提示詞」（對話角色、Agent 自訂指引）——桌面與手機設定選單、新舊兩種介面都不列。
// settings-dialog-hidden-pages.test.ts 測的是可見規則本身；這裡實際渲染兩個選單元件。
// 對照組把開關切成 true 並重新載入模組（隱藏清單在 import 時決定），證明同一套 harness 看得到「提示詞」。
import React, { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'

const flag = vi.hoisted(() => ({ actual: undefined as boolean | undefined, value: undefined as boolean | undefined }))

vi.mock('@/lib/prompt-library/feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/prompt-library/feature')>()
  flag.actual = actual.PROMPT_LIBRARY_ENABLED
  return { get PROMPT_LIBRARY_ENABLED() { return flag.value ?? flag.actual } }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/stores/plugins', () => {
  const state = { installed: [], isEnabled: () => false }
  return { usePluginStore: (selector: (s: typeof state) => unknown) => selector(state) }
})
vi.mock('@/lib/plugins/localization', () => ({ usePluginLocalization: () => 0 }))
vi.mock('@/stores/update', () => ({ default: () => ({ hasUpdate: false }) }))

const PROMPT_TITLE = zhTW.settings.prompt.title

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
  flag.value = undefined
})

async function loadMenus(enabled?: boolean) {
  flag.value = enabled
  vi.resetModules()
  const [{ SettingTab: DesktopSettingTab }, { SettingTab: MobileSettingTab }, { Tabs }, { useUiModeStore }] = await Promise.all([
    import('./setting-tab'),
    import('@/app/mobile/setting/components/setting-tab'),
    import('@/components/ui/tabs'),
    import('@/lib/fork-ui'),
  ])
  // 沒指定開關時走真實值（false）；確定真的讀到了，避免 undefined 被當成關閉而空過。
  if (enabled === undefined) expect(flag.actual).toBe(false)
  return { DesktopSettingTab, MobileSettingTab, Tabs, useUiModeStore }
}

async function render(node: React.ReactElement) {
  await act(async () => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: node })))
}

async function desktopMenuTitles(enabled: boolean | undefined, mode: 'v3' | 'classic') {
  const { DesktopSettingTab, Tabs, useUiModeStore } = await loadMenus(enabled)
  useUiModeStore.setState({ mode })
  await render(h(Tabs, { defaultValue: 'general', orientation: 'vertical' }, h(DesktopSettingTab)))
  return [...host.querySelectorAll('[role="tab"]')].map(tab => tab.textContent?.trim())
}

async function mobileMenuTitles(enabled: boolean | undefined, mode: 'v3' | 'classic') {
  const { MobileSettingTab, useUiModeStore } = await loadMenus(enabled)
  useUiModeStore.setState({ mode })
  await render(h(MobileSettingTab))
  return [...host.querySelectorAll('button')].map(button => button.textContent?.trim())
}

describe('ALMNC-83.3 settings menu has no 提示詞 page', () => {
  it('the real feature flag is off', async () => {
    const real = await vi.importActual<typeof import('@/lib/prompt-library/feature')>('@/lib/prompt-library/feature')
    expect(real.PROMPT_LIBRARY_ENABLED).toBe(false)
  })

  for (const mode of ['v3', 'classic'] as const) {
    it(`desktop settings menu (${mode}) lists no 提示詞 tab`, async () => {
      const titles = await desktopMenuTitles(undefined, mode)
      expect(titles).toContain(zhTW.settings.general.title)
      expect(titles).not.toContain(PROMPT_TITLE)
    })

    it(`mobile settings menu (${mode}) lists no 提示詞 item`, async () => {
      const titles = await mobileMenuTitles(undefined, mode)
      expect(titles).toContain(zhTW.settings.general.title)
      expect(titles).not.toContain(PROMPT_TITLE)
    })
  }

  it('control: with the flag on, both menus do list 提示詞 (both UIs)', async () => {
    for (const mode of ['v3', 'classic'] as const) {
      expect(await desktopMenuTitles(true, mode)).toContain(PROMPT_TITLE)
      await act(async () => root.render(null))
      expect(await mobileMenuTitles(true, mode)).toContain(PROMPT_TITLE)
      await act(async () => root.render(null))
    }
  })
})

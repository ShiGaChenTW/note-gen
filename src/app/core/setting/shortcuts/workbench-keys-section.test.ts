// @vitest-environment jsdom
// Fork（almanac ALMNC-56.4，RPT-2026-009 A02）：設定裡可以關掉工作台單鍵 N／T；只在新介面出現。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import zhTW from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'

const setWorkbenchSingleKeys = vi.hoisted(() => vi.fn<(value: boolean) => Promise<void>>(async () => {}))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

vi.mock('@/stores/setting', async () => {
  const { create } = await import('zustand')
  const store = create<{ workbenchSingleKeys: boolean, setWorkbenchSingleKeys: (value: boolean) => Promise<void> }>(set => ({
    workbenchSingleKeys: true,
    setWorkbenchSingleKeys: async (value: boolean) => { set({ workbenchSingleKeys: value }); await setWorkbenchSingleKeys(value) },
  }))
  return { default: store }
})

const useSettingStore = (await import('@/stores/setting')).default
const { WorkbenchKeysSection } = await import('./workbench-keys-section')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  setWorkbenchSingleKeys.mockClear()
  useSettingStore.setState({ workbenchSingleKeys: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render() {
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(WorkbenchKeysSection) })))
}

it('V3: shows the N / T switch (on by default) and saves turning it off', async () => {
  useUiModeStore.setState({ mode: 'v3' })
  render()
  expect(container.textContent).toContain('工作台單鍵')
  expect(container.textContent).toContain('N 新增資料源、T 新增對話')
  const toggle = container.querySelector<HTMLButtonElement>('[data-testid="workbench-single-keys"]')!
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  await act(async () => toggle.click())
  expect(setWorkbenchSingleKeys).toHaveBeenCalledWith(false)
  expect(container.querySelector('[data-testid="workbench-single-keys"]')!.getAttribute('aria-checked')).toBe('false')
})

it('classic: the section is not shown', () => {
  useUiModeStore.setState({ mode: 'classic' })
  render()
  expect(container.innerHTML).toBe('')
})

it('has the same workbenchKeys strings in all three locales', () => {
  const keys = (value: object) => JSON.stringify(Object.keys(value)) + JSON.stringify(Object.keys((value as { singleKeys: object }).singleKeys))
  expect(keys(zh.settings.shortcuts.workbenchKeys)).toBe(keys(zhTW.settings.shortcuts.workbenchKeys))
  expect(keys(en.settings.shortcuts.workbenchKeys)).toBe(keys(zhTW.settings.shortcuts.workbenchKeys))
})

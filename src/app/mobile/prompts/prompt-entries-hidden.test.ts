// @vitest-environment jsdom
// almanac ALMNC-83.3 驗收 #1：提示詞功能關閉時，直接進 /mobile/prompts 會退回上一頁，不渲染提示詞庫。
// 對照組把開關切成 true，證明同一套 harness 會看到提示詞庫畫面、也不會退回。
import React, { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../messages/zh-TW.json'

const flag = vi.hoisted(() => ({ actual: undefined as boolean | undefined, value: false }))
const router = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }))

vi.mock('@/lib/prompt-library/feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/prompt-library/feature')>()
  flag.actual = actual.PROMPT_LIBRARY_ENABLED
  flag.value = actual.PROMPT_LIBRARY_ENABLED
  return { get PROMPT_LIBRARY_ENABLED() { return flag.value } }
})
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) } }))
vi.mock('@/db/prompt-usage', () => ({ getPromptUsageMap: async () => new Map() }))
vi.mock('@/stores/article', () => ({ default: { getState: () => ({ setActiveFilePath: async () => {} }) } }))
vi.mock('@/app/core/main/prompt-library/prompt-detail-panel', () => ({ PromptDetailPanel: () => h('div', { 'data-marker': 'prompt-detail' }) }))

const { default: MobilePromptsPage } = await import('./page')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  router.back.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  flag.value = flag.actual ?? false
})

async function render() {
  await act(async () => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(MobilePromptsPage) })))
}

describe('ALMNC-83.3 /mobile/prompts follows PROMPT_LIBRARY_ENABLED', () => {
  it('the real feature flag is off', () => {
    expect(flag.actual).toBe(false)
  })

  it('renders nothing and navigates back while the prompt library is off', async () => {
    await render()
    expect(host.innerHTML).toBe('')
    expect(host.textContent).not.toContain(zhTW.promptLibrary.title)
    expect(router.back).toHaveBeenCalledTimes(1)
  })

  it('control: with the flag on, the prompt library renders and stays', async () => {
    flag.value = true
    await render()
    expect(host.textContent).toContain(zhTW.promptLibrary.title)
    expect(router.back).not.toHaveBeenCalled()
  })
})

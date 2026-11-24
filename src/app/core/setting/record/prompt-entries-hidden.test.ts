// @vitest-environment jsdom
// almanac ALMNC-83.3 驗收 #1：提示詞功能關閉時，記錄工具列設定不列 Prompt 素材（設定值保留）。
// 對照組把開關切成 true，證明同一套 harness 看得到 Prompt 素材。
import React, { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'

await vi.hoisted(async () => { vi.stubGlobal('React', (await import('react')).default) })

const flag = vi.hoisted(() => ({ actual: undefined as boolean | undefined, value: undefined as boolean | undefined }))

vi.mock('@/lib/prompt-library/feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/prompt-library/feature')>()
  flag.actual = actual.PROMPT_LIBRARY_ENABLED
  return { get PROMPT_LIBRARY_ENABLED() { return flag.value ?? flag.actual } }
})
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) } }))

const { ToolbarSettings } = await import('./toolbar-settings')
const { default: useSettingStore } = await import('@/stores/setting')

const PROMPT_DRAFT = zhTW.record.mark.toolbar.promptDraft
const PROMPT_DRAFT_DESC = zhTW.settings.record.toolbar.recordToolbar.promptDraft.desc

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

// 拖曳把手的 aria-label 用到 zh-TW 沒有的 common.sort（與本票無關），只略過缺字警告。
function ignoreMissingMessage(error: { code?: string }) {
  if (error.code !== 'MISSING_MESSAGE') throw error
}

async function render() {
  await act(async () => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', onError: ignoreMissingMessage, children: h(ToolbarSettings) })))
}

describe('ALMNC-83.3 record toolbar settings follow PROMPT_LIBRARY_ENABLED', () => {
  it('the real feature flag is off', () => {
    expect(flag.actual).toBe(false)
  })

  it('lists the other record tools but not Prompt 素材, and keeps the stored item', async () => {
    const stored = useSettingStore.getState().recordToolbarConfig
    expect(stored.some(item => item.id === 'prompt-draft' && item.enabled)).toBe(true)
    await render()
    const text = host.textContent ?? ''
    expect(text).toContain(zhTW.record.mark.toolbar.text)
    expect(text).toContain(zhTW.record.mark.toolbar.todo)
    expect(text).not.toContain(PROMPT_DRAFT)
    expect(text).not.toContain(PROMPT_DRAFT_DESC)
    expect(useSettingStore.getState().recordToolbarConfig).toEqual(stored)
  })

  it('control: with the flag on, Prompt 素材 is listed', async () => {
    flag.value = true
    await render()
    expect(host.textContent).toContain(PROMPT_DRAFT)
  })
})

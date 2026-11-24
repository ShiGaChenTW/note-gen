// @vitest-environment jsdom
// almanac ALMNC-83.3 驗收 #1：提示詞功能關閉時，手機「我的」頁不列「個人提示詞庫」入口。
// 渲染真正的 MobileMePage，重的子元件與同步連線換掉；對照組把開關切成 true，證明 harness 看得到入口並會導向 /mobile/prompts。
import React, { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
})

const flag = vi.hoisted(() => ({ actual: undefined as boolean | undefined, value: undefined as boolean | undefined }))
const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }))

vi.mock('@/lib/prompt-library/feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/prompt-library/feature')>()
  flag.actual = actual.PROMPT_LIBRARY_ENABLED
  return { get PROMPT_LIBRARY_ENABLED() { return flag.value ?? flag.actual } }
})
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) } }))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'ios' }))
vi.mock('@/lib/activity', () => ({ loadActivityCalendarData: () => new Promise(() => {}) }))
vi.mock('@/components/activity/activity-heatmap', () => ({ ActivityHeatmap: () => null }))
vi.mock('@/lib/sync/s3', () => ({ testS3Connection: async () => false }))
vi.mock('@/lib/sync/webdav', () => ({ testWebDAVConnection: async () => false }))
vi.mock('@/lib/sync/cloud-folder', () => ({ testCloudFolderConnection: async () => false }))
vi.mock('@/stores/setting', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({ primaryBackupMethod: 'local', workspacePath: '/vault', githubCustomSyncRepo: '', giteeCustomSyncRepo: '', gitlabCustomSyncRepo: '', giteaCustomSyncRepo: '' })),
    useSettingsHydrationStore: create(() => ({ status: 'loading' })),
  }
})
vi.mock('@/stores/sync', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({})) }
})
vi.mock('./mobile-me-activity-drawer', () => ({ MobileMeActivityDrawer: () => null }))
vi.mock('./mobile-me-profile-card', () => ({ MobileMeProfileCard: () => null }))
vi.mock('./mobile-update-settings', () => ({ MobileUpdateSettings: () => null }))
vi.mock('./setting-tab', () => ({ SettingTab: () => h('div', { 'data-marker': 'setting-tab' }) }))

const { MobileMePage } = await import('./mobile-me-page')

const PROMPT_LIBRARY = zhTW.promptLibrary.title

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  router.push.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  flag.value = undefined
})

// 這頁先用 t() 取活動摘要的原始樣板、之後才代入數字，next-intl 會報 FORMATTING_ERROR（與本票無關），只略過這一種。
function ignoreTemplateFormatting(error: { code?: string }) {
  if (error.code !== 'FORMATTING_ERROR') throw error
}

async function render() {
  await act(async () => root.render(h(NextIntlClientProvider, {
    locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', onError: ignoreTemplateFormatting,
    children: h(MobileMePage, { refreshOnMount: false, animateEntrance: false }),
  })))
  // 頁面真的渲染到設定區塊（提示詞庫入口原本就在它上方）。
  expect(host.textContent).toContain(zhTW.mobile.me.settings.title)
  expect(host.querySelector('[data-marker="setting-tab"]')).not.toBeNull()
}

const promptLibraryButton = () => [...host.querySelectorAll('button')].find(button => button.textContent?.includes(PROMPT_LIBRARY))

describe('ALMNC-83.3 mobile 我的 page follows PROMPT_LIBRARY_ENABLED', () => {
  it('the real feature flag is off', () => {
    expect(flag.actual).toBe(false)
  })

  it('does not list the 個人提示詞庫 entry', async () => {
    await render()
    expect(promptLibraryButton()).toBeUndefined()
    expect(host.textContent).not.toContain(PROMPT_LIBRARY)
  })

  it('control: with the flag on, the entry is listed and opens /mobile/prompts', async () => {
    flag.value = true
    await render()
    const button = promptLibraryButton()
    expect(button).toBeDefined()
    await act(async () => button!.click())
    expect(router.push).toHaveBeenCalledWith('/mobile/prompts')
  })
})

// @vitest-environment jsdom
// Fork（almanac ALMNC-84.1）：進階設定（桌面與手機共用）不再顯示「清理資料」「清理檔案」與「危險操作」。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'

const store = vi.hoisted(() => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => store } }))
vi.mock('@/lib/developer-tools', () => ({
  openDeveloperTools: vi.fn(),
  supportsNativeDeveloperTools: () => false,
}))
vi.mock('./system-permissions', () => ({ SystemPermissions: () => null }))
vi.mock('./app-lock-settings', () => ({ AppLockSettings: () => null }))
vi.mock('./developer-diagnostics', () => ({ DeveloperDiagnostics: () => null }))
vi.mock('./config-file-actions', () => ({ ConfigFileActions: () => null }))

const { AdvancedSettings } = await import('./advanced-settings')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function renderAdvanced(showConfigFileActions: boolean) {
  await act(async () => {
    root.render(
      React.createElement(
        NextIntlClientProvider,
        {
          locale: 'zh-TW',
          messages: zhTW,
          timeZone: 'Asia/Taipei',
        } as unknown as React.ComponentProps<typeof NextIntlClientProvider>,
        React.createElement(AdvancedSettings, { showConfigFileActions }),
      ),
    )
  })
}

describe('AdvancedSettings (ALMNC-84.1)', () => {
  it('桌面設定（showConfigFileActions=true）不再渲染清理資料、清理檔案與危險操作', async () => {
    await renderAdvanced(true)
    const text = container.textContent ?? ''
    expect(text).toContain(zhTW.settings.dev.proxyTitle)
    expect(text).not.toContain('清理資料')
    expect(text).not.toContain('清理檔案')
    expect(text).not.toContain('危險操作')
  })

  it('手機設定（showConfigFileActions=false）不再渲染清理資料、清理檔案與危險操作', async () => {
    await renderAdvanced(false)
    const text = container.textContent ?? ''
    expect(text).toContain(zhTW.settings.dev.proxyTitle)
    expect(text).not.toContain('清理資料')
    expect(text).not.toContain('清理檔案')
    expect(text).not.toContain('危險操作')
  })
})

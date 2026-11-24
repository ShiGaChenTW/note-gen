// @vitest-environment jsdom
// almanac ALMNC-45：設定 > 電子紙與「釘選到電子紙」只在新介面（V3）出現；classic 看不到任何電子紙入口。
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiModeStore } from '@/lib/fork-ui'
import { configureEinkStorage, type EinkStorage } from '@/lib/eink/storage'
import useEinkStore, { resetEinkStoreForTest } from '@/stores/eink'
import { isV3OnlySettingSection, settingSections } from '@/stores/settings-dialog'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import zhTW from '../../../../../messages/zh-TW.json'

vi.mock('next-intl', async importOriginal => {
  const intl = await importOriginal<typeof import('next-intl')>()
  return {
    ...intl,
    useLocale: () => 'en',
    useTranslations: (namespace?: string) => intl.createTranslator({ locale: 'en', messages: en, namespace: namespace as never }),
  }
})

import EinkSettingPage from './page'
import { useEinkPinAction } from '@/components/fork/eink-pin'

function memoryStorage(): EinkStorage {
  const data = new Map<string, unknown>()
  return { get: async key => data.get(key), set: async (key, value) => { data.set(key, value) }, save: async () => {} }
}

function PinProbe({ path }: { path: string }) {
  const action = useEinkPinAction(path)
  return action ? React.createElement('button', { type: 'button', onClick: () => void action.toggle() }, action.label) : null
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, {
    React, IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  })
  configureEinkStorage(memoryStorage())
  resetEinkStoreForTest()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  configureEinkStorage(null)
})

const keys = (value: unknown, prefix = ''): string[] => Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
  typeof child === 'string' ? [`${prefix}${key}`] : keys(child, `${prefix}${key}.`)).sort()

describe('電子紙入口只在 V3', () => {
  it('三種語系的電子紙字串鍵完全一致', () => {
    expect(keys(zh.eink)).toEqual(keys(en.eink))
    expect(keys(zhTW.eink)).toEqual(keys(en.eink))
    expect(keys(zh.settings.eink)).toEqual(keys(en.settings.eink))
    expect(keys(zhTW.settings.eink)).toEqual(keys(en.settings.eink))
    for (const id of ['einkPin', 'einkUnpin'] as const) {
      expect(Object.keys(zhTW.anywhere.commands[id])).toEqual(Object.keys(en.anywhere.commands[id]))
      expect(Object.keys(zh.anywhere.commands[id])).toEqual(Object.keys(en.anywhere.commands[id]))
    }
  })

  it('設定分頁「電子紙」標成 V3 專屬', async () => {
    expect(settingSections).toContain('eink')
    expect(isV3OnlySettingSection('eink')).toBe(true)
    expect(isV3OnlySettingSection('general')).toBe(false)
    const { default: baseConfig } = await import('../config')
    expect(baseConfig).toContainEqual(expect.objectContaining({ anchor: 'eink', v3Only: true }))
  })

  it('設定頁：classic 不顯示；V3 顯示設定與遮住的 token，可以重新產生', async () => {
    useUiModeStore.setState({ mode: 'classic' })
    await act(async () => root.render(React.createElement(EinkSettingPage)))
    expect(container.textContent).toBe('')
    expect(useEinkStore.getState().loaded).toBe(false)

    await act(async () => useUiModeStore.setState({ mode: 'v3' }))
    await act(async () => { await useEinkStore.getState().init() })
    expect(container.textContent).toContain(en.settings.eink.title)
    expect(container.textContent).toContain(en.settings.eink.weatherCity.title)
    expect(container.textContent).toContain(en.settings.eink.briefingSections.articles)
    // ALMNC-83.5：RSS 訂閱搬到這頁，接在稍後讀後面
    const text = container.textContent!
    expect(text.indexOf(en.settings.rss.title)).toBeGreaterThan(text.indexOf(en.settings.eink.readLater.title))
    expect(text.indexOf(en.settings.eink.readLater.title)).toBeGreaterThan(-1)
    const token = useEinkStore.getState().token
    const shown = container.querySelector('[data-testid="eink-token"]')!.textContent!
    expect(shown).not.toContain(token)
    expect(shown.endsWith(token.slice(-4))).toBe(true)

    const regenerate = [...container.querySelectorAll('button')].find(button => button.textContent?.includes(en.settings.eink.token.regenerate))!
    await act(async () => regenerate.click())
    expect(useEinkStore.getState().token).not.toBe(token)

    await act(async () => useUiModeStore.setState({ mode: 'classic' }))
    expect(container.textContent).toBe('')
  })

  it('「釘選到電子紙」：classic 沒有這個動作；V3 可以釘選與取消', async () => {
    useUiModeStore.setState({ mode: 'classic' })
    await act(async () => root.render(React.createElement(PinProbe, { path: 'a.md' })))
    expect(container.textContent).toBe('')

    await act(async () => useUiModeStore.setState({ mode: 'v3' }))
    expect(container.textContent).toBe(en.eink.pin)
    await act(async () => container.querySelector('button')!.click())
    expect(useEinkStore.getState().pins.map(pin => pin.path)).toEqual(['a.md'])
    expect(container.textContent).toBe(en.eink.unpin)
    await act(async () => container.querySelector('button')!.click())
    expect(useEinkStore.getState().pins).toEqual([])
  })
})

// almanac ALMNC-50：區網服務打開後顯示埠、狀態與要填進電子紙的網址（token 遮住）
describe('區網服務', () => {
  it('關閉時不顯示網址；服務中顯示休眠畫面網址（遮住 token）與 OPDS 網址', async () => {
    const { useEinkLanStatus } = await import('@/lib/eink/lan/service')
    useEinkLanStatus.setState({ refreshStatus: async () => {} })
    useUiModeStore.setState({ mode: 'v3' })
    await act(async () => { await useEinkStore.getState().init() })
    await act(async () => root.render(React.createElement(EinkSettingPage)))
    expect(container.querySelector('[data-testid="eink-lan-details"]')).toBeNull()

    await act(async () => { await useEinkStore.getState().updateSettings({ enabled: true, lanServer: true }) })
    expect(container.querySelector('[data-testid="eink-lan-details"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="eink-lan-sleep-url"]')).toBeNull()

    await act(async () => useEinkLanStatus.getState().setStatus({
      running: true, address: '192.168.1.5:37424', lanIp: '192.168.1.5', error: null, sleep: null, epub: null, archived: [],
    }))
    const token = useEinkStore.getState().token
    const sleepUrl = container.querySelector('[data-testid="eink-lan-sleep-url"]')!.textContent!
    expect(sleepUrl.startsWith('http://192.168.1.5:37424/eink/sleep.bmp?token=')).toBe(true)
    expect(sleepUrl).not.toContain(token)
    expect(container.querySelector('[data-testid="eink-lan-opds-url"]')!.textContent).toBe('http://192.168.1.5:37424/opds')
    expect(container.textContent).not.toContain(token)
  })
})

// almanac ALMNC-52：偵測沒開時不發任何區網請求（AC #4）；偵測到閱讀器後才能安裝與推送
describe('安裝到電子紙', () => {
  it('打開設定頁、填了閱讀器位址也不發請求；按「偵測閱讀器」才發一個 GET /api/status', async () => {
    const { configureDeviceHttp } = await import('@/lib/eink/device/http')
    const http = vi.fn(async () => ({ status: 200, text: JSON.stringify({ version: '2.1.0', firmwareFamily: 'crosspoint', device: 'X4' }) }))
    configureDeviceHttp(http)
    const { useEinkLanStatus } = await import('@/lib/eink/lan/service')
    useEinkLanStatus.setState({ status: null, refreshStatus: async () => {} })
    try {
      useUiModeStore.setState({ mode: 'v3' })
      await act(async () => { await useEinkStore.getState().init() })
      await act(async () => { await useEinkStore.getState().updateSettings({ enabled: true, readerAddress: 'http://192.168.1.20' }) })
      await act(async () => root.render(React.createElement(EinkSettingPage)))
      expect(container.querySelector('[data-testid="eink-reader-steps"]')!.children).toHaveLength(5)
      const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label)!
      expect(button(en.settings.eink.reader.install.action).disabled).toBe(true)
      expect(button(en.settings.eink.reader.push.action).disabled).toBe(true)
      expect(http).not.toHaveBeenCalled()

      await act(async () => button(en.settings.eink.reader.detect.action).click())
      expect(http).toHaveBeenCalledTimes(1)
      expect(http).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', url: 'http://192.168.1.20/api/status' }))
      expect(container.querySelector('[data-testid="eink-reader-detect-status"]')!.textContent).toContain('CrossPoint 2.1.0')
      expect(button(en.settings.eink.reader.push.action).disabled).toBe(false)
      // 區網服務沒開：還不能安裝（外掛需要伺服器網址）
      expect(button(en.settings.eink.reader.install.action).disabled).toBe(true)
    } finally {
      configureDeviceHttp(null)
    }
  })
})

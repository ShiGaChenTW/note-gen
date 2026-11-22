// @vitest-environment jsdom
// Fork（almanac ALMNC-56 重跑稽核）：RSS 訂閱的暫停、刪除失敗要有錯誤通知；刪除可以復原；刪掉一列後焦點不掉到 body。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'
import type { RssFeed } from '@/lib/source-import/rss-feeds'

const fake = vi.hoisted(() => ({
  saved: undefined as unknown,
  failSave: false,
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

vi.mock('sonner', () => ({ toast: fake.toast }))
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: async () => ({
      get: async () => undefined,
      set: async (_key: string, value: unknown) => {
        if (fake.failSave) throw new Error('disk full')
        fake.saved = value
      },
      save: async () => undefined,
    }),
  },
}))

const { RssSettings } = await import('./rss-settings')
const { default: useRssStore } = await import('@/lib/source-import/rss-store')

function feed(id: string, name: string): RssFeed {
  return { id, url: `https://example.com/${id}.xml`, name, named: true, paused: false, createdAt: 1, seen: [] } as unknown as RssFeed
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  useUiModeStore.setState({ mode: 'v3' })
  fake.failSave = false
  fake.saved = undefined
  fake.toast.mockClear()
  fake.toast.success.mockClear()
  fake.toast.error.mockClear()
  useRssStore.setState({ feeds: [feed('a', '甲'), feed('b', '乙')], ready: true, refreshing: false })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages, timeZone: 'Asia/Taipei', children: h(RssSettings) })))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
const deleteButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[data-feed-delete]')]
const names = () => useRssStore.getState().feeds.map(entry => entry.name)

describe('RSS 訂閱：刪除與暫停', () => {
  it('刪除後通知上有「復原」，按了放回原位；焦點移到下一列的刪除鈕', async () => {
    const [first] = deleteButtons()
    first.focus()
    await act(async () => first.click())
    await flush()
    expect(names()).toEqual(['乙'])
    expect(document.activeElement).toBe(deleteButtons()[0])
    const [message, options] = fake.toast.success.mock.calls[0] as [string, { action: { label: string, onClick: () => void } }]
    expect(message).toBe('已刪除「甲」（收進來的資料源不會刪除）')
    expect(options.action.label).toBe('復原')
    await act(async () => options.action.onClick())
    await flush()
    expect(names()).toEqual(['甲', '乙'])
    expect((fake.saved as RssFeed[]).map(entry => entry.name)).toEqual(['甲', '乙'])
  })

  it('刪掉最後一列：焦點回到網址輸入框', async () => {
    useRssStore.setState({ feeds: [feed('a', '甲')] })
    await flush()
    await act(async () => deleteButtons()[0].click())
    await flush()
    expect(names()).toEqual([])
    expect(document.activeElement).toBe(container.querySelector('input[type="url"]'))
  })

  it('刪除沒存到：清單放回去、跳錯誤通知', async () => {
    fake.failSave = true
    await act(async () => deleteButtons()[1].click())
    await flush()
    expect(names()).toEqual(['甲', '乙'])
    expect(fake.toast.error).toHaveBeenCalledWith('沒有刪掉「乙」，請再試一次')
    expect(fake.toast.success).not.toHaveBeenCalled()
  })

  it('暫停失敗：跳錯誤通知', async () => {
    fake.failSave = true
    const pause = [...container.querySelectorAll('button')].find(button => button.textContent === '暫停 甲')!
    await act(async () => pause.click())
    await flush()
    expect(fake.toast.error).toHaveBeenCalledWith('沒有暫停「甲」，請再試一次')
    expect(useRssStore.getState().feeds[0].paused).toBe(false)
  })
})

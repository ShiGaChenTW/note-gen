// @vitest-environment jsdom
// almanac ALMNC-46：清單管理頁可以看、加入連結、移除，並把已送電子紙的文章放回待送（不連外網）。
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { configureEinkStorage, type EinkStorage } from '@/lib/eink/storage'
import { EINK_READ_LATER_KEY } from '@/lib/eink/read-later'
import useReadLaterStore, { configureReadLaterExtractor, resetReadLaterStoreForTest } from '@/stores/read-later'
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

import { ReadLaterSection } from './read-later-section'

const t = en.settings.eink.readLater
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let data: Map<string, unknown>

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  data = new Map<string, unknown>([[EINK_READ_LATER_KEY, [
    { url: 'https://e.com/sent', addedAt: 1, status: 'sent', sentAt: 2, title: 'Sent article', content: 'x', extractedAt: 1 },
    { url: 'https://e.com/paywall', addedAt: 2, status: 'unextractable', error: 'paywall', extractedAt: 2 },
  ]]])
  const storage: EinkStorage = { get: async key => data.get(key), set: async (key, value) => { data.set(key, value) }, save: async () => {} }
  configureEinkStorage(storage)
  configureReadLaterExtractor(async () => ({ ok: true, title: 'New article', content: 'body', images: [] }))
  resetReadLaterStoreForTest()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  configureEinkStorage(null)
  configureReadLaterExtractor(null)
})

const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label) || item.getAttribute('aria-label') === label)!

it('三種語系的稍後讀字串鍵一致', () => {
  const keys = (value: unknown, prefix = ''): string[] => Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    typeof child === 'string' ? [`${prefix}${key}`] : keys(child, `${prefix}${key}.`)).sort()
  expect(keys(zh.settings.eink.readLater)).toEqual(keys(t))
  expect(keys(zhTW.settings.eink.readLater)).toEqual(keys(t))
  expect(Object.keys(zhTW.anywhere.commands.readLater)).toEqual(Object.keys(en.anywhere.commands.readLater))
})

it('列出文章與狀態；放回待送、加入連結、移除', async () => {
  await act(async () => root.render(React.createElement(ReadLaterSection)))
  await act(async () => { await useReadLaterStore.getState().extract() })
  expect(container.textContent).toContain('Sent article')
  expect(container.textContent).toContain(t.status.sent)
  expect(container.textContent).toContain(t.status.unextractable)
  expect(container.textContent).toContain(t.failure.paywall)

  await act(async () => button(t.requeue).click())
  expect(useReadLaterStore.getState().items[0].status).toBe('pending')

  const input = container.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'https://e.com/new')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await act(async () => { await useReadLaterStore.getState().extract() })
  expect(useReadLaterStore.getState().items.map(item => item.url)).toContain('https://e.com/new')
  expect(container.textContent).toContain('New article')

  const removeButtons = [...container.querySelectorAll(`button[aria-label="${t.remove}"]`)] as HTMLButtonElement[]
  expect(removeButtons).toHaveLength(3)
  await act(async () => removeButtons[0].click())
  expect(useReadLaterStore.getState().items.map(item => item.url)).not.toContain('https://e.com/new')
  expect((data.get(EINK_READ_LATER_KEY) as unknown[]).length).toBe(2)
})

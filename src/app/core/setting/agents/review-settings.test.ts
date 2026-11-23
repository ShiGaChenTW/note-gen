// @vitest-environment jsdom
// Fork（almanac ALMNC-54.13）：Agent 設定區的「調研與回顧」——預設每週、改頻率會存檔、每天時不顯示彙整日、現在執行一次。
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings as Settings, type ReviewSettingsStore } from '@/lib/review/settings'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import zhTW from '../../../../../messages/zh-TW.json'

vi.mock('next-intl', async importOriginal => {
  const intl = await importOriginal<typeof import('next-intl')>()
  return {
    ...intl,
    useTranslations: (namespace?: string) =>
      intl.createTranslator({ locale: 'zh-TW', messages: { review: zhTW.review }, namespace: (namespace ?? 'review') as 'review' }),
  }
})

import { ReviewSettings } from './review-settings'

function keys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key)).sort()
}

it('keeps the review and cleanup namespaces identical in all three locales', () => {
  for (const namespace of ['review', 'cleanup'] as const) {
    expect(keys(zh[namespace])).toEqual(keys(en[namespace]))
    expect(keys(zhTW[namespace])).toEqual(keys(en[namespace]))
  }
})

it('shows the weekly default, saves a frequency change and can run once now', async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  let saved: Settings = DEFAULT_REVIEW_SETTINGS
  let lastRunAt: number | undefined
  const store: ReviewSettingsStore = {
    load: async () => ({ settings: saved, ...(lastRunAt ? { lastRunAt } : {}) }),
    save: vi.fn(async settings => { saved = settings }),
    markRun: async at => { lastRunAt = at },
  }
  const runNow = vi.fn(async () => { lastRunAt = Date.parse('2026-11-22T20:00:00') })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(ReviewSettings, { store: async () => store, runNow })) })

  const frequency = () => container.querySelector<HTMLSelectElement>('select[aria-label="頻率"]')!
  const weekday = () => container.querySelector<HTMLSelectElement>('select[aria-label="彙整日"]')
  expect(container.textContent).toContain('調研與回顧')
  expect(frequency().value).toBe('weekly')
  expect(weekday()?.value).toBe('0')
  expect(container.textContent).toContain('還沒執行過')

  await act(async () => {
    frequency().value = 'daily'
    frequency().dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(store.save).toHaveBeenCalledWith({ frequency: 'daily', weekday: 0, explorationWeeklyLimit: 3 })
  expect(saved.frequency).toBe('daily')
  expect(weekday()).toBeNull()
  expect(container.textContent).toContain('已儲存')

  const limit = [...container.querySelectorAll('label')].find(label => label.textContent?.includes('探索每週外部資料上限'))!.querySelector('select')!
  expect(limit.value).toBe('3')
  await act(async () => {
    limit.value = '2'
    limit.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(saved.explorationWeeklyLimit).toBe(2)

  const button = [...container.querySelectorAll('button')].find(btn => btn.textContent === '現在執行一次')!
  await act(async () => { button.click() })
  expect(runNow).toHaveBeenCalledTimes(1)
  expect(container.textContent).toContain('上次執行')

  await act(async () => { root.unmount() })
  container.remove()
})

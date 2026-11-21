// Fork（almanac ALMNC-54.13）：調研與回顧的頻率——預設每週、修改後存檔、什麼時候該跑、時期標籤。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_SETTINGS, isReviewDue, keyValueSettingsStore, latestSlot, REVIEW_LAST_RUN_KEY, REVIEW_SETTINGS_KEY, reviewPeriod, reviewRange,
  sanitizeReviewSettings,
} from './settings'

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h)

describe('review frequency settings', () => {
  it('defaults to weekly and drops invalid values', () => {
    expect(DEFAULT_REVIEW_SETTINGS.frequency).toBe('weekly')
    expect(sanitizeReviewSettings(undefined)).toEqual(DEFAULT_REVIEW_SETTINGS)
    expect(sanitizeReviewSettings({ frequency: 'hourly', weekday: 9 })).toEqual(DEFAULT_REVIEW_SETTINGS)
    expect(sanitizeReviewSettings({ frequency: 'monthly', weekday: 3 })).toEqual({ frequency: 'monthly', weekday: 3 })
  })

  it('loads the default, saves a change and remembers the last run', async () => {
    const data = new Map<string, unknown>()
    const store = keyValueSettingsStore({ get: async key => data.get(key), set: async (key, value) => { data.set(key, value) } })
    expect(await store.load()).toEqual({ settings: DEFAULT_REVIEW_SETTINGS })
    await store.save({ frequency: 'daily', weekday: 2 })
    await store.markRun(123)
    expect(data.get(REVIEW_SETTINGS_KEY)).toEqual({ frequency: 'daily', weekday: 2 })
    expect(await store.load()).toEqual({ settings: { frequency: 'daily', weekday: 2 }, lastRunAt: 123 })
    expect(data.has(REVIEW_LAST_RUN_KEY)).toBe(true)
  })

  it('is due once per slot: weekly on the chosen weekday, daily, monthly, every other week, never when off', () => {
    const weekly = { frequency: 'weekly' as const, weekday: 0 }
    // 2026-11-22 是星期日。
    expect(latestSlot(weekly, at(2026, 11, 21))?.getDate()).toBe(15)
    expect(latestSlot(weekly, at(2026, 11, 22))?.getDate()).toBe(22)
    expect(isReviewDue(weekly, undefined, at(2026, 11, 21))).toBe(true)
    expect(isReviewDue(weekly, at(2026, 11, 16).getTime(), at(2026, 11, 21))).toBe(false)
    expect(isReviewDue(weekly, at(2026, 11, 16).getTime(), at(2026, 11, 22))).toBe(true)
    expect(isReviewDue({ frequency: 'daily', weekday: 0 }, at(2026, 11, 20).getTime(), at(2026, 11, 21))).toBe(true)
    expect(isReviewDue({ frequency: 'daily', weekday: 0 }, at(2026, 11, 21, 8).getTime(), at(2026, 11, 21))).toBe(false)
    expect(latestSlot({ frequency: 'monthly', weekday: 0 }, at(2026, 11, 21))?.getDate()).toBe(1)
    const biweekly = { frequency: 'biweekly' as const, weekday: 0 }
    const slots = [at(2026, 11, 22), at(2026, 11, 29), at(2026, 12, 6)].map(date => latestSlot(biweekly, date)!.getTime())
    expect(slots[0] === slots[1] || slots[1] === slots[2]).toBe(true)
    expect(slots[0]).not.toBe(slots[2])
    expect(isReviewDue({ frequency: 'off', weekday: 0 }, undefined, at(2026, 11, 21))).toBe(false)
  })

  it('labels the period like 「11 月第 3 週」 and keys it by ISO week', () => {
    const range = reviewRange(DEFAULT_REVIEW_SETTINGS, at(2026, 11, 22), at(2026, 11, 15).getTime())
    expect(range.start.getDate()).toBe(15)
    const period = reviewPeriod(DEFAULT_REVIEW_SETTINGS, range)
    expect(period).toMatchObject({ month: 11, week: 3, key: '2026-W47' })
    expect(reviewPeriod({ frequency: 'monthly', weekday: 0 }, range).key).toBe('2026-11')
    // 第一次跑：往回推一個週期。
    expect(reviewRange(DEFAULT_REVIEW_SETTINGS, at(2026, 11, 22)).start.getDate()).toBe(16)
  })
})

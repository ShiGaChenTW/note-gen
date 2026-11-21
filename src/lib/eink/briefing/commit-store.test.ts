// almanac ALMNC-47：commitSent 的預設實作真的寫進 store.json（釘選送出日、稍後讀移到已送、回顧卡與知識報告紀錄），重開 app 還在。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shouldExcludeFromSync } from '@/config/sync-exclusions'
import { EINK_PINS_KEY } from '@/lib/eink/pins'
import { EINK_READ_LATER_KEY } from '@/lib/eink/read-later'
import { configureEinkStorage, type EinkStorage } from '@/lib/eink/storage'
import useEinkStore, { resetEinkStoreForTest } from '@/stores/eink'
import useReadLaterStore, { resetReadLaterStoreForTest } from '@/stores/read-later'
import { commitSent, readBriefingLog } from './commit'
import { EINK_BRIEFING_LOG_KEY } from './state'
import type { Briefing } from './types'

function memoryStorage(initial: Record<string, unknown>): EinkStorage {
  const data = new Map(Object.entries(initial))
  return { get: async key => structuredClone(data.get(key)), set: async (key, value) => { data.set(key, structuredClone(value)) }, save: async () => {} }
}

const briefing: Briefing = {
  date: '2026-11-21',
  chapters: [],
  appendix: [],
  omitted: [],
  sent: { articleUrls: ['https://e.com/a'], pinPaths: ['a.md'], reviewPaths: ['b.md'], reportPeriod: '2026-W47' },
}

beforeEach(() => {
  configureEinkStorage(memoryStorage({
    [EINK_PINS_KEY]: [{ path: 'a.md', pinnedAt: 1, order: 0 }, { path: 'b.md', pinnedAt: 1, order: 1, firstSentAt: 2, lastSentAt: 2 }],
    [EINK_READ_LATER_KEY]: [
      { url: 'https://e.com/a', addedAt: 1, status: 'pending', title: 'A', content: '正文', extractedAt: 2 },
      { url: 'https://e.com/b', addedAt: 3, status: 'pending', title: 'B', content: '正文', extractedAt: 4 },
    ],
  }))
  resetEinkStoreForTest()
  resetReadLaterStoreForTest()
})
afterEach(() => configureEinkStorage(null))

describe('commitSent（預設實作）', () => {
  it('寫進 store.json，重開後還在；沒送的不動', async () => {
    await commitSent(briefing, 100)
    resetEinkStoreForTest()
    resetReadLaterStoreForTest()
    await useEinkStore.getState().init()
    await useReadLaterStore.getState().init()
    expect(useEinkStore.getState().pins.map(pin => [pin.path, pin.firstSentAt, pin.lastSentAt])).toEqual([['a.md', 100, 100], ['b.md', 2, 2]])
    expect(useReadLaterStore.getState().items.map(item => [item.url, item.status, item.sentAt])).toEqual([
      ['https://e.com/a', 'sent', 100],
      ['https://e.com/b', 'pending', undefined],
    ])
    expect(await readBriefingLog()).toEqual({ reviewShown: { 'b.md': 100 }, report: { period: '2026-W47', sentAt: 100 } })
  })

  it('紀錄只留在這台 Mac，不跟著設定同步', () => {
    expect(shouldExcludeFromSync(EINK_BRIEFING_LOG_KEY)).toBe(true)
  })
})

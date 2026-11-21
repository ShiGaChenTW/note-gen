// almanac ALMNC-46：稍後讀清單存在 store.json，重開 app 還在；同一網址不重複；擷取失敗不擋其他文章（不連外網）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureEinkStorage, type EinkStorage } from '@/lib/eink/storage'
import { EINK_READ_LATER_KEY, type ExtractionOutcome } from '@/lib/eink/read-later'
import { shouldExcludeFromSync } from '@/config/sync-exclusions'
import useReadLaterStore, { addToReadLater, configureReadLaterExtractor, resetReadLaterStoreForTest } from './read-later'

function memoryStorage(): EinkStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return { data, get: async key => structuredClone(data.get(key)), set: async (key, value) => { data.set(key, structuredClone(value)) }, save: async () => {} }
}

async function reopen() {
  resetReadLaterStoreForTest()
  await useReadLaterStore.getState().init()
  return useReadLaterStore.getState()
}

let storage: ReturnType<typeof memoryStorage>
const outcomes = new Map<string, ExtractionOutcome | Error>()

beforeEach(() => {
  storage = memoryStorage()
  configureEinkStorage(storage)
  outcomes.clear()
  configureReadLaterExtractor(async url => {
    const outcome = outcomes.get(url) ?? { ok: true, title: url, content: '正文', images: [] }
    if (outcome instanceof Error) throw outcome
    return outcome
  })
  resetReadLaterStoreForTest()
})
afterEach(() => {
  configureEinkStorage(null)
  configureReadLaterExtractor(null)
})

describe('useReadLaterStore', () => {
  it('addToReadLater 加入後擷取並存檔；重開 app 還在；同一網址不重複', async () => {
    expect(await addToReadLater('https://e.com/a?utm_source=x')).toBe('added')
    expect(await addToReadLater('https://e.com/a')).toBe('duplicate')
    expect(await addToReadLater('nope')).toBe('invalid')
    await useReadLaterStore.getState().extract()
    const state = await reopen()
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ url: 'https://e.com/a', status: 'pending', content: '正文' })
    expect(storage.data.get(EINK_READ_LATER_KEY)).toEqual(state.items)
  })

  it('連不上、付費牆的標成無法擷取，其他文章照常擷取', async () => {
    outcomes.set('https://e.com/a', new Error('offline'))
    outcomes.set('https://e.com/b', { ok: false, reason: 'paywall' })
    await addToReadLater('https://e.com/a')
    await addToReadLater('https://e.com/b')
    await addToReadLater('https://e.com/c')
    await useReadLaterStore.getState().extract()
    const items = (await reopen()).items
    expect(items.map(item => [item.url, item.status, item.error])).toEqual([
      ['https://e.com/a', 'unextractable', 'unreachable'],
      ['https://e.com/b', 'unextractable', 'paywall'],
      ['https://e.com/c', 'pending', undefined],
    ])
  })

  it('重新擷取、放回待送與移除都存檔', async () => {
    storage.data.set(EINK_READ_LATER_KEY, [
      { url: 'https://e.com/a', addedAt: 1, status: 'sent', sentAt: 2, content: 'x', extractedAt: 1 },
      { url: 'https://e.com/b', addedAt: 2, status: 'unextractable', error: 'unreachable', extractedAt: 2 },
      { url: 'https://e.com/c', addedAt: 3, status: 'pending', content: 'y', extractedAt: 3 },
    ])
    const store = useReadLaterStore.getState()
    await store.requeue('https://e.com/a')
    await store.retry('https://e.com/b')
    await store.extract()
    await store.remove('https://e.com/c')
    const items = (await reopen()).items
    expect(items.map(item => [item.url, item.status])).toEqual([['https://e.com/a', 'pending'], ['https://e.com/b', 'pending']])
    expect(items[1].content).toBe('正文')
  })

  it('稍後讀清單不跟著設定同步', () => {
    expect(shouldExcludeFromSync(EINK_READ_LATER_KEY, { excludeSensitiveConfig: false })).toBe(true)
  })
})

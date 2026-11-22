// Fork（almanac ALMNC-57.2）：RSS 排程——第一次只收最新 10 篇、之後只收新的、guid／連結去重、到期才抓、
// 失敗記下錯誤與時間、啟動時補抓、手動立即更新。時鐘、計時器、網路、資料源表全部是假的。
import { describe, expect, it, vi } from 'vitest'
import type { FeedItem } from './rss'
import { createFeed, isDue, normalizeFeedUrl, parseStoredFeeds, planNewItems, RSS_REFRESH_INTERVAL_MS, type RssFeed } from './rss-feeds'
import { createRssScheduler, refreshFeed, refreshFeeds, resolveFeed, RssFetchError, toRssError, type RssDeps } from './rss-scheduler'
import { DuplicateFeedError, rssRefreshText, rssSubscribeErrorText } from './rss-errors'
import { NotAFeedError } from './rss'

const H = 3_600_000
const T0 = Date.UTC(2026, 10, 22, 0, 0)

function rss(items: Array<{ guid?: string, link?: string, title: string, day?: number }>, title = 'Feed'): string {
  const body = items.map(item => [
    '<item>',
    `<title>${item.title}</title>`,
    item.link ? `<link>${item.link}</link>` : '',
    item.guid ? `<guid>${item.guid}</guid>` : '',
    item.day !== undefined ? `<pubDate>${new Date(Date.UTC(2026, 10, item.day)).toUTCString()}</pubDate>` : '',
    '</item>',
  ].join('')).join('')
  return `<rss version="2.0"><channel><title>${title}</title>${body}</channel></rss>`
}

function numbered(count: number, from = 1): Array<{ guid: string, title: string, day: number }> {
  return Array.from({ length: count }, (_, index) => ({ guid: `https://f.example/p/${from + index}`, title: `post ${from + index}`, day: from + index }))
}

function harness(initial: RssFeed[], pages: Record<string, string | Error>) {
  let feeds = initial
  let now = T0
  const stored = new Map<string, FeedItem[]>()
  const timers: Array<{ fn: () => void, ms: number }> = []
  const deps: RssDeps & { setInterval: (fn: () => void, ms: number) => unknown, clearInterval: (handle: unknown) => void } = {
    now: () => now,
    fetchText: vi.fn(async (url: string) => {
      const page = pages[url]
      if (page === undefined) throw new RssFetchError('http', '404')
      if (page instanceof Error) throw page
      return page
    }),
    getFeeds: () => feeds,
    updateFeed: (id, update) => { feeds = feeds.map(feed => (feed.id === id ? update(feed) : feed)) },
    addItems: vi.fn(async (feed: RssFeed, items: readonly FeedItem[]) => {
      let added = 0
      for (const item of items) {
        const key = item.guid ?? item.link ?? item.title
        if (stored.has(key)) continue
        stored.set(key, [item])
        added++
      }
      return added
    }),
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearInterval: vi.fn(),
  }
  return {
    deps,
    timers,
    stored,
    feeds: () => feeds,
    feed: (id = 'f1') => feeds.find(feed => feed.id === id)!,
    advance: (ms: number) => { now += ms },
    setPage: (url: string, page: string | Error) => { pages[url] = page },
  }
}

const URL1 = 'https://f.example/feed.xml'
const feed1 = (extra: Partial<RssFeed> = {}): RssFeed => ({ ...createFeed({ id: 'f1', url: URL1, now: T0 - H }), ...extra })

describe('第一次訂閱與之後的更新', () => {
  it('第一次只收最新 10 篇（依發佈時間），其他的記成看過；feed 標題變成訂閱名稱', async () => {
    const h = harness([feed1()], { [URL1]: rss(numbered(15), '工業工程週報') })
    const result = await refreshFeed('f1', h.deps)
    expect(result).toEqual({ feedId: 'f1', ok: true, added: 10 })
    const added = vi.mocked(h.deps.addItems).mock.calls[0][1]
    expect(added.map(item => item.title)).toEqual(['post 15', 'post 14', 'post 13', 'post 12', 'post 11', 'post 10', 'post 9', 'post 8', 'post 7', 'post 6'])
    expect(h.feed()).toMatchObject({ name: '工業工程週報', lastFetchedAt: T0, lastSuccessAt: T0, lastAdded: 10 })
    expect(h.feed().seen).toHaveLength(15)
  })

  it('之後只收沒看過的新文章；舊的那 5 篇不會再灌進來', async () => {
    const h = harness([feed1()], { [URL1]: rss(numbered(15)) })
    await refreshFeed('f1', h.deps)
    h.setPage(URL1, rss(numbered(17)))
    h.advance(6 * H)
    expect(await refreshFeed('f1', h.deps)).toMatchObject({ ok: true, added: 2 })
    expect(vi.mocked(h.deps.addItems).mock.calls[1][1].map(item => item.title)).toEqual(['post 17', 'post 16'])
    // 沒有新文章時不呼叫寫入。
    h.advance(6 * H)
    expect(await refreshFeed('f1', h.deps)).toMatchObject({ ok: true, added: 0 })
    expect(h.deps.addItems).toHaveBeenCalledTimes(2)
  })

  it('沒有 guid 用連結去重；同一個 feed 裡重複的文章只收一次', () => {
    const plan = planNewItems({ url: URL1, seen: ['https://f.example/a'], lastSuccessAt: T0 }, {
      items: [
        { link: 'https://f.example/a', title: 'A', summary: '' },
        { link: 'https://f.example/b', title: 'B', summary: '' },
        { link: 'https://f.example/b', title: 'B again', summary: '' },
      ],
    })
    expect(plan.items.map(item => item.title)).toEqual(['B'])
    expect(plan.seen).toEqual(['https://f.example/a', 'https://f.example/b'])
  })

  it('Scott 取過名字就不會被 feed 標題蓋掉', async () => {
    const h = harness([{ ...createFeed({ id: 'f1', url: URL1, name: '我的訂閱', now: T0 }) }], { [URL1]: rss(numbered(1), 'Feed Title') })
    await refreshFeed('f1', h.deps)
    expect(h.feed().name).toBe('我的訂閱')
  })
})

describe('失敗', () => {
  it('抓不到：記下錯誤碼、細節與時間，不丟錯；之後成功就清掉錯誤', async () => {
    const h = harness([feed1()], {})
    expect(await refreshFeed('f1', h.deps)).toMatchObject({ ok: false, error: { code: 'http', detail: '404' } })
    expect(h.feed()).toMatchObject({ lastError: 'http', lastErrorDetail: '404', lastErrorAt: T0, lastFetchedAt: T0 })
    expect(h.feed().lastSuccessAt).toBeUndefined()

    h.setPage(URL1, '<html><body>not a feed</body></html>')
    h.advance(H)
    expect(await refreshFeed('f1', h.deps)).toMatchObject({ ok: false, error: { code: 'not_feed' } })
    expect(h.feed()).toMatchObject({ lastError: 'not_feed', lastErrorAt: T0 + H })

    h.setPage(URL1, rss(numbered(12)))
    h.advance(H)
    // 之前一直沒成功過，這次成功算第一次：只收最新 10 篇。
    expect(await refreshFeed('f1', h.deps)).toMatchObject({ ok: true, added: 10 })
    expect(h.feed().lastError).toBeUndefined()
    expect(h.feed().lastErrorAt).toBeUndefined()
  })

  it('寫進資料源表失敗也記成錯誤，看過清單不更新（下次重試）', async () => {
    const h = harness([feed1()], { [URL1]: rss(numbered(3)) })
    vi.mocked(h.deps.addItems).mockRejectedValueOnce(new Error('db locked'))
    expect(await refreshFeed('f1', h.deps)).toMatchObject({ ok: false, error: { code: 'unknown', detail: 'db locked' } })
    expect(h.feed().seen).toEqual([])
    expect(await refreshFeed('f1', h.deps)).toMatchObject({ ok: true, added: 3 })
  })
})

describe('排程', () => {
  it('到期判斷：暫停的不抓；從沒抓過或滿 6 小時才抓', () => {
    expect(isDue({ paused: false }, T0)).toBe(true)
    expect(isDue({ paused: true }, T0)).toBe(false)
    expect(isDue({ paused: false, lastFetchedAt: T0 - RSS_REFRESH_INTERVAL_MS + 1 }, T0)).toBe(false)
    expect(isDue({ paused: false, lastFetchedAt: T0 - RSS_REFRESH_INTERVAL_MS }, T0)).toBe(true)
  })

  it('啟動時補抓所有沒暫停的訂閱；之後計時器只抓滿 6 小時的', async () => {
    const URL2 = 'https://g.example/atom.xml'
    const h = harness([
      feed1(),
      { ...createFeed({ id: 'f2', url: URL2, now: T0 }), paused: true },
    ], { [URL1]: rss(numbered(2)), [URL2]: rss(numbered(1)) })
    const scheduler = createRssScheduler(h.deps, { checkEvery: 15 * 60_000 })
    const results = await scheduler.start()
    expect(results.map(result => result.feedId)).toEqual(['f1'])
    expect(h.timers).toHaveLength(1)
    expect(h.timers[0].ms).toBe(15 * 60_000)
    // 重複 start 不會再開一個計時器。
    await scheduler.start()
    expect(h.timers).toHaveLength(1)

    vi.mocked(h.deps.fetchText).mockClear()
    h.advance(5 * H)
    h.timers[0].fn()
    await scheduler.refreshNow([])
    expect(h.deps.fetchText).not.toHaveBeenCalled()

    h.setPage(URL1, rss(numbered(3)))
    h.advance(H)
    h.timers[0].fn()
    await scheduler.refreshNow([])
    expect(h.deps.fetchText).toHaveBeenCalledTimes(1)
    expect(h.deps.fetchText).toHaveBeenCalledWith(URL1)
    expect(h.feed().lastAdded).toBe(1)

    scheduler.stop()
    expect(h.deps.clearInterval).toHaveBeenCalledWith(1)
    expect(scheduler.started).toBe(false)
  })

  it('手動立即更新：不管到期與否，抓所有沒暫停的；指定訂閱時連暫停的也抓', async () => {
    const h = harness([feed1({ lastFetchedAt: T0 }), { ...createFeed({ id: 'f2', url: 'https://g.example/feed', now: T0 }), paused: true }], {
      [URL1]: rss(numbered(1)), 'https://g.example/feed': rss(numbered(1)),
    })
    const scheduler = createRssScheduler(h.deps)
    expect((await scheduler.refreshNow()).map(result => result.feedId)).toEqual(['f1'])
    expect((await scheduler.refreshNow(['f2'])).map(result => result.feedId)).toEqual(['f2'])
  })

  it('同一時間只跑一輪：後來的排在後面，不會同時抓同一個訂閱', async () => {
    const h = harness([feed1()], { [URL1]: rss(numbered(2)) })
    let inFlight = 0
    let max = 0
    const original = h.deps.fetchText
    h.deps.fetchText = async url => {
      inFlight++
      max = Math.max(max, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight--
      return original(url)
    }
    const scheduler = createRssScheduler(h.deps)
    await Promise.all([scheduler.refreshNow(), scheduler.refreshNow(), scheduler.start()])
    expect(max).toBe(1)
  })

  it('refreshFeeds onlyDue：只抓到期的', async () => {
    const h = harness([feed1({ lastFetchedAt: T0 - H })], { [URL1]: rss(numbered(1)) })
    expect(await refreshFeeds(h.deps, { onlyDue: true })).toEqual([])
    h.advance(5 * H)
    expect(await refreshFeeds(h.deps, { onlyDue: true })).toHaveLength(1)
  })
})

describe('訂閱網址', () => {
  it('normalizeFeedUrl：補 https、feed:// 改 https、不合法的回傳 undefined', () => {
    expect(normalizeFeedUrl(' example.com/feed ')).toBe('https://example.com/feed')
    expect(normalizeFeedUrl('feed://example.com/rss.xml')).toBe('https://example.com/rss.xml')
    expect(normalizeFeedUrl('http://example.com/atom.xml')).toBe('http://example.com/atom.xml')
    expect(normalizeFeedUrl('ftp://example.com/x')).toBeUndefined()
    expect(normalizeFeedUrl('not a url')).toBeUndefined()
    expect(normalizeFeedUrl('hello')).toBeUndefined()
  })

  it('resolveFeed：貼的是網站首頁時，找頁面宣告的 feed 再抓', async () => {
    const pages: Record<string, string> = {
      'https://ie.example.com/': '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>',
      'https://ie.example.com/feed.xml': rss(numbered(1), 'IE'),
    }
    const fetchText = async (url: string) => pages[url]
    expect(await resolveFeed('https://ie.example.com/', fetchText)).toMatchObject({ url: 'https://ie.example.com/feed.xml', parsed: { title: 'IE' } })
    await expect(resolveFeed('https://none.example/', async () => '<html></html>')).rejects.toMatchObject({ code: 'not_feed' })
  })

  it('parseStoredFeeds：讀回 store.json，壞掉的項目略過', () => {
    const feeds = parseStoredFeeds([
      { id: 'f1', url: URL1, name: 'A', named: true, paused: true, createdAt: 1, lastFetchedAt: 2, lastError: 'timeout', lastErrorAt: 3, seen: ['x', 1] },
      { id: 2, url: 'bad' },
      null,
      { id: 'f3', url: 'https://h.example/rss', lastError: 'weird' },
    ])
    expect(feeds).toHaveLength(2)
    expect(feeds[0]).toMatchObject({ id: 'f1', name: 'A', named: true, paused: true, lastFetchedAt: 2, lastError: 'timeout', lastErrorAt: 3, seen: ['x'] })
    expect(feeds[1]).toMatchObject({ id: 'f3', name: 'h.example', named: false, paused: false, seen: [] })
    expect(feeds[1].lastError).toBeUndefined()
    expect(parseStoredFeeds(undefined)).toEqual([])
  })
})

describe('錯誤說明', () => {
  const t = (key: string, values?: Record<string, string | number>) => `${key}${values ? JSON.stringify(values) : ''}`

  it('錯誤碼：RssFetchError、不是 feed、逾時、其他', () => {
    expect(toRssError(new RssFetchError('http', '503'))).toEqual({ code: 'http', detail: '503' })
    expect(toRssError(new NotAFeedError())).toEqual({ code: 'not_feed' })
    expect(toRssError(new Error('The operation was aborted'))).toEqual({ code: 'timeout' })
    expect(toRssError(new Error('db locked'))).toEqual({ code: 'unknown', detail: 'db locked' })
  })

  it('重複訂閱、立即更新的結果', () => {
    expect(rssSubscribeErrorText(t, new DuplicateFeedError({ ...createFeed({ id: 'f', url: URL1, name: 'A', now: 0 }) }))).toBe('duplicate{"name":"A"}')
    expect(rssSubscribeErrorText(t, new RssFetchError('invalid_url'))).toBe('errors.invalid_url{"detail":""}')
    expect(rssRefreshText(t, [{ feedId: 'a', ok: true, added: 2 }, { feedId: 'b', ok: false, added: 0 }])).toBe('refreshedWithErrors{"count":2,"failed":1}')
    expect(rssRefreshText(t, [{ feedId: 'a', ok: true, added: 3 }])).toBe('refreshed{"count":3}')
  })
})

// Fork（almanac ALMNC-57.2）：RSS 訂閱清單（存在 store.json，跟其他設定一樣用 plugin-store）與 App 裡共用的一個排程。
// 抓網頁用 Tauri 的 http 外掛（不受網頁 CORS 限制）；新文章經 addImportedSources 存成外部資料源（等你決定）。
// 這一層需要 Tauri，邏輯都在 rss-scheduler.ts／rss-feeds.ts（有測試）。
import { create } from 'zustand'
import { decodeFeedBytes, rssSourceInputs } from './rss'
import { createFeed, normalizeFeedUrl, parseStoredFeeds, type RssFeed } from './rss-feeds'
import { createRssScheduler, resolveFeed, RssFetchError, type RefreshResult, type RssDeps, type RssScheduler } from './rss-scheduler'
import { DuplicateFeedError } from './rss-errors'

const KEY = 'almanacRssFeeds'
const FETCH_TIMEOUT_MS = 20_000

/** 用 Tauri http 外掛抓 feed；依 Content-Type／XML 宣告的字元集解碼。失敗丟 RssFetchError。 */
export async function fetchFeedText(url: string): Promise<string> {
  const { fetch } = await import('@tauri-apps/plugin-http')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5, */*;q=0.1',
          'User-Agent': 'Mozilla/5.0 (compatible; NoteGen RSS)',
        },
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) throw new RssFetchError('timeout')
      throw new RssFetchError('network', error instanceof Error ? error.message : String(error))
    }
    if (!response.ok) throw new RssFetchError('http', String(response.status))
    return decodeFeedBytes(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'))
  } finally {
    clearTimeout(timer)
  }
}

let saving: Promise<unknown> = Promise.resolve()

/** 依序寫回 store.json（後寫的不會被先寫的蓋掉）。 */
function persist(feeds: readonly RssFeed[]): Promise<void> {
  const run = saving.then(async () => {
    const { Store } = await import('@tauri-apps/plugin-store')
    const store = await Store.load('store.json')
    await store.set(KEY, feeds)
    await store.save()
  })
  saving = run.catch(error => console.warn('[rss] subscriptions not saved:', error))
  return run
}

interface RssState {
  feeds: RssFeed[]
  ready: boolean
  /** 正在跑「立即更新」。 */
  refreshing: boolean
  load: () => Promise<void>
  /** 訂閱：先抓一次確認是 feed（網站首頁會自動找 feed），存起來，第一次只收最新 10 篇。 */
  subscribe: (input: { url: string, name?: string }) => Promise<{ feed: RssFeed, result: RefreshResult }>
  rename: (id: string, name: string) => Promise<void>
  setPaused: (id: string, paused: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
  refreshNow: (ids?: readonly string[]) => Promise<RefreshResult[]>
  /** 給排程用：以最新的值改一個訂閱並存檔。 */
  updateFeed: (id: string, update: (feed: RssFeed) => RssFeed) => Promise<void>
}

const useRssStore = create<RssState>((set, get) => ({
  feeds: [],
  ready: false,
  refreshing: false,
  load: async () => {
    if (get().ready) return
    const { Store } = await import('@tauri-apps/plugin-store')
    const store = await Store.load('store.json')
    const feeds = parseStoredFeeds(await store.get(KEY))
    if (!get().ready) set({ feeds, ready: true })
  },
  subscribe: async input => {
    await get().load()
    const url = normalizeFeedUrl(input.url)
    if (!url) throw new RssFetchError('invalid_url')
    const existing = get().feeds.find(feed => feed.url === url)
    if (existing) throw new DuplicateFeedError(existing)
    const resolved = await resolveFeed(url, fetchFeedText)
    const resolvedExisting = get().feeds.find(feed => feed.url === resolved.url)
    if (resolvedExisting) throw new DuplicateFeedError(resolvedExisting)
    const feed = createFeed({ id: `rss_${crypto.randomUUID()}`, url: resolved.url, name: input.name, now: Date.now() })
    const feeds = [...get().feeds, feed]
    set({ feeds })
    await persist(feeds)
    const result = await rssScheduler().ingest(feed.id, resolved.parsed)
    return { feed: get().feeds.find(entry => entry.id === feed.id) ?? feed, result }
  },
  rename: async (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    await get().updateFeed(id, feed => ({ ...feed, name: trimmed, named: true }))
  },
  setPaused: async (id, paused) => {
    await get().updateFeed(id, feed => ({ ...feed, paused }))
  },
  remove: async id => {
    const feeds = get().feeds.filter(feed => feed.id !== id)
    set({ feeds })
    await persist(feeds)
  },
  refreshNow: async ids => {
    await get().load()
    set({ refreshing: true })
    try {
      return await rssScheduler().refreshNow(ids)
    } finally {
      set({ refreshing: false })
    }
  },
  updateFeed: async (id, update) => {
    if (!get().feeds.some(feed => feed.id === id)) return
    const feeds = get().feeds.map(feed => (feed.id === id ? update(feed) : feed))
    set({ feeds })
    await persist(feeds)
  },
}))

export default useRssStore

function defaultDeps(): RssDeps {
  return {
    now: () => Date.now(),
    fetchText: fetchFeedText,
    getFeeds: () => useRssStore.getState().feeds,
    updateFeed: (id, update) => useRssStore.getState().updateFeed(id, update),
    addItems: async (feed, items) => {
      const { addImportedSources } = await import('@/lib/workbench/actions')
      return (await addImportedSources(rssSourceInputs(feed, items))).added.length
    },
  }
}

let shared: RssScheduler | undefined

/** App 裡共用的一個 RSS 排程（第一次呼叫時建立）。 */
export function rssScheduler(): RssScheduler {
  shared ??= createRssScheduler({
    ...defaultDeps(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
  })
  return shared
}

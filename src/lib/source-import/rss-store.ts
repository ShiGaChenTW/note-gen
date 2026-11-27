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
    // Fork（almanac ALMNC-85.2）：開了 V3 同步時排一次 almanac 同步（RSS 訂閱已從設定同步移出）。
    const { notifyAlmanacLocalChange } = await import('@/lib/almanac-sync/notify')
    notifyAlmanacLocalChange('rss-feeds')
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
  /** 刪除；存檔失敗就放回原位並丟錯。 */
  remove: (id: string) => Promise<void>
  /** 復原刪除：放回原本的位置（index）並存檔。已經有同一個 id 就什麼都不做。 */
  restore: (feed: RssFeed, index: number) => Promise<void>
  refreshNow: (ids?: readonly string[]) => Promise<RefreshResult[]>
  /** 給排程用：以最新的值改一個訂閱並存檔。 */
  updateFeed: (id: string, update: (feed: RssFeed) => RssFeed) => Promise<void>
  /**
   * Fork（almanac ALMNC-85.2）：V3 同步套用遠端的訂閱。記憶體裡的清單是唯一的寫入者：同步改的也經過這裡，
   * 畫面立即更新，之後排程或改名存檔也不會把下載前的舊值寫回去（設計 6 風險 6）。
   */
  applySync: (mutator: (feeds: RssFeed[]) => RssFeed[]) => Promise<void>
  /** Fork（almanac ALMNC-85.2）：別台刪了、Scott 選「保留」：記下時間，下一輪同步把訂閱推回去。 */
  keep: (id: string) => Promise<void>
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
    await get().updateFeed(id, feed => ({ ...feed, name: trimmed, named: true, updatedAt: Date.now() }))
  },
  setPaused: async (id, paused) => {
    try {
      await get().updateFeed(id, feed => ({ ...feed, paused, updatedAt: Date.now() }))
    } catch (error) {
      // 沒存到就把畫面上的狀態改回來（ALMNC-56 重跑稽核）
      set({ feeds: get().feeds.map(feed => (feed.id === id ? { ...feed, paused: !paused } : feed)) })
      throw error
    }
  },
  remove: async id => {
    const before = get().feeds
    const index = before.findIndex(feed => feed.id === id)
    if (index < 0) return
    const removed = before[index]
    const feeds = before.filter(feed => feed.id !== id)
    set({ feeds })
    try {
      await persist(feeds)
    } catch (error) {
      // Fork（almanac ALMNC-56 重跑稽核）：沒存到就放回清單，畫面和 store.json 一致
      if (!get().feeds.some(feed => feed.id === id)) {
        const current = [...get().feeds]
        current.splice(Math.min(index, current.length), 0, removed)
        set({ feeds: current })
      }
      throw error
    }
  },
  restore: async (feed, index) => {
    if (get().feeds.some(entry => entry.id === feed.id)) return
    const feeds = [...get().feeds]
    // Fork（almanac ALMNC-85.2）：救回算一次修改（晚於刪除），V3 同步時不會被自己的刪除墓碑擋下。
    feeds.splice(Math.min(Math.max(index, 0), feeds.length), 0, { ...feed, updatedAt: Date.now() })
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
  applySync: async mutator => {
    await get().load()
    const feeds = mutator(get().feeds)
    set({ feeds })
    await persist(feeds)
  },
  keep: async id => {
    const now = Date.now()
    await get().updateFeed(id, feed => ({ ...feed, keptAt: now, updatedAt: now }))
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

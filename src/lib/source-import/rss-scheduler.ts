// Fork（almanac ALMNC-57.2）：RSS 抓取與排程。依賴（時鐘、計時器、抓網頁、讀寫訂閱、寫資料源）全部注入，測試用假的。
// App 開著時：啟動時抓一次（補抓），之後每隔一段時間檢查，距離上次抓取滿 6 小時的訂閱就再抓；也可以手動「立即更新」。
// 同一時間只跑一輪（後來的排在後面），一個一個訂閱抓，不同時打很多連線。抓不到時記下錯誤與時間，不打擾。
import { discoverFeedLinks, NotAFeedError, parseFeed, type FeedItem, type ParsedFeed } from './rss'
import { isDue, planNewItems, RSS_REFRESH_INTERVAL_MS, withFetchError, withFetchSuccess, type RssErrorCode, type RssFeed } from './rss-feeds'

/** 抓取失敗的原因（帶錯誤碼，訂閱列表依語系顯示）。 */
export class RssFetchError extends Error {
  constructor(readonly code: RssErrorCode, readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'RssFetchError'
  }
}

export function toRssError(error: unknown): { code: RssErrorCode, detail?: string } {
  if (error instanceof RssFetchError) return { code: error.code, ...(error.detail ? { detail: error.detail } : {}) }
  if (error instanceof NotAFeedError) return { code: 'not_feed' }
  const message = error instanceof Error ? error.message : String(error)
  if (/abort|timed? ?out/i.test(message)) return { code: 'timeout' }
  return { code: 'unknown', ...(message ? { detail: message } : {}) }
}

/**
 * 新訂閱：抓網址、確認是 feed。貼的是網站首頁（HTML）時，找頁面裡宣告的 feed（<link rel="alternate">）再抓一次。
 * 回傳實際的 feed 網址與解析結果；都不是 feed 就丟 NotAFeedError。
 */
export async function resolveFeed(url: string, fetchText: (url: string) => Promise<string>): Promise<{ url: string, parsed: ParsedFeed }> {
  const text = await fetchText(url)
  try {
    return { url, parsed: parseFeed(text, url) }
  } catch (error) {
    if (!(error instanceof NotAFeedError)) throw error
    const discovered = discoverFeedLinks(text, url)[0]
    if (!discovered || discovered === url) throw error
    return { url: discovered, parsed: parseFeed(await fetchText(discovered), discovered) }
  }
}

export interface RssDeps {
  now: () => number
  /** 抓 feed 的文字；失敗丟 RssFetchError（或任何錯誤）。 */
  fetchText: (url: string) => Promise<string>
  getFeeds: () => readonly RssFeed[]
  /** 以最新的狀態改一個訂閱（update 拿到的是當下的值）。 */
  updateFeed: (id: string, update: (feed: RssFeed) => RssFeed) => Promise<void> | void
  /** 把新文章存成資料源，回傳實際新增的數量（重複的不算）。 */
  addItems: (feed: RssFeed, items: readonly FeedItem[]) => Promise<number>
}

export interface RefreshResult {
  feedId: string
  ok: boolean
  added: number
  error?: { code: RssErrorCode, detail?: string }
}

/** 已經解析好的 feed 寫進去：挑出新文章存成資料源，更新看過清單與上次成功時間。 */
export async function applyParsedFeed(feedId: string, parsed: ParsedFeed, deps: RssDeps): Promise<RefreshResult> {
  const feed = deps.getFeeds().find(entry => entry.id === feedId)
  if (!feed) return { feedId, ok: false, added: 0, error: { code: 'unknown', detail: 'feed removed' } }
  const plan = planNewItems(feed, parsed)
  const named = !feed.named && parsed.title.trim() ? { ...feed, name: parsed.title.trim() } : feed
  const added = plan.items.length ? await deps.addItems(named, plan.items) : 0
  await deps.updateFeed(feedId, current => withFetchSuccess(current, { now: deps.now(), title: parsed.title, added, seen: plan.seen }))
  return { feedId, ok: true, added }
}

/** 跑一次抓取；任何失敗都記在訂閱上（錯誤碼與時間），不往外丟。 */
async function recording(feedId: string, deps: RssDeps, task: () => Promise<RefreshResult>): Promise<RefreshResult> {
  try {
    return await task()
  } catch (error) {
    const reason = toRssError(error)
    try {
      await deps.updateFeed(feedId, current => withFetchError(current, reason, deps.now()))
    } catch (saveError) {
      console.warn('[rss] error not saved:', saveError)
    }
    return { feedId, ok: false, added: 0, error: reason }
  }
}

/** 抓一個訂閱。不會丟錯：失敗記在訂閱上（錯誤碼與時間）。 */
export async function refreshFeed(feedId: string, deps: RssDeps): Promise<RefreshResult> {
  const feed = deps.getFeeds().find(entry => entry.id === feedId)
  if (!feed) return { feedId, ok: false, added: 0, error: { code: 'unknown', detail: 'feed removed' } }
  return recording(feedId, deps, async () => applyParsedFeed(feedId, parseFeed(await deps.fetchText(feed.url), feed.url), deps))
}

export interface RefreshOptions {
  /** 只抓這些訂閱（手動指定時連暫停的也抓）；沒給就是所有沒暫停的。 */
  ids?: readonly string[]
  /** 只抓到期的（排程用）。 */
  onlyDue?: boolean
}

/** 依序抓多個訂閱。 */
export async function refreshFeeds(deps: RssDeps, options: RefreshOptions = {}): Promise<RefreshResult[]> {
  const now = deps.now()
  const targets = deps.getFeeds().filter(feed => {
    if (options.ids) return options.ids.includes(feed.id)
    return options.onlyDue ? isDue(feed, now) : !feed.paused
  })
  const results: RefreshResult[] = []
  for (const feed of targets) results.push(await refreshFeed(feed.id, deps))
  return results
}

export interface SchedulerTimers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

export interface RssScheduler {
  /** 啟動：馬上抓一次所有沒暫停的訂閱（補抓），之後定時檢查到期的。重複呼叫不會開兩個計時器。 */
  start: () => Promise<RefreshResult[]>
  stop: () => void
  /** 手動「立即更新」（排在正在跑的那一輪後面）。 */
  refreshNow: (ids?: readonly string[]) => Promise<RefreshResult[]>
  /** 新訂閱第一次抓到的內容（已經抓過、解析好了，不再抓一次）。 */
  ingest: (feedId: string, parsed: ParsedFeed) => Promise<RefreshResult>
  readonly started: boolean
}

/** 檢查到期的間隔；真正的抓取間隔是 6 小時（RSS_REFRESH_INTERVAL_MS），電腦睡眠醒來後最多晚這麼久補上。 */
export const RSS_CHECK_INTERVAL_MS = 15 * 60 * 1000

export function createRssScheduler(deps: RssDeps & SchedulerTimers, options: { checkEvery?: number, interval?: number } = {}): RssScheduler {
  let timer: unknown
  let started = false
  let chain: Promise<unknown> = Promise.resolve()
  const interval = options.interval ?? RSS_REFRESH_INTERVAL_MS

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task)
    chain = run.catch(() => undefined)
    return run
  }

  const tick = () => enqueue(async () => {
    const now = deps.now()
    const due = deps.getFeeds().filter(feed => isDue(feed, now, interval)).map(feed => feed.id)
    return due.length ? refreshFeeds(deps, { ids: due }) : []
  }).catch(error => console.warn('[rss] scheduled refresh failed:', error))

  return {
    start() {
      if (started) return Promise.resolve([])
      started = true
      timer = deps.setInterval(() => void tick(), options.checkEvery ?? RSS_CHECK_INTERVAL_MS)
      return enqueue(() => refreshFeeds(deps))
    },
    stop() {
      if (timer !== undefined) deps.clearInterval(timer)
      timer = undefined
      started = false
    },
    refreshNow(ids) {
      return enqueue(() => refreshFeeds(deps, ids ? { ids } : {}))
    },
    ingest(feedId, parsed) {
      return enqueue(() => recording(feedId, deps, () => applyParsedFeed(feedId, parsed, deps)))
    },
    get started() {
      return started
    },
  }
}

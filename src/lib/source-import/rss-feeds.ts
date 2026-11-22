// Fork（almanac ALMNC-57.2）：RSS 訂閱的資料模型與狀態轉換（純函式）。
// 存在 store.json（rss-store.ts）；排程與抓取在 rss-scheduler.ts。
// 第一次成功抓取只收最新 10 篇，當時 feed 裡其他的文章記成「看過」，之後不會再灌進來；之後每次只收沒看過的。
import { rssItemKey, type FeedItem, type ParsedFeed } from './rss'

/** App 開著時多久抓一次。 */
export const RSS_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
/** 第一次訂閱只收最新幾篇。 */
export const RSS_FIRST_FETCH_LIMIT = 10
/** 每個訂閱記住多少個看過的去重鍵（至少會留住 feed 目前所有的文章）。 */
export const RSS_SEEN_LIMIT = 500

export type RssErrorCode = 'http' | 'not_feed' | 'timeout' | 'network' | 'invalid_url' | 'unknown'

export interface RssFeed {
  id: string
  /** feed 網址（RSS／Atom 本身，不是網站首頁）。 */
  url: string
  name: string
  /** Scott 自己取過名字；沒有的話第一次抓到時改用 feed 的標題。 */
  named: boolean
  paused: boolean
  createdAt: number
  /** 上次抓取的時間（不論成功失敗）。 */
  lastFetchedAt?: number
  /** 上次成功的時間；沒有就是還沒成功抓過（下次成功算第一次，只收最新 10 篇）。 */
  lastSuccessAt?: number
  /** 上次成功時新增了幾篇。 */
  lastAdded?: number
  /** 上次失敗的原因與時間；之後成功就清掉。 */
  lastError?: RssErrorCode
  lastErrorDetail?: string
  lastErrorAt?: number
  /** 看過的文章去重鍵（新的在前）。 */
  seen: string[]
}

/** 使用者貼的網址 → 可以抓的 http(s) 網址；feed:// 改成 https://，沒有 scheme 的補 https://。不合法回傳 undefined。 */
export function normalizeFeedUrl(input: string): string | undefined {
  let value = input.trim()
  if (!value || /\s/.test(value)) return undefined
  value = value.replace(/^feed:(\/\/)?/i, 'https://')
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return undefined
    return url.href
  } catch {
    return undefined
  }
}

export function createFeed(input: { id: string, url: string, name?: string, now: number }): RssFeed {
  const name = input.name?.trim()
  return {
    id: input.id,
    url: input.url,
    name: name || hostOf(input.url),
    named: Boolean(name),
    paused: false,
    createdAt: input.now,
    seen: [],
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** 該抓了：沒暫停，而且從沒抓過或距離上次抓取已滿 6 小時。 */
export function isDue(feed: Pick<RssFeed, 'paused' | 'lastFetchedAt'>, now: number, interval = RSS_REFRESH_INTERVAL_MS): boolean {
  if (feed.paused) return false
  return feed.lastFetchedAt === undefined || now - feed.lastFetchedAt >= interval
}

export interface NewItemsPlan {
  /** 要存成資料源的文章（由新到舊）。 */
  items: FeedItem[]
  /** 抓完後的看過清單。 */
  seen: string[]
}

/**
 * 這次要收哪些文章。第一次（還沒成功抓過）：依發佈時間取最新 10 篇（沒有時間的依 feed 裡的順序，越前面越新），
 * 但 feed 裡所有文章都記成看過；之後：只收沒看過的。
 */
export function planNewItems(feed: Pick<RssFeed, 'url' | 'seen' | 'lastSuccessAt'>, parsed: Pick<ParsedFeed, 'items'>, firstLimit = RSS_FIRST_FETCH_LIMIT): NewItemsPlan {
  const entries: Array<{ item: FeedItem, key: string, index: number }> = []
  const keys = new Set<string>()
  parsed.items.forEach((item, index) => {
    const key = rssItemKey(feed.url, item)
    if (keys.has(key)) return
    keys.add(key)
    entries.push({ item, key, index })
  })
  const newest = [...entries].sort((a, b) => (b.item.published ?? -Infinity) - (a.item.published ?? -Infinity) || a.index - b.index)
  const seen = new Set(feed.seen)
  const fresh = feed.lastSuccessAt === undefined ? newest.slice(0, firstLimit) : newest.filter(entry => !seen.has(entry.key))
  const current = entries.map(entry => entry.key)
  const merged = Array.from(new Set([...current, ...feed.seen]))
  return { items: fresh.map(entry => entry.item), seen: merged.slice(0, Math.max(RSS_SEEN_LIMIT, current.length)) }
}

export function withFetchSuccess(feed: RssFeed, result: { now: number, title?: string, added: number, seen: string[] }): RssFeed {
  const title = result.title?.trim()
  const next: RssFeed = {
    ...feed,
    ...(!feed.named && title ? { name: title } : {}),
    lastFetchedAt: result.now,
    lastSuccessAt: result.now,
    lastAdded: result.added,
    seen: result.seen,
  }
  delete next.lastError
  delete next.lastErrorDetail
  delete next.lastErrorAt
  return next
}

export function withFetchError(feed: RssFeed, error: { code: RssErrorCode, detail?: string }, now: number): RssFeed {
  return {
    ...feed,
    lastFetchedAt: now,
    lastError: error.code,
    ...(error.detail ? { lastErrorDetail: error.detail } : { lastErrorDetail: undefined }),
    lastErrorAt: now,
  }
}

const ERROR_CODES: readonly RssErrorCode[] = ['http', 'not_feed', 'timeout', 'network', 'invalid_url', 'unknown']

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 讀回 store.json 裡的訂閱；壞掉的項目略過。 */
export function parseStoredFeeds(value: unknown): RssFeed[] {
  if (!Array.isArray(value)) return []
  const feeds: RssFeed[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.url !== 'string') continue
    const lastError = ERROR_CODES.includes(record.lastError as RssErrorCode) ? record.lastError as RssErrorCode : undefined
    const feed: RssFeed = {
      id: record.id,
      url: record.url,
      name: typeof record.name === 'string' && record.name.trim() ? record.name : hostOf(record.url),
      named: record.named === true,
      paused: record.paused === true,
      createdAt: optionalNumber(record.createdAt) ?? 0,
      seen: Array.isArray(record.seen) ? record.seen.filter((key): key is string => typeof key === 'string') : [],
    }
    const numbers = ['lastFetchedAt', 'lastSuccessAt', 'lastAdded', 'lastErrorAt'] as const
    for (const key of numbers) {
      const number = optionalNumber(record[key])
      if (number !== undefined) feed[key] = number
    }
    if (lastError) feed.lastError = lastError
    if (typeof record.lastErrorDetail === 'string' && record.lastErrorDetail) feed.lastErrorDetail = record.lastErrorDetail
    feeds.push(feed)
  }
  return feeds
}

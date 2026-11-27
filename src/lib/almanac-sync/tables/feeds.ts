// Fork（almanac ALMNC-85.2）：RSS 訂閱的同步表（設計 2.2）。
// 存放 .data/almanac/feeds.json，從設定同步移出（storeKeys：首次 V3 同步成功後才加進設定排除清單，M9）。
// 理由：設定同步整個 key 覆寫，兩台各自匯入就會互相蓋掉看過清單（seen），另一台以為看過就不再匯入。
//
// 合併：name／named／paused 較晚的贏；seen 聯集（新的在前、留最近 RSS_SEEN_LIMIT 個）；抓取時間取較大的；錯誤跟著最近一次抓取。
// 跟文章一起才一致（85.2 #2）：資料源表先註冊（先傳、先套），feeds.json 後到；就算只傳完 feeds.json，
// 文章（src_rss:<key> 同步鍵）下一輪也會到，不會像以前「seen 有、文章永遠拿不到」。
// 兩台同時抓同一個 feed：文章的資料源 id 由內容決定，合為一筆；seen 聯集，不重複也不漏。
//
// 別台刪訂閱要先問 Scott（第 8 節 2A）：進待確認清單（pending-records.ts），確認前本機保留、也不推回遠端。
// 兩台各自訂閱同一個網址（id 不同）：createdAt 較早的 id 為正式 id，另一個進別名表、seen 合併，不出待確認。
import { maxNumber, minNonNull, type FieldMergeContext, type FieldRule } from '../merge'
import { chooseCanonicalId, recordAlias } from '../aliases'
import { RSS_SEEN_LIMIT, type RssFeed } from '@/lib/source-import/rss-feeds'
import { upsertPendingRecordDeletion } from './pending-records'
import type { AlmanacRowsTable } from './registry'

export const FEEDS_SYNC_TABLE = 'feeds'
export const RSS_FEEDS_STORE_KEY = 'almanacRssFeeds'

export type FeedSyncValue = Omit<RssFeed, 'id'> & Record<string, unknown>

/** 讀寫本機訂閱清單。App 裡接 useRssStore（記憶體裡的清單是唯一的寫入者，避免下載後被舊值寫回，設計 6 風險 6）。 */
export interface FeedsAccess {
  load(): Promise<RssFeed[]>
  /** 以最新的清單改（mutator 拿到的是當下的值）並存檔。 */
  update(mutator: (feeds: RssFeed[]) => RssFeed[]): Promise<void>
  /** 有新的待確認刪除（畫面要提示） */
  onPendingChanged?(): void
}

/** seen 聯集：本機的順序在前（新的在前），再接遠端多出來的；留最近 limit 個。 */
export function unionSeen(local: readonly string[] | undefined, remote: readonly string[] | undefined, limit = RSS_SEEN_LIMIT): string[] {
  const merged = Array.from(new Set([...(local ?? []), ...(remote ?? [])]))
  return merged.slice(0, Math.max(limit, (local ?? []).length, (remote ?? []).length))
}

const seenRule: FieldRule = {
  type: 'resolve',
  resolve: (local, remote) => unionSeen(local as string[] | undefined, remote as string[] | undefined),
}

/** 錯誤與上次新增數跟著「最近一次抓取」那一邊（lastFetchedAt 較大的）。 */
function followLatestFetch(field: string): FieldRule {
  return {
    type: 'resolve',
    resolve: (_local, _remote, context: FieldMergeContext) => {
      const localAt = Number(context.local.v.lastFetchedAt ?? 0)
      const remoteAt = Number(context.remote.v.lastFetchedAt ?? 0)
      const side = localAt !== remoteAt ? (localAt > remoteAt ? context.local : context.remote) : (context.localIsLater ? context.local : context.remote)
      return side.v[field]
    },
  }
}

export function feedToSyncValue(feed: RssFeed): FeedSyncValue {
  const { id: _id, ...rest } = feed
  void _id
  const value = { ...rest } as FeedSyncValue
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key]
  return value
}

export function syncValueToFeed(id: string, value: FeedSyncValue): RssFeed {
  const feed = { ...value, id, seen: Array.isArray(value.seen) ? [...value.seen] : [] } as RssFeed
  return feed
}

/** 本機最後修改時間：建立、改名／暫停、選「保留」；抓取不算（抓取另有 lastFetchedAt）。 */
export function feedStamp(feed: Pick<RssFeed, 'createdAt' | 'updatedAt' | 'keptAt'>): number {
  return Math.max(feed.createdAt ?? 0, feed.updatedAt ?? 0, feed.keptAt ?? 0)
}

/** 把遠端那份套到本機那份上：遠端是合併後的結果，但 seen 與抓取時間再跟本機當下的值合一次（排程可能剛抓完）。 */
function overlay(current: RssFeed | undefined, id: string, value: FeedSyncValue): RssFeed {
  const next = syncValueToFeed(id, value)
  if (!current) return next
  next.seen = unionSeen(next.seen, current.seen)
  for (const key of ['lastFetchedAt', 'lastSuccessAt'] as const) {
    const max = Math.max(next[key] ?? 0, current[key] ?? 0)
    if (max) next[key] = max
  }
  return next
}

export function createFeedsTable(access: FeedsAccess): AlmanacRowsTable<FeedSyncValue> {
  return {
    kind: 'rows',
    name: FEEDS_SYNC_TABLE,
    layer: 'account',
    storage: { type: 'file', path: 'feeds.json' },
    storeKeys: [RSS_FEEDS_STORE_KEY],
    askOnRemoteDelete: true,
    rules: {
      seen: seenRule,
      createdAt: minNonNull(),
      lastFetchedAt: maxNumber(),
      lastSuccessAt: maxNumber(),
      keptAt: maxNumber(),
      updatedAt: maxNumber(),
      lastAdded: followLatestFetch('lastAdded'),
      lastError: followLatestFetch('lastError'),
      lastErrorDetail: followLatestFetch('lastErrorDetail'),
      lastErrorAt: followLatestFetch('lastErrorAt'),
    },
    async read() {
      const feeds = await access.load()
      return Object.fromEntries(feeds.map(feed => [feed.id, { v: feedToSyncValue(feed), u: feedStamp(feed) }]))
    },
    async apply(context, change) {
      const aliases: Array<{ alias: string; canonical: string }> = []
      await access.update(current => {
        let feeds = [...current]
        for (const [id, value] of Object.entries(change.upserts)) {
          const index = feeds.findIndex(feed => feed.id === id)
          if (index >= 0) {
            feeds[index] = overlay(feeds[index], id, value)
            continue
          }
          const duplicate = feeds.find(feed => feed.url === value.url && feed.id !== id)
          if (!duplicate) {
            feeds.push(syncValueToFeed(id, value))
            continue
          }
          // 兩台各自訂閱同一個網址：較早建立的 id 為正式 id，另一個進別名表，seen 合併。
          const { canonical, alias } = chooseCanonicalId({ id, createdAt: value.createdAt }, { id: duplicate.id, createdAt: duplicate.createdAt })
          aliases.push({ alias, canonical })
          if (canonical === duplicate.id) {
            feeds = feeds.map(feed => (feed.id === duplicate.id ? { ...feed, seen: unionSeen(feed.seen, value.seen) } : feed))
          } else {
            feeds = feeds.map(feed => (feed.id === duplicate.id ? overlay(duplicate, id, value) : feed))
          }
        }
        if (change.deletes.length) feeds = feeds.filter(feed => !change.deletes.includes(feed.id))
        return feeds
      })
      for (const { alias, canonical } of aliases) await recordAlias(context.db, FEEDS_SYNC_TABLE, alias, canonical, context.now())
    },
    async onPendingDeletes(context, pending) {
      const feeds = await access.load()
      const merges: string[] = []
      let opened = false
      for (const item of pending) {
        const local = syncValueToFeed(item.key, item.local.v)
        const twin = feeds.find(feed => feed.url === local.url && feed.id !== item.key)
        if (twin) {
          // 重複訂閱被另一台收掉：不是 Scott 刪的，直接併進正式那一筆，不必問。
          merges.push(item.key)
          await recordAlias(context.db, FEEDS_SYNC_TABLE, item.key, twin.id, context.now())
          continue
        }
        opened = await upsertPendingRecordDeletion(context.db, {
          tableName: FEEDS_SYNC_TABLE,
          syncKey: item.key,
          title: local.name || local.url,
          snapshot: local,
          deletedAt: item.tombstone.deletedAt,
          deviceId: item.tombstone.deviceId,
          now: context.now(),
        }) || opened
      }
      if (merges.length) {
        await access.update(current => {
          const removed = current.filter(feed => merges.includes(feed.id))
          return current
            .filter(feed => !merges.includes(feed.id))
            .map(feed => {
              const twins = removed.filter(entry => entry.url === feed.url)
              return twins.length ? { ...feed, seen: unionSeen(feed.seen, twins.flatMap(entry => entry.seen)) } : feed
            })
        })
      }
      if (opened) access.onPendingChanged?.()
    },
  }
}

// Fork（almanac ALMNC-85.2，第 8 節 2A）：別台刪掉、要先問 Scott 的資料庫列（目前是 RSS 訂閱）——畫面上的確認與保留。
// 跟 84.8 的檔案刪除同一套規則（設計第 3 節）：
// - 確認＝不直接刪，先寫進 App 垃圾桶（最近刪除，30 天內可救回），再從本機移除；下一輪同步維持刪除。
// - 保留＝記下「保留」的時間（晚於刪除），下一輪同步把這一列推回遠端、清掉墓碑，另一台也拿回來。
'use client'

import emitter from '@/lib/emitter'
import { FEEDS_SYNC_TABLE } from './tables/feeds'
import {
  getPendingRecordDeletion,
  listPendingRecordDeletions,
  markPendingRecordDeletion,
  type PendingRecordDeletion,
} from './tables/pending-records'

async function db() {
  const { getDb } = await import('@/db/index')
  return getDb()
}

export async function listPendingRecordDeletionsForUi(): Promise<PendingRecordDeletion[]> {
  return listPendingRecordDeletions(await db(), 'pending')
}

export async function confirmPendingRecordDeletion(tableName: string, syncKey: string): Promise<boolean> {
  const database = await db()
  const item = await getPendingRecordDeletion(database, tableName, syncKey)
  if (!item || item.status !== 'pending') return false
  if (tableName === FEEDS_SYNC_TABLE) {
    const { default: useRssStore } = await import('@/lib/source-import/rss-store')
    await useRssStore.getState().load()
    const feeds = useRssStore.getState().feeds
    const index = feeds.findIndex(feed => feed.id === syncKey)
    if (index >= 0) {
      const feed = feeds[index]
      const { recordDbTrash } = await import('@/lib/trash/runtime')
      await recordDbTrash({
        entityType: 'rss-feed',
        entityId: feed.id,
        title: feed.name || feed.url,
        deletedBy: 'sync',
        actorRole: 'sync',
        source: 'sync',
        metadata: { feed, index },
      })
      await useRssStore.getState().remove(feed.id)
    }
  }
  await markPendingRecordDeletion(database, tableName, syncKey, 'confirmed', Date.now())
  emitter.emit('pending-sync-deletions-changed')
  return true
}

export async function rejectPendingRecordDeletion(tableName: string, syncKey: string): Promise<boolean> {
  const database = await db()
  const item = await getPendingRecordDeletion(database, tableName, syncKey)
  if (!item || item.status !== 'pending') return false
  await markPendingRecordDeletion(database, tableName, syncKey, 'rejected', Date.now())
  if (tableName === FEEDS_SYNC_TABLE) {
    const { default: useRssStore } = await import('@/lib/source-import/rss-store')
    await useRssStore.getState().load()
    await useRssStore.getState().keep(syncKey)
  }
  emitter.emit('pending-sync-deletions-changed')
  return true
}

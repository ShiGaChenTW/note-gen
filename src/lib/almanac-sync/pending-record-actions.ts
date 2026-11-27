// Fork（almanac ALMNC-85.2，第 8 節 2A）：別台刪掉、要先問 Scott 的資料庫列（RSS 訂閱；85.3 加專家）——畫面上的確認與保留。
// 跟 84.8 的檔案刪除同一套規則（設計第 3 節）：
// - 確認＝不直接刪，先寫進 App 垃圾桶（最近刪除，30 天內可救回），再從本機移除；下一輪同步維持刪除。
// - 保留＝記下「保留」的時間（晚於刪除），下一輪同步把這一列推回遠端、清掉墓碑，另一台也拿回來。
'use client'

import emitter from '@/lib/emitter'
import { FEEDS_SYNC_TABLE } from './tables/feeds'
import { CREW_SYNC_TABLE, expertTitle, keepCrewAgent, parseCrewKey, removeCrewAgent, type AgentSyncValue } from './tables/crew'
import { notifyAlmanacLocalChange } from './notify'
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
  const crewKey = tableName === CREW_SYNC_TABLE ? parseCrewKey(syncKey) : null
  if (crewKey?.region === 'agent') {
    const agentId = crewKey.agentKey
    const [agent] = await database.select<Array<Record<string, unknown>>>(
      `select id, name, role, domain, enabled, allowed_tools as allowedTools, created_at as createdAt, updated_at as updatedAt
       from agent_settings where id = $1`, [agentId],
    )
    if (agent) {
      const memory = await database.select<Array<Record<string, unknown>>>(
        'select agent_id as agentId, kind, content, updated_at as updatedAt, updated_by as updatedBy from agent_memory where agent_id = $1', [agentId],
      )
      const { recordDbTrash } = await import('@/lib/trash/runtime')
      await recordDbTrash({
        entityType: 'agent',
        entityId: agentId,
        title: expertTitle(agent as Partial<AgentSyncValue>),
        deletedBy: 'sync',
        actorRole: 'sync',
        source: 'sync',
        metadata: { agent, memory },
      })
      await removeCrewAgent(database, agentId)
    }
  }
  await markPendingRecordDeletion(database, tableName, syncKey, 'confirmed', Date.now())
  emitter.emit('pending-sync-deletions-changed')
  return true
}

/**
 * Fork（almanac ALMNC-85.3）：從最近刪除救回別台刪掉的專家——設定與記憶寫回本機，時間記成現在（晚於刪除墓碑），
 * 下一輪同步推回另一台。同 id 已經存在（例如之後又同步回來）就不重複寫。
 */
export async function restoreCrewAgentSnapshot(metadata: Record<string, unknown>): Promise<void> {
  const agent = metadata.agent as Record<string, unknown> | undefined
  if (!agent || typeof agent.id !== 'string' || typeof agent.name !== 'string') return
  const database = await db()
  const exists = await database.select<Array<{ id: string }>>('select id from agent_settings where id = $1', [agent.id])
  if (exists.length) return
  const now = Date.now()
  await database.execute(
    `insert into agent_settings (id, name, role, domain, enabled, allowed_tools, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      agent.id, agent.name, String(agent.role ?? 'expert'), typeof agent.domain === 'string' ? agent.domain : null,
      Number(agent.enabled ?? 1) ? 1 : 0, typeof agent.allowedTools === 'string' ? agent.allowedTools : JSON.stringify(agent.allowedTools ?? []),
      Number(agent.createdAt ?? now), now,
    ],
  )
  const memory = Array.isArray(metadata.memory) ? metadata.memory as Array<Record<string, unknown>> : []
  for (const row of memory) {
    if (typeof row.kind !== 'string' || typeof row.content !== 'string') continue
    await database.execute(
      `insert into agent_memory (agent_id, kind, content, updated_at, updated_by) values ($1, $2, $3, $4, $5)
       on conflict(agent_id, kind) do nothing`,
      [agent.id, row.kind, row.content, now, String(row.updatedBy ?? 'scott')],
    )
  }
  notifyAlmanacLocalChange('agent-restored')
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
  const crewKey = tableName === CREW_SYNC_TABLE ? parseCrewKey(syncKey) : null
  if (crewKey?.region === 'agent') {
    // 保留＝專家與記憶記成「現在改過」，下一輪同步晚於墓碑，推回遠端、另一台也拿回來。
    await keepCrewAgent(database, crewKey.agentKey, Date.now())
    notifyAlmanacLocalChange('agent-kept')
  }
  emitter.emit('pending-sync-deletions-changed')
  return true
}

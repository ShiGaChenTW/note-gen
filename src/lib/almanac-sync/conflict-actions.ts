// Fork（almanac ALMNC-85.3，第 8 節 3A）：工作台確認卡的動作——Scott 的偏好、soul.md、rules.md 兩台改到同一段時讓 Scott 挑。
// 用這台的＝不動（同步時已先保留這台）；用另一台的＝衝突段換成另一台的版本（其他段兩邊的修改都留）；自己合併＝寫 Scott 改好的全文。
// 寫回走正式的寫入函式（actor 是 Scott，權限照舊檢查），寫完會排 V3 同步，另一台也拿到 Scott 挑的版本。
'use client'

import emitter from '@/lib/emitter'
import {
  getSyncConflict,
  listSyncConflicts,
  markSyncConflictResolved,
  resolvedText,
  type ConflictChoice,
  type SyncConflict,
} from './tables/conflicts'

async function db() {
  const { getDb } = await import('@/db/index')
  return getDb()
}

export async function listSyncConflictsForUi(): Promise<SyncConflict[]> {
  return listSyncConflicts(await db(), 'open')
}

async function currentText(conflict: SyncConflict): Promise<{ text: string; write: (next: string) => Promise<void> } | null> {
  const memory = await import('@/db/agent-memory')
  if (conflict.subject === 'preferences') {
    const preferences = await memory.getScottPreferences()
    return { text: preferences.content, write: next => memory.saveScottPreferences('scott', next) }
  }
  if (!conflict.agentId) return null
  const { getAgentSettings } = await import('@/db/agents')
  const agent = await getAgentSettings(conflict.agentId)
  if (!agent) return null
  const memoryAgent = { id: agent.id, name: agent.name, role: agent.role, domain: agent.domain }
  const view = await memory.getAgentMemory(memoryAgent)
  const kind = conflict.subject
  return {
    text: view[kind].content,
    write: async next => {
      await memory.writeAgentMemory('scott', memoryAgent, kind, next)
    },
  }
}

/** 回傳 false＝卡片已經處理過或找不到那份文字。 */
export async function resolveSyncConflictForUi(
  key: Pick<SyncConflict, 'tableName' | 'syncKey' | 'field'>,
  choice: ConflictChoice,
): Promise<boolean> {
  const database = await db()
  const conflict = await getSyncConflict(database, key.tableName, key.syncKey, key.field)
  if (!conflict || conflict.status !== 'open') return false
  const target = await currentText(conflict)
  if (!target) return false
  const next = resolvedText(conflict, target.text, choice)
  if (next !== null && next !== target.text) await target.write(next)
  await markSyncConflictResolved(database, key.tableName, key.syncKey, key.field, Date.now())
  emitter.emit('almanac-sync-conflicts-changed', undefined)
  return true
}

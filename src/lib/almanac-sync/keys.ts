// Fork（almanac ALMNC-85.2 骨架）：同步鍵（設計 1.3、1.6）。
// 每張表選一個兩台都會算出一樣值的鍵，不用本機自增 id。
import { hashString } from './hash'

export const SOURCE_BUCKET_COUNT = 32

/** 遷移換過 id 的列：同步鍵 = legacyId ?? id（A 台 S-…＋legacy src_rss:X，B 台 src_rss:X，鍵相同）。 */
export function legacyAwareSyncKey(row: { id: string; legacyId?: string | null }): string {
  return row.legacyId?.trim() || row.id
}

/** 單例角色（指揮官、秘書、研究員）用角色名當鍵：兩台各建一位時 id 不同、鍵相同。 */
export function roleSyncKey(role: string): string {
  return `role:${role}`
}

/** 只能新增的表（活動紀錄）另給 uid = <deviceId>:<本機 id>。 */
export function deviceScopedUid(deviceId: string, localId: number | string): string {
  return `${deviceId}:${localId}`
}

/** 依同步鍵雜湊分桶（b00…b31）：新增一列只改一桶，一次塞上千列也不會出現超大檔。 */
export function bucketForKey(key: string, count = SOURCE_BUCKET_COUNT): string {
  const value = parseInt(hashString(key).slice(-8), 16)
  return `b${String(value % count).padStart(2, '0')}`
}

export function allBuckets(count = SOURCE_BUCKET_COUNT): string[] {
  return Array.from({ length: count }, (_, index) => `b${String(index).padStart(2, '0')}`)
}

// ---------- 本機對話編號 ↔ 跨裝置不變的 syncId（1.6） ----------

const PORTABLE_CONVERSATION_PREFIX = 'conv:'

/** 傳出時把本機對話編號換成 conv:<syncId>；查不到 syncId 時保留裝置前綴，避免撞到別台的編號。 */
export function toPortableConversationRef(
  localId: number,
  lookupSyncId: (localId: number) => string | null | undefined,
  deviceId: string,
): string {
  const syncId = lookupSyncId(localId)
  return syncId ? `${PORTABLE_CONVERSATION_PREFIX}${syncId}` : `${PORTABLE_CONVERSATION_PREFIX}${deviceId}:${localId}`
}

/**
 * 收進來時查 conversations.syncId 換回本機編號；查不到（對話同步關著或還沒到）就回 null，
 * 呼叫端保留 conv:<syncId>，畫面顯示「另一台的對話（尚未同步）」。
 */
export function fromPortableConversationRef(
  ref: string,
  lookupLocalId: (syncId: string) => number | null | undefined,
): { localId: number | null; syncId: string | null } {
  if (!ref.startsWith(PORTABLE_CONVERSATION_PREFIX)) return { localId: null, syncId: null }
  const syncId = ref.slice(PORTABLE_CONVERSATION_PREFIX.length)
  return { localId: lookupLocalId(syncId) ?? null, syncId }
}

/** 月份檔名（追加表 <deviceId>/<YYYY-MM>.json），用 UTC 讓兩台算出一樣的月份。 */
export function monthKey(at: number): string {
  const date = new Date(at)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

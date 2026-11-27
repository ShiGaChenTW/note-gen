// Fork（almanac ALMNC-85.2 骨架）：自架同步的 V3 物件格式（設計 5.1、6 風險 1）。
//
// 設計原本想新增 almanac-source 等物件種類，但伺服器（upstream note-gen-server）是否接受未知種類未驗證：
// 這台機器沒有可測的自架伺服器，client 端 SyncObjectKind 也是封閉清單。照 5.1 的退路，
// 外層一律用既有種類 `setting`，加密 payload 裡以 domain = 'almanac' 區分（structured.ts 已靠 payload.domain 分流），不必改伺服器。
// 現有 applyStructuredPayload 遇到不認得的 domain 會直接忽略，所以舊版 App 收到這些物件也不會誤套用。
//
// 尚未接進自架同步的 runtime（outbox／收件）；這裡先定好物件 id 與 payload，讓 85.2～85.4 的表直接沿用。
import type { SyncObjectKind } from '@/lib/self-hosted-sync/protocol'
import type { AlmanacSyncLayer } from './remote'
import type { SyncRow, SyncTombstone, SyncValue } from './envelope'

export const ALMANAC_SELF_HOSTED_KIND: SyncObjectKind = 'setting'
export const ALMANAC_SELF_HOSTED_DOMAIN = 'almanac'

export interface AlmanacSelfHostedPayload<V extends SyncValue = SyncValue> {
  domain: typeof ALMANAC_SELF_HOSTED_DOMAIN
  /** 設計第 2 節的自架種類名稱（almanac-source、almanac-feed…），只放在 payload 裡 */
  objectType: string
  table: string
  syncKey: string
  row: SyncRow<V> | null
  deleted: SyncTombstone | null
}

/** 帳號層 → account-data 工作區；筆記庫層 → library 工作區（設計 1.1） */
export function selfHostedWorkspaceTypeFor(layer: AlmanacSyncLayer): 'account-data' | 'library' {
  return layer === 'account' ? 'account-data' : 'library'
}

/** 物件 id 由表與同步鍵決定，兩台算出一樣的值 */
export function almanacSelfHostedObjectId(table: string, syncKey: string): string {
  return `almanac:${table}:${syncKey}`
}

export function encodeAlmanacSelfHostedPayload<V extends SyncValue>(input: {
  objectType: string
  table: string
  syncKey: string
  row?: SyncRow<V> | null
  deleted?: SyncTombstone | null
}): AlmanacSelfHostedPayload<V> {
  return {
    domain: ALMANAC_SELF_HOSTED_DOMAIN,
    objectType: input.objectType,
    table: input.table,
    syncKey: input.syncKey,
    row: input.row ?? null,
    deleted: input.deleted ?? null,
  }
}

export function decodeAlmanacSelfHostedPayload(payload: Record<string, unknown>): AlmanacSelfHostedPayload | null {
  if (payload.domain !== ALMANAC_SELF_HOSTED_DOMAIN) return null
  if (typeof payload.table !== 'string' || typeof payload.syncKey !== 'string' || typeof payload.objectType !== 'string') return null
  const row = payload.row as SyncRow | null | undefined
  const deleted = payload.deleted as SyncTombstone | null | undefined
  const validRow = row && typeof row === 'object' && typeof row.u === 'number' && typeof row.d === 'string' && row.v && typeof row.v === 'object'
  const validDeleted = deleted && typeof deleted === 'object' && typeof deleted.deletedAt === 'number' && typeof deleted.deviceId === 'string'
  if (!validRow && !validDeleted) return null
  return {
    domain: ALMANAC_SELF_HOSTED_DOMAIN,
    objectType: payload.objectType,
    table: payload.table,
    syncKey: payload.syncKey,
    row: validRow ? row : null,
    deleted: validDeleted ? deleted : null,
  }
}

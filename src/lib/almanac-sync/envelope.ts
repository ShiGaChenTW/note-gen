// Fork（almanac ALMNC-85.2 骨架）：V3 同步檔的共用外殼（設計 1.2）。
// 每個同步檔都是同一個 JSON 外殼：rows 放可攜欄位與最後修改的時間／裝置，deleted 放記錄內墓碑（30 天後清）。
import { TOMBSTONE_TTL_MS } from '@/lib/sync/deletion-tombstones'
import { hashString, stableStringify } from './hash'

export const ALMANAC_SYNC_FORMAT = 'almanac-v3-sync'
export const ALMANAC_SYNC_VERSION = 1
export { TOMBSTONE_TTL_MS as ALMANAC_TOMBSTONE_TTL_MS }

export type SyncValue = Record<string, unknown>

/** 一列：v＝可攜欄位、u／d＝最後修改的時間與裝置（較晚的贏時用來決勝負）。 */
export interface SyncRow<V extends SyncValue = SyncValue> {
  v: V
  u: number
  d: string
}

export interface SyncTombstone {
  deletedAt: number
  deviceId: string
}

export interface SyncEnvelope<V extends SyncValue = SyncValue> {
  format: typeof ALMANAC_SYNC_FORMAT
  table: string
  version: number
  updatedAt: number
  updatedBy: string
  rows: Record<string, SyncRow<V>>
  deleted: Record<string, SyncTombstone>
}

export class AlmanacSyncFormatError extends Error {
  constructor(path: string, reason: string) {
    super(`SYNC_DATA_INVALID_SCHEMA: almanac ${path}: ${reason}`)
    this.name = 'AlmanacSyncFormatError'
  }
}

export function emptyEnvelope<V extends SyncValue>(table: string, deviceId = '', now = 0): SyncEnvelope<V> {
  return { format: ALMANAC_SYNC_FORMAT, table, version: ALMANAC_SYNC_VERSION, updatedAt: now, updatedBy: deviceId, rows: {}, deleted: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 解析遠端同步檔。檔案不存在時傳 null 進來，得到空外殼；格式錯誤一律丟錯，
 * 不能把壞掉的檔當成「遠端是空的」，否則會把本機資料當成新增、或把遠端蓋掉。
 */
export function parseEnvelope<V extends SyncValue>(content: string | null, table: string, path = table): SyncEnvelope<V> {
  if (content === null || content.trim() === '') return emptyEnvelope<V>(table)
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new AlmanacSyncFormatError(path, 'invalid JSON')
  }
  if (!isRecord(parsed) || parsed.format !== ALMANAC_SYNC_FORMAT) throw new AlmanacSyncFormatError(path, 'unknown format')
  if (parsed.table !== table) throw new AlmanacSyncFormatError(path, `table mismatch (${String(parsed.table)})`)
  if (!isFiniteNumber(parsed.version) || parsed.version > ALMANAC_SYNC_VERSION) {
    // 較新版 App 寫的檔：不認得就不碰，避免舊版把新欄位丟掉後再傳回去。
    throw new AlmanacSyncFormatError(path, `unsupported version ${String(parsed.version)}`)
  }
  const rows: Record<string, SyncRow<V>> = {}
  if (isRecord(parsed.rows)) {
    for (const [key, row] of Object.entries(parsed.rows)) {
      if (!isRecord(row) || !isRecord(row.v) || !isFiniteNumber(row.u) || typeof row.d !== 'string') {
        throw new AlmanacSyncFormatError(path, `invalid row ${key}`)
      }
      rows[key] = { v: row.v as V, u: row.u, d: row.d }
    }
  }
  const deleted: Record<string, SyncTombstone> = {}
  if (isRecord(parsed.deleted)) {
    for (const [key, tombstone] of Object.entries(parsed.deleted)) {
      if (!isRecord(tombstone) || !isFiniteNumber(tombstone.deletedAt) || typeof tombstone.deviceId !== 'string') {
        throw new AlmanacSyncFormatError(path, `invalid tombstone ${key}`)
      }
      deleted[key] = { deletedAt: tombstone.deletedAt, deviceId: tombstone.deviceId }
    }
  }
  return {
    format: ALMANAC_SYNC_FORMAT,
    table,
    version: parsed.version,
    updatedAt: isFiniteNumber(parsed.updatedAt) ? parsed.updatedAt : 0,
    updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : '',
    rows,
    deleted,
  }
}

export function pruneTombstones(deleted: Record<string, SyncTombstone>, now: number): Record<string, SyncTombstone> {
  return Object.fromEntries(Object.entries(deleted).filter(([, tombstone]) => now - tombstone.deletedAt < TOMBSTONE_TTL_MS))
}

/** 只比內容（rows＋deleted），不比 updatedAt／updatedBy：內容沒變就不必重傳。 */
export function envelopeContentHash(envelope: Pick<SyncEnvelope, 'rows' | 'deleted'>): string {
  return hashString(stableStringify({ rows: envelope.rows, deleted: envelope.deleted }))
}

export function serializeEnvelope<V extends SyncValue>(envelope: SyncEnvelope<V>): string {
  const sortedRows = Object.fromEntries(Object.keys(envelope.rows).sort().map(key => [key, envelope.rows[key]]))
  const sortedDeleted = Object.fromEntries(Object.keys(envelope.deleted).sort().map(key => [key, envelope.deleted[key]]))
  return `${JSON.stringify({ ...envelope, rows: sortedRows, deleted: sortedDeleted }, null, 2)}\n`
}

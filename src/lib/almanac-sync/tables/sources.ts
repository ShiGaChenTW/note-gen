// Fork（almanac ALMNC-85.2）：資料源群組的同步表（設計 2.1、M5）。
// 一則資料源一列，v 裡內嵌它的初步判斷（source_judgements）、產出連結（source_outputs）與舊筆記待決定（legacy_undecided）。
// 內嵌是因為這三張表都以 source_id 為鍵，分開放會遇到「判斷先到、資料源還沒到」的順序問題。
// 存放：.data/almanac/sources/index.json＋b00…b31.json（依同步鍵雜湊分 32 桶，新增一則只改一桶）。
//
// 同步鍵 = legacyId ?? id（設計 1.3）：A 台已遷移成 S-…（legacy src_rss:X）、B 台還是 src_rss:X 時鍵相同；
// 合併後採用 S 編號，B 台把本機那列改名（引用一起改，舊 id 存 legacy_id，舊引用照樣找得到）。
// 兩台各自遷移出不同 S 編號時取字串較小的，另一個記進別名表（getSource 也認別名）。
//
// 只用 AlmanacSqlDb（plugin-sql 相容介面），雙裝置模擬測試直接用 node:sqlite。
import { isLaterStamp, maxNumber, minNonNull, type FieldMergeContext, type FieldRule } from '../merge'
import { hashString } from '../hash'
import { recordAlias } from '../aliases'
import { SOURCE_BUCKET_COUNT } from '../keys'
import type { AlmanacSqlDb } from '../sql'
import type { AlmanacRowsTable, AlmanacTableContext, LocalSyncRow } from './registry'

export const SOURCES_SYNC_TABLE = 'sources'
export const SOURCE_ALIAS_TABLE = 'sources'

export interface SourceJudgementSync {
  status: string
  type?: string
  suggestion?: string
  model?: string
  error?: string
  followSuggestion: boolean
  createdAt: number
  updatedAt: number
}

export interface SourceOutputSync {
  targetType: string
  targetRef: string
  createdAt: number
}

export interface LegacyUndecidedSync {
  path: string
  batchId: string
  createdAt: number
  resolvedAt?: number
}

export interface SourceSyncValue extends Record<string, unknown> {
  id: string
  legacyId?: string
  sourceType: string
  kind: string
  content: string
  origin?: string
  collectedAt: number
  collector: string
  status: string
  statusChangedAt: number
  version: number
  previousId?: string
  lockedAt?: number
  archivedAt?: number
  createdAt: number
  isJournal: boolean
  judgement?: SourceJudgementSync
  outputs?: SourceOutputSync[]
  legacyUndecided?: LegacyUndecidedSync
}

/** 本機對話編號的資料源 id（src_conversation:<數字>）只在這台有意義（設計 1.6、M5）。 */
const LOCAL_CONVERSATION_SOURCE = /^src_conversation:(\d+)$/

/** 同步鍵：legacyId ?? id；舊 id 是本機對話編號時不算（另一台的同編號是別段對話）。 */
export function sourceSyncKey(row: { id: string; legacyId?: string | null }): string {
  const legacy = row.legacyId?.trim()
  if (legacy && !LOCAL_CONVERSATION_SOURCE.test(legacy)) return legacy
  return row.id
}

function portableLegacyId(legacyId: string | null | undefined): string | undefined {
  const legacy = legacyId?.trim()
  return legacy && !LOCAL_CONVERSATION_SOURCE.test(legacy) ? legacy : undefined
}

const S_ID = /^S-/

/** 兩邊的 id 不同（同一個同步鍵）時選正式 id：遷移過的 S 編號優先；都是 S 編號取字串較小的。兩台算出來一定一樣。 */
export function canonicalSourceId(left: string, right: string): string {
  if (left === right) return left
  const leftS = S_ID.test(left)
  const rightS = S_ID.test(right)
  if (leftS !== rightS) return leftS ? left : right
  return left < right ? left : right
}

// ---------- 欄位規則 ----------

/** 狀態前進順序（設計 2.1）：analyzed 永遠贏；rejected 對上 awaiting_decision 看 statusChangedAt；其他照順序。 */
const STATUS_ORDER = ['awaiting_decision', 'pending_analysis', 'analyzing', 'rejected', 'analyzed'] as const

export function resolveSourceStatus(local: SourceSyncValue, remote: SourceSyncValue, localIsLater: boolean): 'local' | 'remote' {
  if (local.status === remote.status) return localIsLater ? 'local' : 'remote'
  const pair = new Set([local.status, remote.status])
  if (pair.has('rejected') && pair.has('awaiting_decision')) {
    // 工作台可以「改回等你決定」（rejected → awaiting_decision），所以這一對看誰較晚改。
    if (local.statusChangedAt !== remote.statusChangedAt) return local.statusChangedAt > remote.statusChangedAt ? 'local' : 'remote'
    return localIsLater ? 'local' : 'remote'
  }
  const localRank = STATUS_ORDER.indexOf(local.status as typeof STATUS_ORDER[number])
  const remoteRank = STATUS_ORDER.indexOf(remote.status as typeof STATUS_ORDER[number])
  return localRank >= remoteRank ? 'local' : 'remote'
}

const statusRule: FieldRule = {
  type: 'resolve',
  resolve: (_local, _remote, context) => {
    const side = resolveSourceStatus(context.local.v as SourceSyncValue, context.remote.v as SourceSyncValue, context.localIsLater)
    return (side === 'local' ? context.local.v : context.remote.v).status
  },
}

/** statusChangedAt 跟著狀態贏的那一邊走。 */
const statusChangedAtRule: FieldRule = {
  type: 'resolve',
  resolve: (_local, _remote, context) => {
    const side = resolveSourceStatus(context.local.v as SourceSyncValue, context.remote.v as SourceSyncValue, context.localIsLater)
    return (side === 'local' ? context.local.v : context.remote.v).statusChangedAt
  },
}

/** 兩邊 id 不同：選正式 id；落敗的 S 編號記下來，合併完寫進別名表（本機這列可能完全不用改，所以不能等 apply）。 */
function idRule(aliases: Map<string, string>): FieldRule {
  return {
    type: 'resolve',
    resolve: (local, remote) => {
      const canonical = canonicalSourceId(String(local), String(remote))
      const other = canonical === local ? String(remote) : String(local)
      if (S_ID.test(other) && other !== canonical) aliases.set(other, canonical)
      return canonical
    },
  }
}

/** legacyId：有值的贏（遷移過的那邊帶舊 id 過來）；兩邊都有又不同時取字串較小的。 */
const legacyIdRule: FieldRule = {
  type: 'resolve',
  resolve: (local, remote) => {
    if (!local) return remote
    if (!remote) return local
    return String(local) < String(remote) ? local : remote
  },
}

/** 初步判斷：成功的贏過失敗的；都成功（或都失敗）較晚的贏；「照建議處理」取 OR。 */
const judgementRule: FieldRule = {
  type: 'resolve',
  resolve: (local, remote, context) => {
    const left = local as SourceJudgementSync | undefined
    const right = remote as SourceJudgementSync | undefined
    if (!left) return right
    if (!right) return left
    const leftOk = left.status === 'ready'
    const rightOk = right.status === 'ready'
    const base = leftOk !== rightOk
      ? (leftOk ? left : right)
      : left.updatedAt !== right.updatedAt ? (left.updatedAt > right.updatedAt ? left : right) : (context.localIsLater ? left : right)
    return { ...base, followSuggestion: Boolean(left.followSuggestion || right.followSuggestion) }
  },
}

export function outputKey(output: Pick<SourceOutputSync, 'targetType' | 'targetRef'>): string {
  return `${output.targetType}\u0000${output.targetRef}`
}

/** 產出連結：B 型聯集，鍵 (targetType, targetRef)；同鍵取較早建立的那筆；排序固定，兩台雜湊一樣。 */
export function unionOutputs(...lists: Array<SourceOutputSync[] | undefined>): SourceOutputSync[] | undefined {
  const merged = new Map<string, SourceOutputSync>()
  for (const list of lists) {
    for (const output of list ?? []) {
      const key = outputKey(output)
      const existing = merged.get(key)
      if (!existing || output.createdAt < existing.createdAt) merged.set(key, output)
    }
  }
  if (!merged.size) return undefined
  return [...merged.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([, output]) => output)
}

const outputsRule: FieldRule = {
  type: 'resolve',
  resolve: (local, remote) => unionOutputs(local as SourceOutputSync[] | undefined, remote as SourceOutputSync[] | undefined),
}

/** 舊筆記待決定：resolvedAt 取較早的非空值（整理好了就保持）。 */
const legacyUndecidedRule: FieldRule = {
  type: 'resolve',
  resolve: (local, remote, context) => {
    const left = local as LegacyUndecidedSync | undefined
    const right = remote as LegacyUndecidedSync | undefined
    if (!left) return right
    if (!right) return left
    const base = context.localIsLater ? left : right
    const resolved = [left.resolvedAt, right.resolvedAt].filter((value): value is number => typeof value === 'number')
    const next: LegacyUndecidedSync = { path: base.path, batchId: base.batchId, createdAt: Math.min(left.createdAt, right.createdAt) }
    if (resolved.length) next.resolvedAt = Math.min(...resolved)
    return next
  },
}

export interface ContentConflictLoser {
  key: string
  value: SourceSyncValue
  content: string
}

/**
 * content 兩邊都改且不同：不覆蓋任何一邊（設計 2.1）。較晚的那份留在原列，另一份另存成新版本（previousId 連回同一個舊版）。
 * 新版本的 id 由「同步鍵＋內容」決定，兩台各自偵測到同一個衝突時得到同一列，不會重複。
 */
function contentRule(losers: Map<string, ContentConflictLoser>): FieldRule {
  return {
    type: 'resolve',
    resolve: (local, remote, context: FieldMergeContext) => {
      const winnerIsLocal = isLaterStamp(context.local, context.remote)
      const loserValue = (winnerIsLocal ? context.remote.v : context.local.v) as SourceSyncValue
      const key = sourceSyncKey(context.local.v as SourceSyncValue)
      losers.set(key, { key, value: loserValue, content: String(winnerIsLocal ? remote : local) })
      return winnerIsLocal ? local : remote
    },
  }
}

export function conflictVersionId(key: string, content: string): string {
  return `src_conflict:${hashString(`${key}\u0000${content}`)}`
}

// ---------- 讀寫本機 ----------

interface SourceDbRow {
  id: string
  sourceType: string
  kind: string
  content: string
  origin: string | null
  collectedAt: number
  collector: string
  status: string
  statusChangedAt: number
  version: number
  previousId: string | null
  lockedAt: number | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
  isJournal: number | null
  legacyId: string | null
}

const SOURCE_SELECT = `select id, source_type as sourceType, kind, content, origin, collected_at as collectedAt, collector,
  status, status_changed_at as statusChangedAt, version, previous_id as previousId, locked_at as lockedAt,
  archived_at as archivedAt, created_at as createdAt, updated_at as updatedAt, is_journal as isJournal, legacy_id as legacyId
  from sources`

/** 建表（跟 src/db/v3-sources.ts、v3-source-judgements.ts、v3-legacy-packs.ts 一致；App 裡那些 init 已先跑過，這裡是 no-op）。 */
export async function ensureSourceSyncSchema(db: AlmanacSqlDb): Promise<void> {
  await db.execute(`create table if not exists sources (
    id text primary key, source_type text not null, kind text not null, content text not null, origin text,
    collected_at integer not null, collector text not null, status text not null, status_changed_at integer not null,
    version integer not null default 1, previous_id text, locked_at integer, archived_at integer,
    created_at integer not null, updated_at integer not null)`)
  for (const column of ['is_journal integer not null default 0', 'legacy_id text']) {
    try {
      await db.execute(`alter table sources add column ${column}`)
    } catch {
      // 欄位已經存在。
    }
  }
  await db.execute(`create table if not exists source_outputs (
    source_id text not null, target_type text not null, target_ref text not null, created_at integer not null,
    primary key (source_id, target_type, target_ref))`)
  await db.execute(`create table if not exists source_judgements (
    source_id text primary key, status text not null, type text, suggestion text, model text, error text,
    follow_suggestion integer not null default 0, created_at integer not null, updated_at integer not null)`)
  await db.execute(`create table if not exists legacy_undecided (
    source_id text primary key, path text not null, batch_id text not null, created_at integer not null, resolved_at integer)`)
}

/** 改資料源 id，引用一起改（比照 id-migration：previous_id、source_outputs、source_judgements、legacy_undecided）。 */
export async function renameSourceId(db: AlmanacSqlDb, fromId: string, toId: string, legacyId: string | null): Promise<void> {
  if (fromId === toId) return
  await db.execute('update sources set id = $1, legacy_id = coalesce(legacy_id, $2) where id = $3', [toId, legacyId, fromId])
  await db.execute('update sources set previous_id = $1 where previous_id = $2', [toId, fromId])
  await db.execute('update or ignore source_outputs set source_id = $1 where source_id = $2', [toId, fromId])
  await db.execute('delete from source_outputs where source_id = $1', [fromId])
  await db.execute('update or ignore source_judgements set source_id = $1 where source_id = $2', [toId, fromId])
  await db.execute('delete from source_judgements where source_id = $1', [fromId])
  await db.execute('update or ignore legacy_undecided set source_id = $1 where source_id = $2', [toId, fromId])
}

async function lookupConversationSyncId(db: AlmanacSqlDb, localId: number): Promise<string | null> {
  try {
    const rows = await db.select<Array<{ syncId: string | null }>>('select syncId as syncId from conversations where id = $1', [localId])
    return rows[0]?.syncId ?? null
  } catch {
    // 沒有對話表（測試）或欄位還沒建：當成找不到。
    return null
  }
}

async function sourceIdExists(db: AlmanacSqlDb, id: string): Promise<boolean> {
  const rows = await db.select<Array<{ id: string }>>('select id from sources where id = $1 limit 1', [id])
  return rows.length > 0
}

/**
 * M5：src_conversation:<數字> 換成 src_conversation:<syncId>（找不到對話就加裝置前綴），舊 id 存 legacy_id，引用一起改。
 * 第一次同步時才跑（只在讀本機資料源時執行），getSource 本來就認 legacy_id，舊引用照樣找得到。
 */
export async function migrateConversationSourceIds(db: AlmanacSqlDb, deviceId: string): Promise<string[]> {
  const rows = await db.select<Array<{ id: string; legacyId: string | null }>>(
    "select id, legacy_id as legacyId from sources where id like 'src_conversation:%'",
  )
  const renamed: string[] = []
  for (const row of rows) {
    const match = LOCAL_CONVERSATION_SOURCE.exec(row.id)
    if (!match) continue
    const syncId = await lookupConversationSyncId(db, Number(match[1]))
    let target = syncId ? `src_conversation:${syncId}` : `src_conversation:${deviceId}:${match[1]}`
    if (await sourceIdExists(db, target)) target = `src_conversation:${deviceId}:${match[1]}`
    if (await sourceIdExists(db, target)) continue
    await renameSourceId(db, row.id, target, row.legacyId ?? row.id)
    renamed.push(row.id)
  }
  return renamed
}

function toSyncValue(
  row: SourceDbRow,
  judgement: SourceJudgementSync | undefined,
  outputs: SourceOutputSync[] | undefined,
  legacy: LegacyUndecidedSync | undefined,
): SourceSyncValue {
  const value: SourceSyncValue = {
    id: row.id,
    sourceType: row.sourceType,
    kind: row.kind,
    content: row.content,
    collectedAt: Number(row.collectedAt),
    collector: row.collector,
    // 分析中是本機進行中的工作：傳出時當待分析，否則這台當掉時另一台會永遠看到「分析中」（設計 1.6）。
    status: row.status === 'analyzing' ? 'pending_analysis' : row.status,
    statusChangedAt: Number(row.statusChangedAt),
    version: Number(row.version),
    createdAt: Number(row.createdAt),
    isJournal: Number(row.isJournal ?? 0) === 1,
  }
  const legacyId = portableLegacyId(row.legacyId)
  if (legacyId) value.legacyId = legacyId
  if (row.origin !== null && row.origin !== undefined) value.origin = row.origin
  if (row.previousId) value.previousId = row.previousId
  if (row.lockedAt !== null && row.lockedAt !== undefined) value.lockedAt = Number(row.lockedAt)
  if (row.archivedAt !== null && row.archivedAt !== undefined) value.archivedAt = Number(row.archivedAt)
  if (judgement) value.judgement = judgement
  if (outputs?.length) value.outputs = outputs
  if (legacy) value.legacyUndecided = legacy
  return value
}

export async function readLocalSources(db: AlmanacSqlDb): Promise<Record<string, LocalSyncRow<SourceSyncValue>>> {
  const sources = await db.select<SourceDbRow[]>(SOURCE_SELECT)
  const judgements = await db.select<Array<{
    sourceId: string; status: string; type: string | null; suggestion: string | null; model: string | null; error: string | null
    followSuggestion: number; createdAt: number; updatedAt: number
  }>>(`select source_id as sourceId, status, type, suggestion, model, error, follow_suggestion as followSuggestion,
    created_at as createdAt, updated_at as updatedAt from source_judgements`)
  const outputs = await db.select<Array<{ sourceId: string; targetType: string; targetRef: string; createdAt: number }>>(
    'select source_id as sourceId, target_type as targetType, target_ref as targetRef, created_at as createdAt from source_outputs',
  )
  const legacy = await db.select<Array<{ sourceId: string; path: string; batchId: string; createdAt: number; resolvedAt: number | null }>>(
    'select source_id as sourceId, path, batch_id as batchId, created_at as createdAt, resolved_at as resolvedAt from legacy_undecided',
  )

  const judgementById = new Map(judgements.map(row => {
    const judgement: SourceJudgementSync = {
      status: row.status,
      followSuggestion: Number(row.followSuggestion) === 1,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }
    if (row.type) judgement.type = row.type
    if (row.suggestion) judgement.suggestion = row.suggestion
    if (row.model) judgement.model = row.model
    if (row.error) judgement.error = row.error
    return [row.sourceId, judgement] as const
  }))
  const outputsById = new Map<string, SourceOutputSync[]>()
  for (const row of outputs) {
    outputsById.set(row.sourceId, [...(outputsById.get(row.sourceId) ?? []), { targetType: row.targetType, targetRef: row.targetRef, createdAt: Number(row.createdAt) }])
  }
  const legacyById = new Map(legacy.map(row => {
    const entry: LegacyUndecidedSync = { path: row.path, batchId: row.batchId, createdAt: Number(row.createdAt) }
    if (row.resolvedAt !== null && row.resolvedAt !== undefined) entry.resolvedAt = Number(row.resolvedAt)
    return [row.sourceId, entry] as const
  }))

  const result: Record<string, LocalSyncRow<SourceSyncValue>> = {}
  for (const row of sources) {
    const keys = [row.id, ...(row.legacyId ? [row.legacyId] : [])]
    const pick = <T>(map: Map<string, T>) => keys.map(key => map.get(key)).find(Boolean)
    const judgement = pick(judgementById)
    const rowOutputs = unionOutputs(...keys.map(key => outputsById.get(key)))
    const legacyEntry = pick(legacyById)
    const value = toSyncValue(row, judgement, rowOutputs, legacyEntry)
    const stamps = [
      Number(row.updatedAt),
      judgement?.updatedAt ?? 0,
      ...(rowOutputs ?? []).map(output => output.createdAt),
      legacyEntry?.resolvedAt ?? legacyEntry?.createdAt ?? 0,
    ]
    result[sourceSyncKey(row)] = { v: value, u: Math.max(...stamps) }
  }
  return result
}

async function findLocalSource(db: AlmanacSqlDb, key: string, id: string) {
  const rows = await db.select<Array<{ id: string; legacyId: string | null; status: string }>>(
    `select id, legacy_id as legacyId, status from sources where id = $1 or id = $2 or legacy_id = $2
     order by (id = $1) desc, (id = $2) desc limit 1`,
    [id, key],
  )
  return rows[0]
}

async function upsertSourceRow(db: AlmanacSqlDb, key: string, value: SourceSyncValue, now: number): Promise<void> {
  const local = await findLocalSource(db, key, value.id)
  if (local && local.id !== value.id) {
    // 同一則資料源在兩台的 id 不同：本機改成正式 id，舊 id 留在 legacy_id；都是 S 編號時舊的進別名表（設計 1.3）。
    const legacy = local.legacyId ?? (key !== value.id ? key : local.id)
    await renameSourceId(db, local.id, value.id, legacy)
    if (S_ID.test(local.id) && S_ID.test(value.id)) await recordAlias(db, SOURCE_ALIAS_TABLE, local.id, value.id, now)
  }
  // 本機正在分析：不要被傳進來的「待分析」蓋回去（分析中只是傳出時的換算）。
  const status = local?.status === 'analyzing' && value.status === 'pending_analysis' ? 'analyzing' : value.status
  await db.execute(
    `insert into sources
       (id, source_type, kind, content, origin, collected_at, collector, status, status_changed_at,
        version, previous_id, locked_at, archived_at, created_at, updated_at, is_journal, legacy_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     on conflict(id) do update set source_type = excluded.source_type, kind = excluded.kind, content = excluded.content,
       origin = excluded.origin, collected_at = excluded.collected_at, collector = excluded.collector, status = excluded.status,
       status_changed_at = excluded.status_changed_at, version = excluded.version, previous_id = excluded.previous_id,
       locked_at = excluded.locked_at, archived_at = excluded.archived_at, created_at = excluded.created_at,
       updated_at = excluded.updated_at, is_journal = excluded.is_journal,
       legacy_id = coalesce(sources.legacy_id, excluded.legacy_id)`,
    [
      value.id, value.sourceType, value.kind, value.content, value.origin ?? null, value.collectedAt, value.collector, status,
      value.statusChangedAt, value.version, value.previousId ?? null, value.lockedAt ?? null, value.archivedAt ?? null,
      value.createdAt, now, value.isJournal ? 1 : 0, value.legacyId ?? (key !== value.id ? key : null),
    ],
  )
  if (value.judgement) {
    const judgement = value.judgement
    await db.execute(
      `insert into source_judgements (source_id, status, type, suggestion, model, error, follow_suggestion, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict(source_id) do update set status = excluded.status, type = excluded.type, suggestion = excluded.suggestion,
         model = excluded.model, error = excluded.error, follow_suggestion = excluded.follow_suggestion,
         created_at = excluded.created_at, updated_at = excluded.updated_at`,
      [value.id, judgement.status, judgement.type ?? null, judgement.suggestion ?? null, judgement.model ?? null, judgement.error ?? null,
        judgement.followSuggestion ? 1 : 0, judgement.createdAt, judgement.updatedAt],
    )
  }
  for (const output of value.outputs ?? []) {
    await db.execute(
      `insert into source_outputs (source_id, target_type, target_ref, created_at) values ($1, $2, $3, $4)
       on conflict(source_id, target_type, target_ref) do nothing`,
      [value.id, output.targetType, output.targetRef, output.createdAt],
    )
  }
  if (value.legacyUndecided) {
    const legacy = value.legacyUndecided
    await db.execute(
      `insert into legacy_undecided (source_id, path, batch_id, created_at, resolved_at) values ($1, $2, $3, $4, $5)
       on conflict(source_id) do update set resolved_at = excluded.resolved_at`,
      [value.id, legacy.path, legacy.batchId, legacy.createdAt, legacy.resolvedAt ?? null],
    )
  }
}

export interface SourcesTableOptions {
  /** App 裡先跑既有的 init（initV3SourceDb 等）；沒給就用 ensureSourceSyncSchema。 */
  ensureSchema?: (db: AlmanacSqlDb) => Promise<void>
}

export function createSourcesTable(options: SourcesTableOptions = {}): AlmanacRowsTable<SourceSyncValue> {
  const losers = new Map<string, ContentConflictLoser>()
  const aliases = new Map<string, string>()
  const ensure = async (context: AlmanacTableContext) => {
    await (options.ensureSchema ?? ensureSourceSyncSchema)(context.db)
  }
  return {
    kind: 'rows',
    name: SOURCES_SYNC_TABLE,
    layer: 'account',
    storage: { type: 'buckets', dir: 'sources', count: SOURCE_BUCKET_COUNT },
    rules: {
      id: idRule(aliases),
      legacyId: legacyIdRule,
      content: contentRule(losers),
      status: statusRule,
      statusChangedAt: statusChangedAtRule,
      lockedAt: minNonNull(),
      archivedAt: minNonNull(),
      judgement: judgementRule,
      outputs: outputsRule,
      legacyUndecided: legacyUndecidedRule,
      version: maxNumber(),
    },
    async read(context) {
      await ensure(context)
      losers.clear()
      aliases.clear()
      await migrateConversationSourceIds(context.db, context.deviceId)
      return readLocalSources(context.db)
    },
    async afterMerge(context) {
      const now = context.now()
      let changed = false
      for (const [alias, canonical] of aliases) await recordAlias(context.db, SOURCE_ALIAS_TABLE, alias, canonical, now)
      aliases.clear()
      for (const loser of losers.values()) {
        const versionId = conflictVersionId(loser.key, loser.content)
        if (await sourceIdExists(context.db, versionId)) continue
        const { judgement: _judgement, outputs: _outputs, legacyUndecided: _legacy, legacyId: _legacyId, ...rest } = loser.value
        void _judgement; void _outputs; void _legacy; void _legacyId
        await upsertSourceRow(context.db, versionId, { ...rest, id: versionId, content: loser.content }, now)
        changed = true
      }
      losers.clear()
      return changed
    },
    async apply(context, change) {
      await ensure(context)
      const now = context.now()
      for (const [key, value] of Object.entries(change.upserts)) {
        await upsertSourceRow(context.db, key, value, now)
      }
      for (const key of change.deletes) {
        // 別台刪掉的（只有擷取失敗、還沒送出的外部擷取會真的刪）：本機也刪，判斷一起清。
        const local = await findLocalSource(context.db, key, key)
        if (!local) continue
        await context.db.execute('delete from source_judgements where source_id = $1', [local.id])
        await context.db.execute('delete from sources where id = $1', [local.id])
      }
    },
  }
}

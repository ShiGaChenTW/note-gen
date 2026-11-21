// Fork（almanac ALMNC-54.1）：V3 資料源與「資料源 → 產出」連結表（note.db）。
// 只是薄薄的 SQL 包裝；狀態流轉、鎖定、改版與封存規則都在 src/lib/v3-model/source.ts。
// 本模組沒有刪除資料源的函式：不採用的資料源只會封存（archived_at），不刪除。
import { getDb } from './index'
import {
  archiveSource,
  createSource,
  editSourceContent,
  sourceFromRow,
  sourcesDueForArchive,
  sourceToValues,
  transitionSource,
  type NewSourceInput,
  type Source,
  type SourceEditResult,
  type SourceRow,
  type SourceStatus,
} from '@/lib/v3-model/source'
import { sourceOutputFromRow, type OutputTargetType, type SourceOutput, type SourceOutputRow } from '@/lib/v3-model/links'

const SOURCE_COLUMNS = `id, source_type as sourceType, kind, content, origin, collected_at as collectedAt, collector,
  status, status_changed_at as statusChangedAt, version, previous_id as previousId, locked_at as lockedAt,
  archived_at as archivedAt, created_at as createdAt, updated_at as updatedAt`

const OUTPUT_COLUMNS = 'source_id as sourceId, target_type as targetType, target_ref as targetRef, created_at as createdAt'

let initialized: Promise<void> | null = null

export function initV3SourceDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists sources (
          id text primary key,
          source_type text not null,
          kind text not null,
          content text not null,
          origin text,
          collected_at integer not null,
          collector text not null,
          status text not null,
          status_changed_at integer not null,
          version integer not null default 1,
          previous_id text,
          locked_at integer,
          archived_at integer,
          created_at integer not null,
          updated_at integer not null
        )
      `)
      await db.execute('create index if not exists idx_sources_status on sources(status, status_changed_at)')
      await db.execute('create index if not exists idx_sources_previous on sources(previous_id)')
      await db.execute(`
        create table if not exists source_outputs (
          source_id text not null,
          target_type text not null,
          target_ref text not null,
          created_at integer not null,
          primary key (source_id, target_type, target_ref)
        )
      `)
      await db.execute('create index if not exists idx_source_outputs_target on source_outputs(target_type, target_ref)')
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

function newSourceId(): string {
  return `src_${crypto.randomUUID()}`
}

async function insertSource(source: Source): Promise<void> {
  const db = await getDb()
  await db.execute(
    `insert into sources
       (id, source_type, kind, content, origin, collected_at, collector, status, status_changed_at,
        version, previous_id, locked_at, archived_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    sourceToValues(source)
  )
}

/** 寫回可變欄位；id、來源類型、收集資訊、版本鏈不會被改。 */
async function updateSource(source: Source): Promise<void> {
  const db = await getDb()
  await db.execute(
    `update sources set content = $2, status = $3, status_changed_at = $4, locked_at = $5,
       archived_at = $6, updated_at = $7
     where id = $1`,
    [source.id, source.content, source.status, source.statusChangedAt, source.lockedAt ?? null, source.archivedAt ?? null, source.updatedAt]
  )
}

export async function getSource(id: string): Promise<Source | undefined> {
  await initV3SourceDb()
  const db = await getDb()
  const rows = await db.select<SourceRow[]>(`select ${SOURCE_COLUMNS} from sources where id = $1`, [id])
  return rows[0] ? sourceFromRow(rows[0]) : undefined
}

export async function listSources(options: { status?: SourceStatus; includeArchived?: boolean; limit?: number } = {}): Promise<Source[]> {
  await initV3SourceDb()
  const db = await getDb()
  const rows = await db.select<SourceRow[]>(
    `select ${SOURCE_COLUMNS} from sources
     where ($1 is null or status = $1) and ($2 = 1 or archived_at is null)
     order by collected_at desc
     limit $3`,
    [options.status ?? null, options.includeArchived ? 1 : 0, options.limit ?? 500]
  )
  return rows.map(sourceFromRow)
}

export async function addSource(input: Omit<NewSourceInput, 'id'> & { id?: string }, now = Date.now()): Promise<Source> {
  await initV3SourceDb()
  const source = createSource({ ...input, id: input.id ?? newSourceId() }, now)
  await insertSource(source)
  return source
}

async function requireSource(id: string): Promise<Source> {
  const source = await getSource(id)
  if (!source) throw new Error(`找不到資料源：${id}`)
  return source
}

export async function setSourceStatus(id: string, to: SourceStatus, now = Date.now()): Promise<Source> {
  const next = transitionSource(await requireSource(id), to, now)
  await updateSource(next)
  return next
}

/** 修改原始內容：草稿原地改；已送出則新增一列新版本，舊列不動。 */
export async function editSource(id: string, content: string, now = Date.now()): Promise<SourceEditResult> {
  const result = editSourceContent(await requireSource(id), content, now, newSourceId())
  if (result.kind === 'updated') await updateSource(result.source)
  else await insertSource(result.source)
  return result
}

/** 封存不採用滿 30 天的資料源，回傳這次封存的 id。 */
export async function archiveDueRejectedSources(now = Date.now()): Promise<string[]> {
  await initV3SourceDb()
  const db = await getDb()
  const rows = await db.select<SourceRow[]>(
    `select ${SOURCE_COLUMNS} from sources where status = 'rejected' and archived_at is null`
  )
  const candidates = rows.map(sourceFromRow)
  const due = new Set(sourcesDueForArchive(candidates, now))
  for (const source of candidates) {
    if (due.has(source.id)) await updateSource(archiveSource(source, now))
  }
  return Array.from(due)
}

// ── 產出連結 ────────────────────────────────────────────────

export async function addSourceOutput(sourceId: string, targetType: OutputTargetType, targetRef: string, now = Date.now()): Promise<void> {
  await initV3SourceDb()
  const db = await getDb()
  await db.execute(
    `insert into source_outputs (source_id, target_type, target_ref, created_at)
     values ($1, $2, $3, $4)
     on conflict(source_id, target_type, target_ref) do nothing`,
    [sourceId, targetType, targetRef, now]
  )
}

/** 筆記搬移或改名時，把連結改指到新路徑。 */
export async function renameNoteOutputs(fromPath: string, toPath: string): Promise<void> {
  await initV3SourceDb()
  const db = await getDb()
  await db.execute(
    `update or ignore source_outputs set target_ref = $2 where target_type = 'note' and target_ref = $1`,
    [fromPath, toPath]
  )
}

export async function listOutputsOfSource(sourceId: string): Promise<SourceOutput[]> {
  await initV3SourceDb()
  const db = await getDb()
  const rows = await db.select<SourceOutputRow[]>(`select ${OUTPUT_COLUMNS} from source_outputs where source_id = $1 order by created_at`, [sourceId])
  return rows.map(sourceOutputFromRow)
}

export async function listOutputsToTarget(targetType: OutputTargetType, targetRef: string): Promise<SourceOutput[]> {
  await initV3SourceDb()
  const db = await getDb()
  const rows = await db.select<SourceOutputRow[]>(
    `select ${OUTPUT_COLUMNS} from source_outputs where target_type = $1 and target_ref = $2 order by created_at`,
    [targetType, targetRef]
  )
  return rows.map(sourceOutputFromRow)
}

/** Fork（almanac ALMNC-54.8）：每則資料源的產出數（工作台資料源分頁「N 則產出」）。 */
export async function countOutputsBySource(): Promise<Map<string, number>> {
  await initV3SourceDb()
  const db = await getDb()
  const rows = await db.select<Array<{ sourceId: string, count: number }>>(
    'select source_id as sourceId, count(*) as count from source_outputs group by source_id'
  )
  return new Map(rows.map(row => [row.sourceId, Number(row.count)]))
}

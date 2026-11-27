// Fork（almanac ALMNC-54.1）：V3 資料源與「資料源 → 產出」連結表（note.db）。
// 只是薄薄的 SQL 包裝；狀態流轉、鎖定、改版與封存規則都在 src/lib/v3-model/source.ts。
// 不採用的資料源只會封存（archived_at），不刪除。唯一的例外是擷取失敗、還沒送出的外部擷取（deleteUnsentSource，ALMNC-54.10）。
import { getDb } from './index'
import {
  canDeleteUnsent,
  createSource,
  editSourceContent,
  LEGACY_NOTE_KIND,
  sourceFromRow,
  latestVersions,
  searchSources,
  setJournalTag,
  sourceToValues,
  transitionSource,
  type NewSourceInput,
  type Source,
  type SourceEditResult,
  type SourceRow,
  type SourceStatus,
} from '@/lib/v3-model/source'
import { sweepRejectedSources } from '@/lib/v3-model/archive-sweep'
import { sourceOutputFromRow, type OutputTargetType, type SourceOutput, type SourceOutputRow } from '@/lib/v3-model/links'
import { lastNameOf } from '@/lib/v3-model/id-index'
import { initIdIndexDb } from './id-index'

const SOURCE_COLUMNS = `id, source_type as sourceType, kind, content, origin, collected_at as collectedAt, collector,
  status, status_changed_at as statusChangedAt, version, previous_id as previousId, locked_at as lockedAt,
  archived_at as archivedAt, created_at as createdAt, updated_at as updatedAt, is_journal as isJournal, legacy_id as legacyId`

// Fork（almanac ALMNC-69.4）：target_ref 是編號時（N-… 或 N-…#提案 id），順便從 id_index 查回路徑（indexedPath）；查不到就是 null。
const TARGET_BASE = "case when instr(o.target_ref, '#') > 0 then substr(o.target_ref, 1, instr(o.target_ref, '#') - 1) else o.target_ref end"
const OUTPUT_SELECT = `select o.source_id as sourceId, o.target_type as targetType, o.target_ref as targetRef, o.created_at as createdAt,
  i.path as indexedPath
  from source_outputs o left join id_index i on i.id = ${TARGET_BASE}`

let initialized: Promise<void> | null = null

async function addSourcesColumn(db: Awaited<ReturnType<typeof getDb>>, columnSql: string): Promise<void> {
  try {
    await db.execute(`alter table sources add column ${columnSql}`)
  } catch {
    // 欄位已經存在。
  }
}

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
      // Fork（almanac ALMNC-69.3）：日誌標籤。冪等遷移：欄位已存在時 SQLite 會丟錯，吞掉即可；舊資料預設 0（沒有標籤）。
      // 這個專案的 note.db 沒有編號遷移，每張表在 init 時自己補欄位（同 memories、chats）。
      await addSourcesColumn(db, 'is_journal integer not null default 0')
      // Fork（almanac ALMNC-69.4）：換成 S 編號前的舊 id（遷移時寫入；新資料是 null）。匯入去重與舊筆記標記都認它。
      await addSourcesColumn(db, 'legacy_id text')
      await db.execute('create unique index if not exists idx_sources_legacy on sources(legacy_id) where legacy_id is not null')
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
      // 讀連結時 left join id_index，表要先在。
      await initIdIndexDb()
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
        version, previous_id, locked_at, archived_at, created_at, updated_at, is_journal)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    sourceToValues(source)
  )
}

/** 寫回可變欄位；id、來源類型、收集資訊、版本鏈不會被改。 */
async function updateSource(source: Source): Promise<void> {
  const db = await getDb()
  await db.execute(
    `update sources set content = $2, status = $3, status_changed_at = $4, locked_at = $5,
       archived_at = $6, updated_at = $7, is_journal = $8
     where id = $1`,
    [source.id, source.content, source.status, source.statusChangedAt, source.lockedAt ?? null, source.archivedAt ?? null, source.updatedAt, source.journal ? 1 : 0]
  )
}

/**
 * Fork（almanac ALMNC-69.4）：也認遷移前的舊 id（legacy_id）。還記著 src_… 的地方（尚未接受的提案、
 * 固定 id 的系統資料源如 src_conversation:…）照樣找得到同一則資料源。
 */
export async function getSource(id: string): Promise<Source | undefined> {
  await initV3SourceDb()
  const db = await getDb()
  const rows = await db.select<SourceRow[]>(`select ${SOURCE_COLUMNS} from sources where id = $1 or legacy_id = $1 order by (id = $1) desc limit 1`, [id])
  return rows[0] ? sourceFromRow(rows[0]) : undefined
}

/** 舊 id → 現在的 id（沒遷移過或找不到就回傳原值）。 */
async function currentSourceId(id: string): Promise<string> {
  const db = await getDb()
  const rows = await db.select<Array<{ id: string }>>('select id from sources where legacy_id = $1 limit 1', [id])
  return rows[0]?.id ?? id
}

async function sourceKeyExists(id: string): Promise<boolean> {
  const db = await getDb()
  const rows = await db.select<Array<{ id: string }>>('select id from sources where id = $1 or legacy_id = $1 limit 1', [id])
  return rows.length > 0
}

/**
 * Fork（almanac ALMNC-54.20）：從第一版的 id 往後找到版本鏈最新一版（沒有就回 undefined）。
 * 「送給指揮官」、對話結論這類用固定 id 的資料源，內容改了再送時要接在最新一版後面。
 */
export async function getLatestVersion(rootId: string): Promise<Source | undefined> {
  const first = await getSource(rootId)
  if (!first) return undefined
  let current: Source = first
  const db = await getDb()
  const seen = new Set([current.id])
  for (;;) {
    const rows: SourceRow[] = await db.select<SourceRow[]>(`select ${SOURCE_COLUMNS} from sources where previous_id = $1 order by version desc limit 1`, [current.id])
    const next: Source | undefined = rows[0] ? sourceFromRow(rows[0]) : undefined
    if (!next || seen.has(next.id)) return current
    seen.add(next.id)
    current = next
  }
}

/** Fork（almanac ALMNC-90）：從第一版的 id 列出整條版本鏈（舊到新）；還沒登錄過回空陣列。 */
export async function listVersionChain(rootId: string): Promise<Source[]> {
  const first = await getSource(rootId)
  if (!first) return []
  const chain: Source[] = [first]
  const db = await getDb()
  const seen = new Set([first.id])
  for (;;) {
    const current = chain[chain.length - 1]
    const rows: SourceRow[] = await db.select<SourceRow[]>(`select ${SOURCE_COLUMNS} from sources where previous_id = $1 order by version desc limit 1`, [current.id])
    const next: Source | undefined = rows[0] ? sourceFromRow(rows[0]) : undefined
    if (!next || seen.has(next.id)) return chain
    seen.add(next.id)
    chain.push(next)
  }
}

export async function listSources(options: { status?: SourceStatus; includeArchived?: boolean; limit?: number; excludeKind?: string } = {}): Promise<Source[]> {
  await initV3SourceDb()
  const db = await getDb()
  // Fork（almanac ALMNC-54.14）：excludeKind 讓工作台的資料源清單不被上千則舊筆記擠滿（舊筆記另外合成一張批次卡）。
  const rows = await db.select<SourceRow[]>(
    `select ${SOURCE_COLUMNS} from sources
     where ($1 is null or status = $1) and ($2 = 1 or archived_at is null) and ($4 is null or kind != $4)
     order by collected_at desc
     limit $3`,
    [options.status ?? null, options.includeArchived ? 1 : 0, options.limit ?? 500, options.excludeKind ?? null]
  )
  return rows.map(sourceFromRow)
}

/** Fork（almanac ALMNC-54.14）：全部的舊筆記資料源（含封存，不設上限；內容只是路徑，列很小）。 */
export async function listLegacyNoteSources(): Promise<Source[]> {
  await initV3SourceDb()
  const db = await getDb()
  const rows = await db.select<SourceRow[]>(
    `select ${SOURCE_COLUMNS} from sources where kind = $1 order by collected_at asc`,
    [LEGACY_NOTE_KIND]
  )
  return rows.map(sourceFromRow)
}

/**
 * Fork（almanac ALMNC-54.14）：整批標記舊筆記。id 由路徑決定，已經標過的跳過（on conflict do nothing），
 * 所以重跑不會重複；一次寫 50 列，上千則不必一列一列來回。回傳實際新增的筆數。
 */
export async function insertLegacyNoteSources(sources: readonly Source[]): Promise<number> {
  await initV3SourceDb()
  const db = await getDb()
  // Fork（almanac ALMNC-69.4）：已遷移成 S 編號的舊筆記，src_legacy:<路徑> 存在 legacy_id；on conflict(id) 擋不到，先濾掉。
  const migrated = new Set((await db.select<Array<{ legacyId: string }>>(
    'select legacy_id as legacyId from sources where kind = $1 and legacy_id is not null',
    [LEGACY_NOTE_KIND]
  )).map(row => row.legacyId))
  const fresh = sources.filter(source => !migrated.has(source.id))
  let added = 0
  for (let start = 0; start < fresh.length; start += 50) {
    const chunk = fresh.slice(start, start + 50)
    const values: (string | number | null)[] = []
    const tuples = chunk.map((source, row) => {
      const fields = sourceToValues(source)
      values.push(...fields)
      return `(${fields.map((_, col) => `$${row * fields.length + col + 1}`).join(', ')})`
    })
    const result = await db.execute(
      `insert into sources
         (id, source_type, kind, content, origin, collected_at, collector, status, status_changed_at,
          version, previous_id, locked_at, archived_at, created_at, updated_at, is_journal)
       values ${tuples.join(', ')}
       on conflict(id) do nothing`,
      values
    )
    added += Number(result.rowsAffected ?? 0)
  }
  return added
}

export async function addSource(input: Omit<NewSourceInput, 'id'> & { id?: string }, now = Date.now()): Promise<Source> {
  await initV3SourceDb()
  const source = createSource({ ...input, id: input.id ?? newSourceId() }, now)
  await insertSource(source)
  return source
}

/**
 * Fork（almanac ALMNC-57）：匯入的資料源（Email、RSS、會議逐字稿）用由原始識別決定的 id（src_email:<Message-ID> 等），
 * 已經有同一個 id 就跳過（on conflict do nothing），回傳 undefined；同一封信、同一篇文章再匯入不會重複。
 */
export async function addSourceIfAbsent(input: NewSourceInput, now = Date.now()): Promise<Source | undefined> {
  await initV3SourceDb()
  // Fork（almanac ALMNC-69.4）：同一個原始識別在遷移後存在 legacy_id，on conflict(id) 擋不到，先查。
  if (await sourceKeyExists(input.id)) return undefined
  const source = createSource(input, now)
  const db = await getDb()
  const result = await db.execute(
    `insert into sources
       (id, source_type, kind, content, origin, collected_at, collector, status, status_changed_at,
        version, previous_id, locked_at, archived_at, created_at, updated_at, is_journal)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     on conflict(id) do nothing`,
    sourceToValues(source)
  )
  return Number(result.rowsAffected ?? 0) > 0 ? source : undefined
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

/** Fork（almanac ALMNC-69.3）：貼上或拿掉日誌標籤（Scott 直接生效，或接受指揮官的「判斷為日誌」）。 */
export async function setSourceJournal(id: string, journal: boolean, now = Date.now()): Promise<Source> {
  const current = await requireSource(id)
  const next = setJournalTag(current, journal, now)
  if (next !== current) await updateSource(next)
  return next
}

/** 修改原始內容：草稿原地改；已送出則新增一列新版本，舊列不動。 */
export async function editSource(id: string, content: string, now = Date.now()): Promise<SourceEditResult> {
  const result = editSourceContent(await requireSource(id), content, now, newSourceId())
  if (result.kind === 'updated') await updateSource(result.source)
  else await insertSource(result.source)
  return result
}

/** 封存不採用滿 30 天的資料源，回傳這次封存的 id。只設 archived_at，不刪除。 */
export async function archiveDueRejectedSources(now = Date.now()): Promise<string[]> {
  await initV3SourceDb()
  return sweepRejectedSources({
    now: () => now,
    listRejected: async () => {
      const db = await getDb()
      const rows = await db.select<SourceRow[]>(`select ${SOURCE_COLUMNS} from sources where status = 'rejected' and archived_at is null`)
      return rows.map(sourceFromRow)
    },
    save: updateSource,
  })
}

/** 搜尋資料源（含封存的不採用資料源）；每條版本鏈只留最新一版。 */
export async function searchSourcesByText(query: string, limit = 200): Promise<Source[]> {
  const found = searchSources(await listSources({ includeArchived: true, limit: 5000 }), query)
  return latestVersions(found).slice(0, limit)
}

// ── 產出連結 ────────────────────────────────────────────────

export async function addSourceOutput(sourceId: string, targetType: OutputTargetType, targetRef: string, now = Date.now()): Promise<void> {
  await initV3SourceDb()
  const db = await getDb()
  // Fork（almanac ALMNC-69.4）：呼叫端還拿著舊 id（例如遷移前就排著的提案）時，連結記在現在的 S 編號上。
  const id = await currentSourceId(sourceId)
  await db.execute(
    `insert into source_outputs (source_id, target_type, target_ref, created_at)
     values ($1, $2, $3, $4)
     on conflict(source_id, target_type, target_ref) do nothing`,
    [id, targetType, targetRef, now]
  )
}

/**
 * 筆記搬移或改名時，把連結改指到新路徑。Fork（almanac ALMNC-69.4）：已改存 N 編號的連結不用動，
 * 但系統索引記的路徑要跟著改，編號才解析得回來。
 */
export async function renameNoteOutputs(fromPath: string, toPath: string): Promise<void> {
  await initV3SourceDb()
  const db = await getDb()
  await db.execute(
    `update or ignore source_outputs set target_ref = $2 where target_type = 'note' and target_ref = $1`,
    [fromPath, toPath]
  )
  await db.execute(
    "update id_index set path = $2, last_name = $3, updated_at = $4 where kind = 'N' and path = $1",
    [fromPath, toPath, lastNameOf(toPath), Date.now()]
  )
}

export async function listOutputsOfSource(sourceId: string): Promise<SourceOutput[]> {
  await initV3SourceDb()
  const db = await getDb()
  const rows = await db.select<SourceOutputRow[]>(`${OUTPUT_SELECT} where o.source_id = $1 order by o.created_at`, [sourceId])
  return rows.map(sourceOutputFromRow)
}

/**
 * 指向某個目標的連結。Fork（almanac ALMNC-69.4）：筆記同時比對路徑（舊資料）與系統索引裡這個路徑的 N 編號（遷移後）；
 * 索引沒有這個路徑就只比對路徑（降級，不會丟錯）。
 */
export async function listOutputsToTarget(targetType: OutputTargetType, targetRef: string): Promise<SourceOutput[]> {
  await initV3SourceDb()
  const db = await getDb()
  const rows = targetType === 'note'
    ? await db.select<SourceOutputRow[]>(
      `${OUTPUT_SELECT} where o.target_type = 'note'
         and (o.target_ref = $1 or o.target_ref in (select id from id_index where kind = 'N' and path = $1))
       order by o.created_at`,
      [targetRef]
    )
    : await db.select<SourceOutputRow[]>(`${OUTPUT_SELECT} where o.target_type = $1 and o.target_ref = $2 order by o.created_at`, [targetType, targetRef])
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

/**
 * Fork（almanac ALMNC-54.10）：刪除擷取失敗、還沒送出的外部擷取（卡片上的「刪除」）。條件見 canDeleteUnsent；
 * 不符合就丟錯，不會刪到已送出或有產出的資料源。
 */
export async function deleteUnsentSource(id: string): Promise<void> {
  const source = await requireSource(id)
  const outputs = await listOutputsOfSource(source.id)
  if (!canDeleteUnsent(source, outputs.length)) throw new Error('只有還沒送出、沒有產出的外部擷取可以刪除')
  const { recordDbTrash } = await import('@/lib/trash/runtime')
  await recordDbTrash({
    entityType: 'source',
    entityId: source.id,
    title: source.content.trim().slice(0, 80) || source.origin || source.id,
    deletedBy: 'scott',
    actorRole: 'scott',
    source: 'source-delete',
    metadata: { source },
  })
  const db = await getDb()
  await db.execute('delete from sources where id = $1', [source.id])
}

/** Restore a soft-trashed unsent source from its stored snapshot if absent. */
export async function restoreDeletedSource(source: Source): Promise<void> {
  await initV3SourceDb()
  const db = await getDb()
  await db.execute(
    `insert into sources
       (id, source_type, kind, content, origin, collected_at, collector, status, status_changed_at,
        version, previous_id, locked_at, archived_at, created_at, updated_at, is_journal)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     on conflict(id) do nothing`,
    sourceToValues(source)
  )
}

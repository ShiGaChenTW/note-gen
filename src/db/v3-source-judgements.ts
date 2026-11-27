// Fork（almanac ALMNC-54.10）：外部擷取資料源的初步判斷（R1），另開一張表 source_judgements（note.db），不動 sources 表的欄位。
// 新增表是純加法的升級：舊資料沒有判斷，卡片照樣出現（AC#4）。判斷規則在 src/lib/workbench/judgement.ts。
import { getDb } from './index'
import type { JudgementStatus, SourceJudgement } from '@/lib/workbench/judgement'

interface JudgementRow {
  sourceId: string
  status: string
  type: string | null
  suggestion: string | null
  model: string | null
  error: string | null
  followSuggestion: number
  createdAt: number
  updatedAt: number
}

const COLUMNS = `source_id as sourceId, status, type, suggestion, model, error, follow_suggestion as followSuggestion,
  created_at as createdAt, updated_at as updatedAt`

const STATUSES: readonly JudgementStatus[] = ['ready', 'unavailable', 'capture_failed']

let initialized: Promise<void> | null = null

/** Fork（almanac ALMNC-85.2）：資料源群組寫入後，開了 V3 同步就排一次 almanac 同步。 */
function changed(): void {
  void import('@/lib/almanac-sync/notify').then(({ notifyAlmanacLocalChange }) => notifyAlmanacLocalChange('source-judgements')).catch(() => undefined)
}

export function initSourceJudgementDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists source_judgements (
          source_id text primary key,
          status text not null,
          type text,
          suggestion text,
          model text,
          error text,
          follow_suggestion integer not null default 0,
          created_at integer not null,
          updated_at integer not null
        )
      `)
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

function fromRow(row: JudgementRow): SourceJudgement | undefined {
  if (!(STATUSES as readonly string[]).includes(row.status)) return undefined
  return {
    sourceId: row.sourceId,
    status: row.status as JudgementStatus,
    ...(row.type ? { type: row.type } : {}),
    ...(row.suggestion ? { suggestion: row.suggestion } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.error ? { error: row.error } : {}),
    followSuggestion: Boolean(row.followSuggestion),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function saveSourceJudgement(judgement: SourceJudgement): Promise<void> {
  await initSourceJudgementDb()
  const db = await getDb()
  await db.execute(
    `insert into source_judgements (source_id, status, type, suggestion, model, error, follow_suggestion, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict(source_id) do update set status = excluded.status, type = excluded.type, suggestion = excluded.suggestion,
       model = excluded.model, error = excluded.error, follow_suggestion = excluded.follow_suggestion, updated_at = excluded.updated_at`,
    [
      judgement.sourceId, judgement.status, judgement.type ?? null, judgement.suggestion ?? null, judgement.model ?? null,
      judgement.error ? Array.from(judgement.error).slice(0, 200).join('') : null, judgement.followSuggestion ? 1 : 0,
      judgement.createdAt, judgement.updatedAt,
    ],
  )
  changed()
}

export async function getSourceJudgement(sourceId: string): Promise<SourceJudgement | undefined> {
  await initSourceJudgementDb()
  const db = await getDb()
  const rows = await db.select<JudgementRow[]>(`select ${COLUMNS} from source_judgements where source_id = $1`, [sourceId])
  return rows[0] ? fromRow(rows[0]) : undefined
}

export async function listSourceJudgements(): Promise<Map<string, SourceJudgement>> {
  await initSourceJudgementDb()
  const db = await getDb()
  const rows = await db.select<JudgementRow[]>(`select ${COLUMNS} from source_judgements`)
  const map = new Map<string, SourceJudgement>()
  for (const row of rows) {
    const judgement = fromRow(row)
    if (judgement) map.set(judgement.sourceId, judgement)
  }
  return map
}

/** 「照建議處理」：記下 Scott 同意照建議，指揮官分析時會讀到。 */
export async function setFollowSuggestion(sourceId: string, on: boolean, now = Date.now()): Promise<void> {
  await initSourceJudgementDb()
  const db = await getDb()
  await db.execute('update source_judgements set follow_suggestion = $2, updated_at = $3 where source_id = $1', [sourceId, on ? 1 : 0, now])
  changed()
}

export async function deleteSourceJudgement(sourceId: string): Promise<void> {
  await initSourceJudgementDb()
  const db = await getDb()
  await db.execute('delete from source_judgements where source_id = $1', [sourceId])
}

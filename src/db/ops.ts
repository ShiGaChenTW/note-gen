// Fork（almanac ALMNC-69.9）：ops 表（note.db）——以身分編號描述、可反向執行的操作，7 天內可復原。
// 新表，用 create table if not exists 建立（同 id_index 的延遲初始化），對舊資料庫安全、可重跑。
// payload／inverse／base_versions 存 JSON；流程與檢查在 src/lib/ops。
// 以工作區隔離（同 organize_undo）：路徑是筆記庫相對路徑，換了筆記庫就看不到、也不能復原別的筆記庫的操作。
import { getDb } from './index'
import type { OpsStore } from '@/lib/ops/service'
import { OP_KINDS, type OpActor, type OpKind, type OpRecord, type OpSpec } from '@/lib/ops/types'

interface OpRow {
  id: string
  seq: number
  at: number
  actor: string
  actorId: string | null
  kind: string
  payload: string
  inverse: string
  proposalId: string | null
  batchId: string | null
  baseVersions: string
  undoneAt: number | null
}

const COLUMNS = `id, rowid as seq, at, actor, actor_id as actorId, kind, payload, inverse, proposal_id as proposalId,
  batch_id as batchId, base_versions as baseVersions, undone_at as undoneAt`

let initialized: Promise<void> | null = null

export function initOpsDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists ops (
          id text primary key,
          workspace text not null default '',
          at integer not null,
          actor text not null,
          actor_id text,
          kind text not null,
          payload text not null,
          inverse text not null,
          proposal_id text,
          batch_id text,
          base_versions text not null default '{}',
          undone_at integer
        )
      `)
      await db.execute('create index if not exists idx_ops_at on ops(at)')
      await db.execute('create index if not exists idx_ops_batch on ops(batch_id)')
      await db.execute('create index if not exists idx_ops_workspace_at on ops(workspace, at)')
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

function parse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/** 資料列 → 紀錄；種類不認得（之後的版本新增的）就略過。 */
export function opFromRow(row: OpRow): OpRecord | null {
  if (!OP_KINDS.includes(row.kind as OpKind)) return null
  const payload = parse<OpSpec | null>(row.payload, null)
  const inverse = parse<OpSpec | null>(row.inverse, null)
  if (!payload || !inverse) return null
  return {
    id: row.id,
    seq: row.seq,
    at: row.at,
    actor: row.actor as OpActor,
    ...(row.actorId ? { actorId: row.actorId } : {}),
    kind: row.kind as OpKind,
    payload,
    inverse,
    ...(row.proposalId ? { proposalId: row.proposalId } : {}),
    ...(row.batchId ? { batchId: row.batchId } : {}),
    baseVersions: parse<Record<string, string | null>>(row.baseVersions, {}),
    undoneAt: row.undoneAt ?? null,
  }
}

/** 目前的筆記庫（工作區）路徑。 */
async function currentWorkspace(): Promise<string> {
  const { default: useSettingStore } = await import('@/stores/setting')
  return useSettingStore.getState().workspacePath ?? ''
}

/** ops 表的存取；workspace 決定看得到哪些紀錄（App 用目前的筆記庫，測試給固定值）。 */
export function createOpsDbStore(workspace: () => Promise<string> | string = currentWorkspace): OpsStore {
  async function select(where: string, values: unknown[]): Promise<OpRecord[]> {
    await initOpsDb()
    const db = await getDb()
    const scope = await workspace()
    const rows = await db.select<OpRow[]>(
      `select ${COLUMNS} from ops where workspace = $${values.length + 1} and (${where}) order by at, rowid`,
      [...values, scope],
    )
    return rows.flatMap(row => opFromRow(row) ?? [])
  }
  const placeholders = (count: number, offset = 0) => Array.from({ length: count }, (_, index) => `$${index + offset + 1}`).join(', ')

  return {
    insert: async records => {
      await initOpsDb()
      const db = await getDb()
      const scope = await workspace()
      for (const record of records) {
        await db.execute(
          `insert into ops (id, workspace, at, actor, actor_id, kind, payload, inverse, proposal_id, batch_id, base_versions, undone_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [record.id, scope, record.at, record.actor, record.actorId ?? null, record.kind, JSON.stringify(record.payload), JSON.stringify(record.inverse),
            record.proposalId ?? null, record.batchId ?? null, JSON.stringify(record.baseVersions), record.undoneAt],
        )
      }
      if (!records.length) return []
      return select(`id in (${placeholders(records.length)})`, records.map(record => record.id))
    },
    get: async id => (await select('id = $1', [id]))[0] ?? null,
    listBatch: batchId => select('batch_id = $1', [batchId]),
    getMany: async ids => ids.length ? select(`id in (${placeholders(ids.length)})`, [...ids]) : [],
    markUndone: async (ids, at) => {
      if (!ids.length) return
      await initOpsDb()
      const db = await getDb()
      await db.execute(`update ops set undone_at = $1 where id in (${placeholders(ids.length, 1)})`, [at, ...ids])
    },
    // 7 天外的紀錄不分工作區都清掉（不再提供復原）。
    prune: async before => {
      await initOpsDb()
      const db = await getDb()
      const result = await db.execute('delete from ops where at < $1', [before])
      return result.rowsAffected ?? 0
    },
  }
}

export const opsStore: OpsStore = createOpsDbStore()

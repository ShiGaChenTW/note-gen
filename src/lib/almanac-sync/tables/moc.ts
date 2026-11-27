// Fork（almanac ALMNC-85.4）：MOC 群組的 V3 同步表（設計 2.11、2.12、2.14、2.15；M7）。全部放筆記庫層（.almanac/v3/），
// 本機的 workspace 欄位不傳，寫入本機時填目前的筆記庫（設計 1.6）。ops 已在 85.3 做完（tables/ops.ts），這裡不重做。
//
// 2.11 moc-baselines.json（MOC 上次已知狀態）：鍵 mocId（沒有 M 編號的用 path:<路徑>），v = { path, mocId, content, contentHash, updatedAt }，
//   較晚的 updatedAt 贏。path＝'' 那一列（已建過基準的記號）不傳。
//   收進來的基準**不直接蓋掉本機的 moc_snapshots**：B 台的 MOC 檔可能還沒同步到，這時把上次已知狀態改成新內容，
//   reconcile 會以為 Scott 把 MOC 改回舊的。所以另存在 almanac_moc_remote_baselines，reconcile 看到檔案內容等於這份基準時才採用
//   （第二層：筆記庫放在 iCloud、Obsidian Sync 這類 App 外同步時用；第一層是內建同步寫檔時記成 App 寫入，見 moc/app-writes）。
// 2.12 moc-positions.json：鍵 mocId，A 型較晚的贏（M7 補的 updated_at）。
// 2.14 proposal-experts.json：鍵 batch_id，removed_at 取最早的非空值；agent_id 照夥伴別名改寫；30 天後各台自己清，不發墓碑。
// 2.15 scott-pins.json：鍵 pin_key，同鍵取 pinned_at 較晚的；過期（90 天）的不上傳、各台自己清，不發墓碑。
import { hashString } from '../hash'
import { maxNumber, minNonNull } from '../merge'
import { resolveAlias } from '../aliases'
import type { AlmanacSqlDb, SqlValue } from '../sql'
import { MOC_SNAPSHOTS_SCHEMA, PROPOSAL_EXPERTS_SCHEMA, SCOTT_PINS_SCHEMA, ensureMocPositionsSchema } from '@/lib/moc/schema'
import { SCOTT_PIN_TTL_MS } from '@/lib/moc/scott-pins'
import { UNDO_WINDOW_MS } from '@/lib/ops/types'
import { AGENT_ALIAS_TABLE } from './crew'
import type { AlmanacRowsTable, LocalSyncRow } from './registry'

export const MOC_BASELINES_SYNC_TABLE = 'moc-baselines'
export const MOC_POSITIONS_SYNC_TABLE = 'moc-positions'
export const SCOTT_PINS_SYNC_TABLE = 'scott-pins'
export const PROPOSAL_EXPERTS_SYNC_TABLE = 'proposal-experts'

const REMOTE_BASELINES_SCHEMA = `
  create table if not exists almanac_moc_remote_baselines (
    workspace text not null default '',
    sync_key text not null,
    path text not null default '',
    moc_id text,
    content text not null default '',
    content_hash text not null default '',
    updated_at integer not null default 0,
    deleted_at integer,
    primary key (workspace, sync_key)
  )
`

const ready = new WeakMap<AlmanacSqlDb, Promise<void>>()

/** 四張 MOC 表＋收進來的基準（純加法，可重跑）。 */
export function ensureMocSyncSchema(db: AlmanacSqlDb): Promise<void> {
  let pending = ready.get(db)
  if (!pending) {
    pending = (async () => {
      await db.execute(MOC_SNAPSHOTS_SCHEMA)
      await ensureMocPositionsSchema(db)
      await db.execute(SCOTT_PINS_SCHEMA)
      await db.execute(PROPOSAL_EXPERTS_SCHEMA)
      await db.execute(REMOTE_BASELINES_SCHEMA)
    })().catch(error => {
      ready.delete(db)
      throw error
    })
    ready.set(db, pending)
  }
  return pending
}

// ---------- 2.11 MOC 上次已知狀態 ----------

export interface MocBaselineSyncValue extends Record<string, unknown> {
  path: string
  mocId: string | null
  content: string
  contentHash: string
  updatedAt: number
}

export const mocBaselineKey = (mocId: string | null | undefined, path: string) => (mocId ? mocId : `path:${path}`)
export const mocContentHash = (content: string) => hashString(content)

/** 收進來、還沒被 reconcile 採用的基準（reconcile 第二層用）。 */
export interface SyncedMocBaseline {
  path: string
  mocId?: string
  content: string
}

interface RemoteBaselineRow {
  syncKey: string
  path: string
  mocId: string | null
  content: string
  contentHash: string
  updatedAt: number
  deletedAt: number | null
}

async function loadRemoteBaselines(db: AlmanacSqlDb, workspace: string): Promise<Map<string, RemoteBaselineRow>> {
  const rows = await db.select<RemoteBaselineRow[]>(
    `select sync_key as syncKey, path, moc_id as mocId, content, content_hash as contentHash, updated_at as updatedAt, deleted_at as deletedAt
     from almanac_moc_remote_baselines where workspace = $1`,
    [workspace],
  )
  return new Map(rows.map(row => [row.syncKey, { ...row, updatedAt: Number(row.updatedAt), deletedAt: row.deletedAt === null || row.deletedAt === undefined ? null : Number(row.deletedAt) }]))
}

/** reconcile 第二層：別台傳來的 MOC 基準（已刪除的不算）。資料庫還沒建這張表時回傳空陣列。 */
export async function listSyncedMocBaselines(db: AlmanacSqlDb, workspace: string): Promise<SyncedMocBaseline[]> {
  await ensureMocSyncSchema(db)
  return [...(await loadRemoteBaselines(db, workspace)).values()]
    .filter(row => row.deletedAt === null && row.path)
    .map(row => ({ path: row.path, ...(row.mocId ? { mocId: row.mocId } : {}), content: row.content }))
}

function remoteValue(row: RemoteBaselineRow): MocBaselineSyncValue {
  return { path: row.path, mocId: row.mocId ?? null, content: row.content, contentHash: row.contentHash || mocContentHash(row.content), updatedAt: row.updatedAt }
}

export function createMocBaselinesTable(): AlmanacRowsTable<MocBaselineSyncValue> {
  return {
    kind: 'rows',
    name: MOC_BASELINES_SYNC_TABLE,
    layer: 'library',
    storage: { type: 'file', path: 'moc-baselines.json' },
    rules: { updatedAt: maxNumber() },
    async read({ db, libraryScope }) {
      await ensureMocSyncSchema(db)
      const local = await db.select<Array<{ path: string; mocId: string | null; content: string; updatedAt: number }>>(
        `select path, moc_id as mocId, content, updated_at as updatedAt from moc_snapshots where workspace = $1 and path != '' order by updated_at`,
        [libraryScope],
      )
      const remote = await loadRemoteBaselines(db, libraryScope)
      const rows: Record<string, LocalSyncRow<MocBaselineSyncValue>> = {}
      // 同一個 M 編號留最新那列（依 updated_at 排序後後蓋前）。
      for (const row of local) {
        const key = mocBaselineKey(row.mocId, row.path)
        const updatedAt = Number(row.updatedAt)
        const synced = remote.get(key)
        // 別台刪了、這台之後也沒再改 → 不算這台的資料（不然會一直推回去）。
        if (synced?.deletedAt !== null && synced?.deletedAt !== undefined && updatedAt <= synced.deletedAt) continue
        if (synced && synced.deletedAt === null && (synced.content === row.content || synced.updatedAt > updatedAt)) {
          // 內容跟收進來的一樣（這台已採用）→ 沿用那份（含時間），不重傳；收進來的較新（這台的檔還沒到）→ 先不推舊的。
          rows[key] = { v: remoteValue(synced), u: synced.updatedAt }
          continue
        }
        rows[key] = {
          v: { path: row.path, mocId: row.mocId ?? null, content: row.content, contentHash: mocContentHash(row.content), updatedAt },
          u: updatedAt,
        }
      }
      // 收進來、這台還沒有的 MOC 也算這台的（否則會被當成「這台刪了」而發墓碑）。
      for (const [key, synced] of remote) {
        if (rows[key] || synced.deletedAt !== null) continue
        rows[key] = { v: remoteValue(synced), u: synced.updatedAt }
      }
      return rows
    },
    async apply({ db, libraryScope, now }, change) {
      await ensureMocSyncSchema(db)
      for (const [key, value] of Object.entries(change.upserts)) {
        await db.execute(
          `insert into almanac_moc_remote_baselines (workspace, sync_key, path, moc_id, content, content_hash, updated_at, deleted_at)
           values ($1, $2, $3, $4, $5, $6, $7, null)
           on conflict(workspace, sync_key) do update set path = excluded.path, moc_id = excluded.moc_id, content = excluded.content,
             content_hash = excluded.content_hash, updated_at = excluded.updated_at, deleted_at = null`,
          [libraryScope, key, value.path, value.mocId ?? null, value.content, value.contentHash || mocContentHash(value.content), Number(value.updatedAt) || 0],
        )
      }
      for (const key of change.deletes) {
        await db.execute(
          `insert into almanac_moc_remote_baselines (workspace, sync_key, deleted_at) values ($1, $2, $3)
           on conflict(workspace, sync_key) do update set deleted_at = excluded.deleted_at`,
          [libraryScope, key, now()],
        )
      }
    },
  }
}

// ---------- 2.12 MOC 版面位置 ----------

export interface MocPositionsSyncValue extends Record<string, unknown> {
  positions: unknown
  updatedAt: number
}

function parseJson(text: string, fallback: unknown): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

export function createMocPositionsTable(): AlmanacRowsTable<MocPositionsSyncValue> {
  return {
    kind: 'rows',
    name: MOC_POSITIONS_SYNC_TABLE,
    layer: 'library',
    storage: { type: 'file', path: 'moc-positions.json' },
    rules: { updatedAt: maxNumber() },
    async read({ db, libraryScope }) {
      await ensureMocSyncSchema(db)
      const rows = await db.select<Array<{ mocId: string; positions: string; updatedAt: number }>>(
        'select moc_id as mocId, positions, updated_at as updatedAt from moc_positions where workspace = $1',
        [libraryScope],
      )
      return Object.fromEntries(rows.map(row => [row.mocId, {
        v: { positions: parseJson(row.positions, null), updatedAt: Number(row.updatedAt) || 0 },
        u: Number(row.updatedAt) || 0,
      }]))
    },
    async apply({ db, libraryScope }, change) {
      await ensureMocSyncSchema(db)
      for (const [mocId, value] of Object.entries(change.upserts)) {
        await db.execute(
          `insert into moc_positions (workspace, moc_id, positions, updated_at) values ($1, $2, $3, $4)
           on conflict(workspace, moc_id) do update set positions = excluded.positions, updated_at = excluded.updated_at`,
          [libraryScope, mocId, JSON.stringify(value.positions ?? null), Number(value.updatedAt) || 0],
        )
      }
      for (const mocId of change.deletes) {
        await db.execute('delete from moc_positions where workspace = $1 and moc_id = $2', [libraryScope, mocId])
      }
    },
  }
}

// ---------- 2.15 Scott 指定 ----------

export interface ScottPinSyncValue extends Record<string, unknown> {
  kind: string
  mocId: string | null
  mocPath: string
  mocName: string
  noteId: string | null
  notePath: string | null
  chapterId: string | null
  block: string | null
  opId: string | null
  pinnedAt: number
}

export const isScottPinRetained = (pinnedAt: number, now: number) => Number(pinnedAt) > now - SCOTT_PIN_TTL_MS

export function createScottPinsTable(): AlmanacRowsTable<ScottPinSyncValue> {
  return {
    kind: 'rows',
    name: SCOTT_PINS_SYNC_TABLE,
    layer: 'library',
    storage: { type: 'file', path: 'scott-pins.json' },
    rules: { pinnedAt: maxNumber() },
    retain: (_key, value, now) => isScottPinRetained(Number(value.pinnedAt), now),
    async read({ db, libraryScope }) {
      await ensureMocSyncSchema(db)
      const rows = await db.select<Array<ScottPinSyncValue & { pinKey: string }>>(
        `select pin_key as pinKey, kind, moc_id as mocId, moc_path as mocPath, moc_name as mocName, note_id as noteId, note_path as notePath,
          chapter_id as chapterId, block, op_id as opId, pinned_at as pinnedAt from scott_pins where workspace = $1`,
        [libraryScope],
      )
      const out: Record<string, LocalSyncRow<ScottPinSyncValue>> = {}
      for (const { pinKey, ...row } of rows) {
        const pinnedAt = Number(row.pinnedAt)
        out[pinKey] = {
          v: {
            kind: row.kind, mocId: row.mocId ?? null, mocPath: row.mocPath ?? '', mocName: row.mocName ?? '', noteId: row.noteId ?? null,
            notePath: row.notePath ?? null, chapterId: row.chapterId ?? null, block: row.block ?? null, opId: row.opId ?? null, pinnedAt,
          },
          u: pinnedAt,
        }
      }
      return out
    },
    async apply({ db, libraryScope }, change) {
      await ensureMocSyncSchema(db)
      for (const [pinKey, pin] of Object.entries(change.upserts)) {
        const values: SqlValue[] = [libraryScope, pinKey, pin.kind, pin.mocId ?? null, pin.mocPath ?? '', pin.mocName ?? '', pin.noteId ?? null,
          pin.notePath ?? null, pin.chapterId ?? null, pin.block ?? null, pin.opId ?? null, Number(pin.pinnedAt)]
        await db.execute(
          `insert into scott_pins (workspace, pin_key, kind, moc_id, moc_path, moc_name, note_id, note_path, chapter_id, block, op_id, pinned_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            on conflict(workspace, pin_key) do update set kind = excluded.kind, moc_id = excluded.moc_id, moc_path = excluded.moc_path,
              moc_name = excluded.moc_name, note_id = excluded.note_id, note_path = excluded.note_path, chapter_id = excluded.chapter_id,
              block = excluded.block, op_id = excluded.op_id, pinned_at = max(scott_pins.pinned_at, excluded.pinned_at)`,
          values,
        )
      }
      for (const pinKey of change.deletes) await db.execute('delete from scott_pins where workspace = $1 and pin_key = $2', [libraryScope, pinKey])
    },
  }
}

// ---------- 2.14 提案建立的專家 ----------

export interface ProposalExpertSyncValue extends Record<string, unknown> {
  proposalId: string | null
  agentId: string
  name: string
  domain: string
  at: number
  removedAt: number | null
}

export const isProposalExpertRetained = (at: number, now: number) => Number(at) >= now - UNDO_WINDOW_MS

export function createProposalExpertsTable(): AlmanacRowsTable<ProposalExpertSyncValue> {
  return {
    kind: 'rows',
    name: PROPOSAL_EXPERTS_SYNC_TABLE,
    layer: 'library',
    storage: { type: 'file', path: 'proposal-experts.json' },
    rules: { removedAt: minNonNull() },
    retain: (_key, value, now) => isProposalExpertRetained(Number(value.at), now),
    async read({ db }) {
      await ensureMocSyncSchema(db)
      const rows = await db.select<Array<{ batchId: string; proposalId: string | null; agentId: string; name: string; domain: string; at: number; removedAt: number | null }>>(
        'select batch_id as batchId, proposal_id as proposalId, agent_id as agentId, name, domain, created_at as at, removed_at as removedAt from proposal_experts',
      )
      const out: Record<string, LocalSyncRow<ProposalExpertSyncValue>> = {}
      for (const row of rows) {
        const at = Number(row.at)
        const removedAt = row.removedAt === null || row.removedAt === undefined ? null : Number(row.removedAt)
        out[row.batchId] = {
          // 傳出時也換成正式 id：這台剛併過別名，另一台可能還不知道舊 id（設計 1.3）。
          v: { proposalId: row.proposalId ?? null, agentId: await resolveAlias(db, AGENT_ALIAS_TABLE, row.agentId), name: row.name, domain: row.domain, at, removedAt },
          u: Math.max(at, removedAt ?? 0),
        }
      }
      return out
    },
    async apply({ db }, change) {
      await ensureMocSyncSchema(db)
      for (const [batchId, expert] of Object.entries(change.upserts)) {
        const agentId = await resolveAlias(db, AGENT_ALIAS_TABLE, String(expert.agentId))
        await db.execute(
          `insert into proposal_experts (batch_id, proposal_id, agent_id, name, domain, created_at, removed_at) values ($1, $2, $3, $4, $5, $6, $7)
           on conflict(batch_id) do update set proposal_id = excluded.proposal_id, agent_id = excluded.agent_id, name = excluded.name,
             domain = excluded.domain, created_at = excluded.created_at, removed_at = excluded.removed_at`,
          [batchId, expert.proposalId ?? null, agentId, expert.name, expert.domain, Number(expert.at), expert.removedAt ?? null],
        )
      }
      for (const batchId of change.deletes) await db.execute('delete from proposal_experts where batch_id = $1', [batchId])
    },
  }
}

/** 85.4 的四張表，註冊順序：先 MOC 基準與版面，再 Scott 指定、提案建立的專家。 */
export function createMocTables(): AlmanacRowsTable[] {
  return [createMocBaselinesTable(), createMocPositionsTable(), createScottPinsTable(), createProposalExpertsTable()] as AlmanacRowsTable[]
}

// Fork（almanac ALMNC-85.2）：待決定提案（collectItems）、提案紀錄（proposalTrail）、每週 MOC 整理卡（almanacWeeklyMocCards）、
// 待清理的衝突觀察（almanacCleanupPending）的同步表（設計 2.3、2.4）。
// 存放 .data/almanac/proposals.json，四區用同步鍵前綴分開：item:<項目 id>、trail:<工作台項目 key>、weekly:<卡片 key>、cleanup:<queuedKey>。
// 四個 store key 都從設定同步移出（storeKeys，M9）。
//
// 合併：
// - 提案 status 只往前（ok 已接受＞no 已放棄＞wait）；卡片上改的標題、資料夾等其他欄位較晚的贏。
// - trail：discussion 較晚的 at 贏；supersededBy 先有值的保留（被取代就不再改回）。
// - 每週卡、衝突觀察：整筆較晚的贏；確認掉的觀察發墓碑，另一台跟著拿掉。
//
// 單機欄位：
// - 提案、trail 的本機對話編號 conversationId 傳出時換成 conversationSyncId（M2），收進來時查 conversations.syncId 換回；
//   查不到（對話同步關著或還沒到）就只留 conversationSyncId。
// - recordId（Inbox 記錄的本機編號）不傳；收進來時保留本機原本的值。
// - sourceIds 照資料源同步鍵解析（別名表換成正式 id），讓提案指向的資料源在另一台找得到（85.2 #3）。
//
// 項目整筆清除：處理完 3 天後各台自己清（DECIDED_KEEP_MS）。清掉時會發墓碑，但收到墓碑的那台如果這個項目還有等你決定的提案，
// 不刪、下一輪推回去（設計 2.3「一台先清不會讓另一台還在等的提案消失」）。
import type { FieldMergeContext, FieldRule } from '../merge'
import { loadBases } from '../base'
import { hashRowFields } from '../merge'
import { hashValue } from '../hash'
import { resolveAlias } from '../aliases'
import type { AlmanacSqlDb } from '../sql'
import { SOURCE_ALIAS_TABLE } from './sources'
import type { AlmanacRowsTable, LocalSyncRow } from './registry'

export const PROPOSALS_SYNC_TABLE = 'proposals'
export const PROPOSAL_STORE_KEYS = ['collectItems', 'proposalTrail', 'almanacWeeklyMocCards', 'almanacCleanupPending']

type ProposalStatus = 'wait' | 'ok' | 'no'

/** 收集項目裡的一則提案（store.json collectItems 的格式，欄位多半照原樣傳）。 */
export interface SyncProposal extends Record<string, unknown> {
  id: string
  status: ProposalStatus
  conversationId?: number
  conversationSyncId?: string
  sourceIds?: string[]
  result?: { path: string }
}

export interface SyncCollectItem extends Record<string, unknown> {
  id: string
  createdAt: number
  recordId?: number
  proposals: SyncProposal[]
}

export interface SyncTrailEntry {
  conversationId?: number
  conversationSyncId?: string
  discussion?: { note: string; at: number }
  supersededBy?: string
}

export interface ProposalsSnapshot {
  items: SyncCollectItem[]
  trail: Record<string, SyncTrailEntry>
  weeklySent: string[]
  cleanup: Array<{ key: string; observation: Record<string, unknown> }>
}

export interface ProposalsChange {
  items: { upserts: SyncCollectItem[]; deletes: string[] }
  trail: { upserts: Record<string, SyncTrailEntry>; deletes: string[] }
  weekly: { add: string[]; remove: string[] }
  cleanup: { upserts: Array<{ key: string; observation: Record<string, unknown> }>; deletes: string[] }
}

/** App 裡接 useCollectStore／useProposalTrailStore 與 store.json（記憶體 store 是唯一的寫入者，設計 6 風險 6）。 */
export interface ProposalsAccess {
  load(): Promise<ProposalsSnapshot>
  apply(change: ProposalsChange): Promise<void>
}

export type ProposalsSyncValue = Record<string, unknown>

const ITEM = 'item:'
const TRAIL = 'trail:'
const WEEKLY = 'weekly:'
const CLEANUP = 'cleanup:'

// ---------- 欄位規則 ----------

const STATUS_RANK: Record<ProposalStatus, number> = { wait: 0, no: 1, ok: 2 }

/** 一則提案：status 只往前；其他欄位跟著較晚的那邊；status 贏的那邊是 ok 時，result 跟著它。 */
export function mergeProposal(local: SyncProposal, remote: SyncProposal, localIsLater: boolean): SyncProposal {
  const later = localIsLater ? local : remote
  const localRank = STATUS_RANK[local.status] ?? 0
  const remoteRank = STATUS_RANK[remote.status] ?? 0
  const statusSide = localRank === remoteRank ? later : localRank > remoteRank ? local : remote
  const merged: SyncProposal = { ...later, status: statusSide.status }
  if (statusSide.result) merged.result = statusSide.result
  else delete merged.result
  return merged
}

export function mergeProposalLists(local: SyncProposal[] | undefined, remote: SyncProposal[] | undefined, localIsLater: boolean): SyncProposal[] {
  const remoteById = new Map((remote ?? []).map(proposal => [proposal.id, proposal]))
  const out: SyncProposal[] = []
  const seen = new Set<string>()
  for (const proposal of local ?? []) {
    const other = remoteById.get(proposal.id)
    out.push(other ? mergeProposal(proposal, other, localIsLater) : proposal)
    seen.add(proposal.id)
  }
  for (const proposal of remote ?? []) if (!seen.has(proposal.id)) out.push(proposal)
  return out
}

const proposalsRule: FieldRule = {
  type: 'resolve',
  resolve: (local, remote, context: FieldMergeContext) => mergeProposalLists(local as SyncProposal[], remote as SyncProposal[], context.localIsLater),
}

const discussionRule: FieldRule = {
  type: 'resolve',
  resolve: (local, remote) => {
    const left = local as SyncTrailEntry['discussion']
    const right = remote as SyncTrailEntry['discussion']
    if (!left) return right
    if (!right) return left
    return right.at > left.at ? right : left
  },
}

const supersededByRule: FieldRule = {
  type: 'resolve',
  resolve: (local, remote) => {
    if (!local) return remote
    if (!remote) return local
    return String(local) < String(remote) ? local : remote
  },
}

// ---------- 對話編號、資料源引用 ----------

async function conversationSyncIdOf(db: AlmanacSqlDb, localId: number, cache: Map<number, string | null>): Promise<string | null> {
  if (cache.has(localId)) return cache.get(localId) ?? null
  let syncId: string | null = null
  try {
    const rows = await db.select<Array<{ syncId: string | null }>>('select syncId as syncId from conversations where id = $1', [localId])
    syncId = rows[0]?.syncId ?? null
  } catch {
    syncId = null
  }
  cache.set(localId, syncId)
  return syncId
}

async function conversationLocalIdOf(db: AlmanacSqlDb, syncId: string, cache: Map<string, number | null>): Promise<number | null> {
  if (cache.has(syncId)) return cache.get(syncId) ?? null
  let localId: number | null = null
  try {
    const rows = await db.select<Array<{ id: number }>>('select id from conversations where syncId = $1', [syncId])
    localId = rows[0] ? Number(rows[0].id) : null
  } catch {
    localId = null
  }
  cache.set(syncId, localId)
  return localId
}

async function toPortableConversation<T extends { conversationId?: number; conversationSyncId?: string }>(
  db: AlmanacSqlDb, value: T, cache: Map<number, string | null>,
): Promise<Omit<T, 'conversationId'>> {
  const { conversationId, ...rest } = value
  if (typeof conversationId !== 'number') return rest
  const syncId = await conversationSyncIdOf(db, conversationId, cache)
  return syncId ? { ...rest, conversationSyncId: syncId } : rest
}

async function fromPortableConversation<T extends { conversationId?: number; conversationSyncId?: string }>(
  db: AlmanacSqlDb, value: T, cache: Map<string, number | null>,
): Promise<T> {
  if (!value.conversationSyncId) return value
  const localId = await conversationLocalIdOf(db, value.conversationSyncId, cache)
  const next = { ...value }
  if (localId !== null) next.conversationId = localId
  else delete next.conversationId
  return next
}

/** 提案指向的資料源：別名換成正式 id（兩台各自遷移出不同 S 編號時，提案仍指得到同一則）。 */
export async function resolveProposalSourceIds(db: AlmanacSqlDb, sourceIds: readonly string[] | undefined): Promise<string[] | undefined> {
  if (!sourceIds?.length) return sourceIds ? [...sourceIds] : undefined
  const resolved: string[] = []
  for (const id of sourceIds) resolved.push(await resolveAlias(db, SOURCE_ALIAS_TABLE, id))
  return Array.from(new Set(resolved))
}

// ---------- 表 ----------

function stripUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createProposalsTable(access: ProposalsAccess): AlmanacRowsTable<ProposalsSyncValue> {
  return {
    kind: 'rows',
    name: PROPOSALS_SYNC_TABLE,
    layer: 'account',
    storage: { type: 'file', path: 'proposals.json' },
    storeKeys: PROPOSAL_STORE_KEYS,
    rules: {
      proposals: proposalsRule,
      discussion: discussionRule,
      supersededBy: supersededByRule,
      createdAt: { type: 'resolve', resolve: (local, remote) => Math.min(Number(local), Number(remote)) },
    },
    async read(context) {
      const snapshot = await access.load()
      const cache = new Map<number, string | null>()
      const values: Record<string, ProposalsSyncValue> = {}
      const stamps: Record<string, number> = {}
      for (const item of snapshot.items) {
        const { recordId: _recordId, ...rest } = item
        void _recordId
        const proposals: SyncProposal[] = []
        for (const proposal of item.proposals) {
          const portable = await toPortableConversation(context.db, proposal, cache) as SyncProposal
          // 傳出時也換成正式 id：這台剛併過別名，另一台可能不知道舊 S 編號。
          const sourceIds = await resolveProposalSourceIds(context.db, portable.sourceIds)
          proposals.push(sourceIds ? { ...portable, sourceIds } : portable)
        }
        values[`${ITEM}${item.id}`] = stripUndefined({ ...rest, proposals })
        stamps[`${ITEM}${item.id}`] = item.createdAt
      }
      for (const [key, entry] of Object.entries(snapshot.trail)) {
        values[`${TRAIL}${key}`] = stripUndefined(await toPortableConversation(context.db, entry, cache)) as Record<string, unknown>
        stamps[`${TRAIL}${key}`] = entry.discussion?.at ?? 0
      }
      for (const key of snapshot.weeklySent) values[`${WEEKLY}${key}`] = { sent: true }
      for (const { key, observation } of snapshot.cleanup) values[`${CLEANUP}${key}`] = stripUndefined({ observation })

      // 這些 store 沒有修改時間：跟上次同步的基準比，改過的列以「這次同步的時間」當修改時間（兩邊都改同一欄時，較晚同步的贏）。
      const bases = await loadBases(context.db, 'account', PROPOSALS_SYNC_TABLE)
      const now = context.now()
      const rows: Record<string, LocalSyncRow<ProposalsSyncValue>> = {}
      for (const [key, value] of Object.entries(values)) {
        const base = bases[key]
        const changed = !base || hashValue(hashRowFields(value)) !== hashValue(base.hashes)
        rows[key] = { v: value, u: changed ? now : (stamps[key] ?? 0) }
      }
      return rows
    },
    async apply(context, change) {
      const cache = new Map<string, number | null>()
      const snapshot = await access.load()
      const localItems = new Map(snapshot.items.map(item => [item.id, item]))
      const result: ProposalsChange = {
        items: { upserts: [], deletes: [] },
        trail: { upserts: {}, deletes: [] },
        weekly: { add: [], remove: [] },
        cleanup: { upserts: [], deletes: [] },
      }
      for (const [key, value] of Object.entries(change.upserts)) {
        if (key.startsWith(ITEM)) {
          const id = key.slice(ITEM.length)
          const local = localItems.get(id)
          const proposals: SyncProposal[] = []
          for (const proposal of (value.proposals as SyncProposal[] | undefined) ?? []) {
            const next = await fromPortableConversation(context.db, proposal, cache)
            const sourceIds = await resolveProposalSourceIds(context.db, next.sourceIds)
            proposals.push(sourceIds ? { ...next, sourceIds } : next)
          }
          const item = { ...value, id, proposals } as SyncCollectItem
          if (local?.recordId !== undefined) item.recordId = local.recordId
          result.items.upserts.push(item)
        } else if (key.startsWith(TRAIL)) {
          result.trail.upserts[key.slice(TRAIL.length)] = await fromPortableConversation(context.db, value as SyncTrailEntry, cache)
        } else if (key.startsWith(WEEKLY)) {
          result.weekly.add.push(key.slice(WEEKLY.length))
        } else if (key.startsWith(CLEANUP)) {
          result.cleanup.upserts.push({ key: key.slice(CLEANUP.length), observation: value.observation as Record<string, unknown> })
        }
      }
      for (const key of change.deletes) {
        if (key.startsWith(ITEM)) {
          const id = key.slice(ITEM.length)
          // 這台還有等你決定的提案：不刪（下一輪推回去）。
          if (localItems.get(id)?.proposals.some(proposal => proposal.status === 'wait')) continue
          result.items.deletes.push(id)
        } else if (key.startsWith(TRAIL)) {
          result.trail.deletes.push(key.slice(TRAIL.length))
        } else if (key.startsWith(CLEANUP)) {
          result.cleanup.deletes.push(key.slice(CLEANUP.length))
        }
        // 每週卡只會增加（送過就不再送），別台的墓碑不刪，下一輪推回去。
      }
      await access.apply(result)
    },
  }
}

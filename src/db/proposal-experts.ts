// Fork（almanac ALMNC-72）：接受「成立領域」提案時新建的專家（note.db 的 proposal_experts 表），撤回那次提案時用來問
// 「要不要一起撤回新建的專家」。專家設定與記憶本身不在 ops（ops 只管筆記庫檔案），所以另記一張小表：以那次接受的 batch 為鍵。
// 新表，create table if not exists（同 ops 表的延遲初始化），對舊資料庫安全、可重跑；超過 7 天（ops 不再能復原）的列登記時清掉。
import { executeRecordTransaction, getDb } from './index'
import type { ExpertSnapshot, ProposalExpert } from '@/lib/ops/domain-undo'
import { UNDO_WINDOW_MS } from '@/lib/ops/types'

interface Row {
  batchId: string
  proposalId: string | null
  agentId: string
  name: string
  domain: string
  at: number
  removedAt: number | null
}

const COLUMNS = 'batch_id as batchId, proposal_id as proposalId, agent_id as agentId, name, domain, created_at as at, removed_at as removedAt'

let initialized: Promise<void> | null = null

export function initProposalExpertsDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists proposal_experts (
          batch_id text primary key,
          proposal_id text,
          agent_id text not null,
          name text not null,
          domain text not null,
          created_at integer not null,
          removed_at integer
        )
      `)
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

function fromRow(row: Row): ProposalExpert {
  return {
    batchId: row.batchId,
    ...(row.proposalId ? { proposalId: row.proposalId } : {}),
    agentId: row.agentId,
    name: row.name,
    domain: row.domain,
    at: row.at,
    removedAt: row.removedAt,
  }
}

export async function recordProposalExpert(expert: ProposalExpert, now = Date.now()): Promise<void> {
  await initProposalExpertsDb()
  const db = await getDb()
  await db.execute('delete from proposal_experts where created_at < $1', [now - UNDO_WINDOW_MS])
  await db.execute(
    `insert into proposal_experts (batch_id, proposal_id, agent_id, name, domain, created_at, removed_at) values ($1, $2, $3, $4, $5, $6, null)
     on conflict(batch_id) do update set proposal_id = excluded.proposal_id, agent_id = excluded.agent_id, name = excluded.name,
       domain = excluded.domain, created_at = excluded.created_at, removed_at = null`,
    [expert.batchId, expert.proposalId ?? null, expert.agentId, expert.name, expert.domain, expert.at],
  )
}

export async function getProposalExpert(batchId: string): Promise<ProposalExpert | null> {
  await initProposalExpertsDb()
  const db = await getDb()
  const [row] = await db.select<Row[]>(`select ${COLUMNS} from proposal_experts where batch_id = $1`, [batchId])
  return row ? fromRow(row) : null
}

export async function markProposalExpertRemoved(batchId: string, at: number): Promise<void> {
  await initProposalExpertsDb()
  const db = await getDb()
  await db.execute('update proposal_experts set removed_at = $2 where batch_id = $1', [batchId, at])
}

/** 判斷能不能撤回用的現況：專家設定、存過的記憶、活動紀錄與任務筆數。domainNames 由呼叫端給（撤回 MOC 後仍存在的領域）。 */
export async function readExpertSnapshot(agentId: string, domainNames: readonly string[]): Promise<ExpertSnapshot> {
  // 經各自模組的初始化，確定 agent_settings／agent_tasks／agent_memory／activity_log 都已建立。
  const [{ getAgentSettings }, memoryDb] = await Promise.all([import('./agents'), import('./agent-memory')])
  const agent = await getAgentSettings(agentId)
  if (!agent) return { agent: null, memory: [], activityCount: 0, taskCount: 0, domainNames }
  const view = await memoryDb.getAgentMemory({ id: agent.id, name: agent.name, role: agent.role, domain: agent.domain })
  const memory: Array<ExpertSnapshot['memory'][number]> = []
  if (view.soul.updatedAt !== null) memory.push({ kind: 'soul', updatedAt: view.soul.updatedAt })
  if (view.rules.updatedAt !== null) memory.push({ kind: 'rules', updatedAt: view.rules.updatedAt })
  if (view.workNotes.updatedAt !== null) memory.push({ kind: 'work_notes', updatedAt: view.workNotes.updatedAt })
  const db = await getDb()
  const [activity] = await db.select<Array<{ count: number }>>('select count(*) as count from activity_log where actor_id = $1', [agentId])
  const [tasks] = await db.select<Array<{ count: number }>>('select count(*) as count from agent_tasks where kind = $1', [`agent:${agentId}`])
  return {
    agent: { id: agent.id, role: agent.role, ...(agent.domain ? { domain: agent.domain } : {}), updatedAt: agent.updatedAt },
    memory,
    activityCount: Number(activity?.count ?? 0),
    taskCount: Number(tasks?.count ?? 0),
    domainNames,
  }
}

/** 刪專家與其記憶（同一個交易）；專家設定在判斷之後又被改過（updated_at 不同）就整筆不做。 */
export async function deleteExpertAndMemory(agentId: string, updatedAt: number): Promise<void> {
  await executeRecordTransaction([
    { sql: 'delete from agent_settings where id = $1 and updated_at = $2', values: [agentId, updatedAt], expectedRows: 1 },
    { sql: 'delete from agent_memory where agent_id = $1', values: [agentId] },
  ])
  // Fork（almanac ALMNC-85.3）：刪專家也要同步（另一台會先問 Scott，第 8 節 2A）。
  void import('@/lib/almanac-sync/notify').then(({ notifyAlmanacLocalChange }) => notifyAlmanacLocalChange('agent-removed')).catch(() => undefined)
}

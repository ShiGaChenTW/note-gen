// Fork（almanac ALMNC-72）：proposal_experts 表用真的 node:sqlite 測（同 ops 表 db.test.ts）：登記讀回、標記已撤回、清掉 7 天外的。
import { createRequire } from 'node:module'
import { afterAll, expect, it, vi } from 'vitest'
import { getProposalExpert, initProposalExpertsDb, markProposalExpertRemoved, recordProposalExpert } from '@/db/proposal-experts'
import { UNDO_WINDOW_MS } from './types'

type Bindings = Record<string, string | number | null>
interface SqliteDb {
  prepare(sql: string): { all(bindings: Bindings): unknown[], run(bindings: Bindings): { changes: number, lastInsertRowid: number | bigint } }
  close(): void
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const sqlite = new DatabaseSync(':memory:')
const bind = (values: Array<string | number | null>) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

vi.mock('@/db/index', () => ({
  getDb: async () => ({
    execute: async (sql: string, values: Array<string | number | null> = []) => {
      const result = sqlite.prepare(sql).run(bind(values))
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    },
    select: async (sql: string, values: Array<string | number | null> = []) => sqlite.prepare(sql).all(bind(values)),
  }),
  executeRecordTransaction: async () => {},
}))

afterAll(() => sqlite.close())

it('round-trips a created expert per batch, marks it removed and prunes rows past the undo window', async () => {
  await initProposalExpertsDb()
  await initProposalExpertsDb()
  const now = 10 * UNDO_WINDOW_MS
  await recordProposalExpert({ batchId: 'old', agentId: 'a0', name: 'Alex', domain: '舊', at: 1 }, now)
  await recordProposalExpert({ batchId: 'b1', proposalId: 'domain:投資', agentId: 'agent-ivy', name: 'Ivy', domain: '投資', at: now }, now)
  expect(await getProposalExpert('b1')).toEqual({ batchId: 'b1', proposalId: 'domain:投資', agentId: 'agent-ivy', name: 'Ivy', domain: '投資', at: now, removedAt: null })
  // 登記時清掉超過 7 天（ops 已不能復原）的列。
  await recordProposalExpert({ batchId: 'b2', agentId: 'agent-owen', name: 'Owen', domain: '料理', at: now + 1 }, now + 1)
  expect(await getProposalExpert('old')).toBeNull()
  expect(await getProposalExpert('b2')).toMatchObject({ agentId: 'agent-owen' })
  expect((await getProposalExpert('b2'))?.proposalId).toBeUndefined()
  await markProposalExpertRemoved('b1', now + 5)
  expect((await getProposalExpert('b1'))?.removedAt).toBe(now + 5)
  expect(await getProposalExpert('missing')).toBeNull()
})

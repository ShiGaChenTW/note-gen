// Fork（almanac ALMNC-72）：撤回新建專家的 App 接線——安全才刪（同一交易）並記活動紀錄；不安全保留、不記；查這批要不要問。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExpertSnapshot, ProposalExpert } from './domain-undo'
import type { OpRecord } from './types'

const fake = vi.hoisted(() => ({
  snapshot: null as unknown as ExpertSnapshot,
  expert: null as ProposalExpert | null,
  deleteExpertAndMemory: vi.fn<(agentId: string, updatedAt: number) => Promise<void>>(async () => {}),
  markProposalExpertRemoved: vi.fn<(batchId: string, at: number) => Promise<void>>(async () => {}),
  readExpertSnapshot: vi.fn(),
  appendActivity: vi.fn(async () => 1),
  listDomains: vi.fn(async () => [{ id: 'M1', name: '料理', overview: '', createdAt: 0, updatedAt: 0 }]),
}))

vi.mock('@/db/proposal-experts', () => ({
  readExpertSnapshot: fake.readExpertSnapshot,
  deleteExpertAndMemory: fake.deleteExpertAndMemory,
  markProposalExpertRemoved: fake.markProposalExpertRemoved,
  getProposalExpert: async () => fake.expert,
  recordProposalExpert: async () => {},
}))
vi.mock('@/db/v3-domains', () => ({ listDomains: fake.listDomains }))
vi.mock('@/db/agent-memory', () => ({ appendActivity: fake.appendActivity }))
const ask = vi.hoisted(() => ({ askDomainUndo: vi.fn() }))
vi.mock('./domain-undo-ask', () => ask)

import { DomainUndoCancelled, domainAwareUndo, expertOutcomeOf, expertUndoneEntry, proposalExpertForRecords, removeProposalExpert } from './domain-undo-runtime'

const expert: ProposalExpert = { batchId: 'b1', proposalId: 'domain:投資', agentId: 'agent-ivy', name: 'Ivy', domain: '投資', at: 1000 }

beforeEach(() => {
  vi.clearAllMocks()
  fake.snapshot = {
    agent: { id: 'agent-ivy', role: 'expert', domain: '投資', updatedAt: 900 },
    memory: [{ kind: 'soul', updatedAt: 990 }],
    activityCount: 0, taskCount: 0, domainNames: [],
  }
  fake.readExpertSnapshot.mockImplementation(async (_id: string, domainNames: string[]) => ({ ...fake.snapshot, domainNames }))
})

describe('removeProposalExpert', () => {
  it('安全時刪專家與記憶、標記已撤回，並記一筆 undone 活動紀錄', async () => {
    const outcome = await removeProposalExpert(expert)
    expect(outcome.status).toBe('removed')
    expect(fake.readExpertSnapshot).toHaveBeenCalledWith('agent-ivy', ['料理'])
    expect(fake.deleteExpertAndMemory).toHaveBeenCalledWith('agent-ivy', 900)
    expect(fake.markProposalExpertRemoved).toHaveBeenCalledWith('b1', expect.any(Number))
    expect(fake.appendActivity).toHaveBeenCalledWith('system', expertUndoneEntry(expert))
    expect(expertUndoneEntry(expert)).toMatchObject({ actorId: 'scott', action: 'undone', targetLink: 'agent:agent-ivy', source: { kind: 'proposal', ref: 'domain:投資' } })
  })

  it('已有後續活動就保留、不刪也不記', async () => {
    fake.snapshot = { ...fake.snapshot, activityCount: 2 }
    expect(await removeProposalExpert(expert)).toEqual({ status: 'kept', expert, reasons: ['activity'] })
    expect(fake.deleteExpertAndMemory).not.toHaveBeenCalled()
    expect(fake.appendActivity).not.toHaveBeenCalled()
  })

  it('判斷完到刪除之間被改過（交易不成）：保留', async () => {
    fake.deleteExpertAndMemory.mockRejectedValueOnce(new Error('changed'))
    expect(await removeProposalExpert(expert)).toEqual({ status: 'kept', expert, reasons: ['edited'] })
    expect(fake.markProposalExpertRemoved).not.toHaveBeenCalled()
    expect(fake.appendActivity).not.toHaveBeenCalled()
  })
})

describe('proposalExpertForRecords', () => {
  const record = (partial: Partial<OpRecord>): OpRecord => ({
    id: 'op1', at: 1, seq: 1, actor: 'commander', kind: 'domain.create',
    payload: { kind: 'domain.create', name: '投資', path: '20 領域/投資.md', content: '' },
    inverse: { kind: 'domain.remove', name: '投資', path: '20 領域/投資.md', content: '' },
    batchId: 'b1', baseVersions: {}, undoneAt: null, ...partial,
  })

  it('同一批有成立領域且登記了新建專家才回傳', async () => {
    fake.expert = expert
    expect(await proposalExpertForRecords([record({})])).toEqual(expert)
    expect(await proposalExpertForRecords([record({ kind: 'note.create' })])).toBeNull()
    expect(await proposalExpertForRecords([record({ batchId: undefined })])).toBeNull()
    fake.expert = null
    expect(await proposalExpertForRecords([record({})])).toBeNull()
  })
})

describe('domainAwareUndo (workbench Z)', () => {
  const records: OpRecord[] = [{
    id: 'op1', at: 1, seq: 1, actor: 'commander', kind: 'domain.create',
    payload: { kind: 'domain.create', name: '投資', path: '20 領域/投資.md', content: '' },
    inverse: { kind: 'domain.remove', name: '投資', path: '20 領域/投資.md', content: '' },
    batchId: 'b1', baseVersions: {}, undoneAt: null,
  }]

  it('取消時丟 DomainUndoCancelled、不撤回；選一起撤回時回傳專家結果給 toast', async () => {
    fake.expert = expert
    const undo = vi.fn(async () => true)
    ask.askDomainUndo.mockResolvedValueOnce(null)
    await expect(domainAwareUndo(records, undo)()).rejects.toBeInstanceOf(DomainUndoCancelled)
    expect(undo).not.toHaveBeenCalled()
    ask.askDomainUndo.mockResolvedValueOnce('with-expert')
    const outcome = await domainAwareUndo(records, undo)()
    expect(undo).toHaveBeenCalledTimes(1)
    expect(expertOutcomeOf(outcome)?.status).toBe('removed')
    ask.askDomainUndo.mockResolvedValueOnce('moc-only')
    expect(expertOutcomeOf(await domainAwareUndo(records, undo)())).toBeUndefined()
    expect(fake.deleteExpertAndMemory).toHaveBeenCalledTimes(1)
  })
})

// Fork（almanac ALMNC-54.21 AC#3）：工作台按「接受」＝寫入，再記一筆活動紀錄；記不進去也不擋接受。
import { beforeEach, expect, it, vi } from 'vitest'
import type { DecideItem } from '@/lib/decide/project'
import type { WorkbenchCard } from './cards'

const fake = vi.hoisted(() => ({
  accept: vi.fn(async () => ({ path: '00 Inbox/2026-11-23 0900 會議紀錄.md' })),
  append: vi.fn(async () => 1),
  domain: vi.fn(async () => {}),
  listBatch: vi.fn(async (): Promise<Array<{ id: string, batchId: string }>> => []),
  undo: vi.fn(async () => true),
  reopen: vi.fn(),
}))

vi.mock('@/lib/decide/actions', () => ({ acceptDecision: fake.accept, rejectDecision: vi.fn() }))
vi.mock('@/db/agent-memory', () => ({ appendActivity: fake.append }))
vi.mock('@/db/agents', () => ({ listAgentSettings: async () => [{ id: 'c-1', name: 'Mia', role: 'commander', enabled: true }] }))
vi.mock('./domain-cards', () => ({ acceptDomainCard: fake.domain }))
vi.mock('@/db/ops', () => ({ opsStore: { listBatch: fake.listBatch } }))
vi.mock('@/lib/ops/ids', () => ({ newBatchId: () => 'batch-x' }))
vi.mock('@/lib/ops/runtime', () => ({ undoRecords: (records: unknown[]) => records.length ? fake.undo : undefined }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@/stores/collect', () => ({ default: { getState: () => ({ items: [], reopen: fake.reopen }) }, applyJournalTag: vi.fn() }))

const { acceptCard } = await import('./actions')

const decide: DecideItem = {
  key: 'collect:b1:p1', source: 'collect', kind: 'note', title: '會議紀錄', origin: '11/23 產線檢討', summary: '', when: '', at: 0,
  preview: { type: 'newNote', diff: { context: [], removed: [], added: [], hidden: 0 } }, duplicates: [],
  ref: { source: 'collect', itemId: 'b1', proposalId: 'p1' }, status: 'wait', conversationId: 12,
}

function card(over: Partial<WorkbenchCard> = {}): WorkbenchCard {
  return { key: decide.key, kind: 'proposal', group: 'proposal', label: 'note', verb: 'add', title: '會議紀錄', summary: '', at: 0, actions: ['accept', 'discuss', 'drop'], decide, ...over }
}

beforeEach(() => {
  fake.accept.mockClear()
  fake.append.mockReset()
  fake.append.mockResolvedValue(1)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

it('accepting a proposal on the workbench appends an activity entry (who proposed, what changed, source conversation)', async () => {
  await acceptCard(card())
  expect(fake.accept).toHaveBeenCalledWith(decide, { ops: { actor: 'commander', proposalId: 'collect:b1:p1', batchId: 'batch-x' } })
  expect(fake.append).toHaveBeenCalledWith('system', {
    actorId: 'c-1', actorRole: 'commander', action: 'accepted',
    targetLink: `note:${encodeURI('00 Inbox/2026-11-23 0900 會議紀錄.md')}`,
    source: { kind: 'conversation', ref: '12' }, note: '會議紀錄',
  })
})

it('still accepts when the activity log cannot be written', async () => {
  fake.append.mockRejectedValueOnce(new Error('no db'))
  await expect(acceptCard(card())).resolves.toBeUndefined()
  expect(fake.accept).toHaveBeenCalled()
})

it('logs accepted domain proposals too', async () => {
  await acceptCard(card({ key: 'domain:資料工程', kind: 'domain', label: 'knowledge', title: '成立領域「資料工程」', decide: undefined, domainProposalId: 'domain:資料工程' }))
  expect(fake.domain).toHaveBeenCalledWith('domain:資料工程', { actor: 'commander', proposalId: 'domain:資料工程', batchId: 'batch-x' })
  expect(fake.append).toHaveBeenCalledWith('system', expect.objectContaining({
    actorRole: 'commander', action: 'accepted', targetLink: `proposal:${encodeURIComponent('domain:資料工程')}`, note: '成立領域「資料工程」',
  }))
})

// Fork（almanac ALMNC-69.9）：接受造成的寫入記成同一批操作——活動紀錄那一筆帶 op_id，立即復原改以 ops 為準並把提案改回等你決定。
it('links the activity entry to the recorded ops and undoes through them', async () => {
  fake.listBatch.mockResolvedValueOnce([{ id: 'op-1', batchId: 'batch-x' }, { id: 'op-2', batchId: 'batch-x' }])
  const undo = await acceptCard(card())
  expect(fake.listBatch).toHaveBeenCalledWith('batch-x')
  expect(fake.append).toHaveBeenCalledWith('system', expect.objectContaining({ action: 'accepted', opId: 'op-1' }))
  expect(await undo!()).toBe(true)
  expect(fake.undo).toHaveBeenCalled()
  expect(fake.reopen).toHaveBeenCalledWith('b1', 'p1')
})

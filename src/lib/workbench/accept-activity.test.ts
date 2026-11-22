// Fork（almanac ALMNC-54.21 AC#3）：工作台按「接受」＝寫入，再記一筆活動紀錄；記不進去也不擋接受。
import { beforeEach, expect, it, vi } from 'vitest'
import type { DecideItem } from '@/lib/decide/project'
import type { WorkbenchCard } from './cards'

const fake = vi.hoisted(() => ({
  accept: vi.fn(async () => ({ path: '00 Inbox/2026-11-23 0900 會議紀錄.md' })),
  append: vi.fn(async () => 1),
  domain: vi.fn(async () => {}),
}))

vi.mock('@/lib/decide/actions', () => ({ acceptDecision: fake.accept, rejectDecision: vi.fn() }))
vi.mock('@/db/agent-memory', () => ({ appendActivity: fake.append }))
vi.mock('@/db/agents', () => ({ listAgentSettings: async () => [{ id: 'c-1', name: 'Mia', role: 'commander', enabled: true }] }))
vi.mock('./domain-cards', () => ({ acceptDomainCard: fake.domain }))

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
  expect(fake.accept).toHaveBeenCalledWith(decide)
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
  expect(fake.domain).toHaveBeenCalledWith('domain:資料工程')
  expect(fake.append).toHaveBeenCalledWith('system', expect.objectContaining({
    actorRole: 'commander', action: 'accepted', targetLink: `proposal:${encodeURIComponent('domain:資料工程')}`, note: '成立領域「資料工程」',
  }))
})

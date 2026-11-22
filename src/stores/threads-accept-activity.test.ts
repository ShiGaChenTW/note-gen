// Fork（almanac ALMNC-54.21 AC#3）：對話裡的提案卡按「接受」也記一筆活動紀錄（誰提的、改了什麼、來源對話）。
import { beforeEach, expect, it, vi } from 'vitest'
import type { Proposal } from '@/lib/collect/types'

const fake = vi.hoisted(() => ({ append: vi.fn(async () => 1) }))
vi.mock('@/db/agent-memory', () => ({ appendActivity: fake.append }))
vi.mock('@/db/agents', () => ({ listAgentSettings: async () => [{ id: 's-1', name: 'Leo', role: 'secretary', enabled: true }] }))

const useCollectStore = (await import('./collect')).default
const useThreadsStore = (await import('./threads')).default

const proposal: Proposal = {
  id: 'p1', kind: 'task', title: '寄報價單給 B 公司', body: '', due: '2026-11-24', time: '', tags: [], conversationId: 7, drafter: { role: 'secretary' },
}

beforeEach(() => {
  fake.append.mockClear()
  useCollectStore.setState({
    items: [{ id: 'b1', input: { kind: 'text', text: '' }, createdAt: 0, state: 'ready', proposals: [{ ...proposal, status: 'wait' }] }] as never,
    accept: vi.fn(async () => ({ path: '20 Journal/2026-11-23.md' })),
  })
  useThreadsStore.setState({ cards: { 70: [{ type: 'proposal', id: 'b1:p1', kind: 'task', title: proposal.title, status: 'wait', source: { itemId: 'b1', proposalId: 'p1' } }] } })
})

it('logs the accepted proposal with the secretary as proposer and the source conversation', async () => {
  await useThreadsStore.getState().actOnCard(70, 'b1:p1', 'accept')
  expect(useCollectStore.getState().accept).toHaveBeenCalledWith('b1', 'p1')
  expect(fake.append).toHaveBeenCalledWith('system', {
    actorId: 's-1', actorRole: 'secretary', action: 'accepted', targetLink: 'task:20%20Journal/2026-11-23.md',
    source: { kind: 'conversation', ref: '7' }, note: '寄報價單給 B 公司',
  })
  expect(useThreadsStore.getState().cards[70]?.[0]).toMatchObject({ status: 'ok' })
})

it('does not log when the card is rejected', async () => {
  useCollectStore.setState({ reject: vi.fn() })
  await useThreadsStore.getState().actOnCard(70, 'b1:p1', 'reject')
  expect(fake.append).not.toHaveBeenCalled()
})

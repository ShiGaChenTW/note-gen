import { describe, expect, it } from 'vitest'
import {
  DAY_MS, loadTrail, MAX_DISCUSSION_NOTE, normalizeDiscussionNote, pendingCountByConversation, PROPOSAL_STALE_DAYS, PROPOSAL_TRAIL_KEY,
  sanitizeTrail, saveTrail, staleProposals, startDiscussion, statusOf, supersede, waitingDays, type PendingProposalLike,
} from './trail'

describe('ALMNC-54.5 AC#2: 再次討論附說明', () => {
  it('requires a note and trims it to the limit', () => {
    expect(normalizeDiscussionNote('  標題改短  ')).toBe('標題改短')
    expect(normalizeDiscussionNote('   ')).toBe('')
    expect(Array.from(normalizeDiscussionNote('字'.repeat(MAX_DISCUSSION_NOTE + 20)))).toHaveLength(MAX_DISCUSSION_NOTE)
  })
  it('records the note and the conversation to return to; empty notes change nothing', () => {
    const trail = { k: { supersededBy: undefined } }
    const next = startDiscussion(trail, 'collect:a:b', { note: ' 日期改到下週 ', conversationId: 7, at: 100 })
    expect(next['collect:a:b']).toEqual({ conversationId: 7, discussion: { note: '日期改到下週', at: 100 } })
    expect(statusOf(next, 'collect:a:b')).toBe('discussing')
    expect(statusOf(next, 'other')).toBe('wait')
    expect(statusOf(undefined, 'x')).toBe('wait')
    expect(startDiscussion(next, 'x', { note: ' ', conversationId: 1, at: 1 })).toBe(next)
  })
  it('marks the old proposal superseded when the commander re-proposes', () => {
    const trail = supersede({ old: { conversationId: 3 } }, 'old', 'new')
    expect(trail.old).toEqual({ conversationId: 3, supersededBy: 'new' })
    expect(supersede(trail, 'old', 'new')).toBe(trail)
    expect(supersede(trail, 'a', 'a')).toBe(trail)
  })
  it('sanitizes what comes back from store.json', () => {
    expect(sanitizeTrail({
      a: { conversationId: 2, discussion: { note: ' x ', at: 1 }, supersededBy: 'b' },
      b: { conversationId: 'nope', discussion: { note: '   ', at: 1 } },
      c: 'junk',
      d: { conversationId: 1.5, supersededBy: '' },
    })).toEqual({ a: { conversationId: 2, discussion: { note: 'x', at: 1 }, supersededBy: 'b' } })
    expect(sanitizeTrail(null)).toEqual({})
    expect(sanitizeTrail([1])).toEqual({})
  })
  it('loads and saves under proposalTrail', async () => {
    const values = new Map<string, unknown>()
    const storage = { get: async (k: string) => values.get(k), set: async (k: string, v: unknown) => { values.set(k, v) }, save: async () => {} }
    await saveTrail({ a: { conversationId: 1 } }, storage)
    expect(values.get(PROPOSAL_TRAIL_KEY)).toEqual({ a: { conversationId: 1 } })
    expect(await loadTrail(storage)).toEqual({ a: { conversationId: 1 } })
  })
})

const p = (key: string, at: number, conversationId?: number, status: PendingProposalLike['status'] = 'wait'): PendingProposalLike => ({ key, at, conversationId, status })

describe('ALMNC-54.5 AC#3: 還有 N 則提案待決定', () => {
  it('counts waiting and discussing proposals per conversation; proposals without one are skipped', () => {
    const counts = pendingCountByConversation([p('a', 1, 1), p('b', 2, 1, 'discussing'), p('c', 3, 2), p('d', 4)])
    expect(counts.get(1)).toBe(2)
    expect(counts.get(2)).toBe(1)
    expect(counts.size).toBe(2)
  })
})

describe('ALMNC-54.5 AC#4: 超過 14 天沒決定的列進每週回顧', () => {
  const now = 100 * DAY_MS
  it('picks proposals waiting more than 14 days, oldest first, without removing anything', () => {
    const items = [p('fresh', now - 3 * DAY_MS), p('edge', now - PROPOSAL_STALE_DAYS * DAY_MS), p('old', now - 15 * DAY_MS), p('older', now - 30 * DAY_MS, 1, 'discussing')]
    const copy = [...items]
    expect(staleProposals(items, now).map(item => item.key)).toEqual(['older', 'old'])
    expect(items).toEqual(copy)
    expect(staleProposals(items, now, 2).map(item => item.key)).toEqual(['older', 'old', 'edge', 'fresh'])
  })
  it('reports whole days waited', () => {
    expect(waitingDays(now - 15.5 * DAY_MS, now)).toBe(15)
    expect(waitingDays(now + 1, now)).toBe(0)
  })
})

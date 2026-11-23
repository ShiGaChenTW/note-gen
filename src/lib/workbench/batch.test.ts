// Fork（almanac ALMNC-65.2）：同一資料源的新知識筆記合批——分組規則（投影）、批次卡、逐則接受不互相影響。
import { describe, expect, it } from 'vitest'
import type { DecideItem } from '@/lib/decide/project'
import { acceptEach, batchProposals, isBatchableNewNote, sourceBatchKey } from './batch'
import { actionLabelKey, batchCardKey, buildReviewCards, memberCard } from './cards'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-23T10:00:00')

function note(key: string, sourceId: string | null, extra: Partial<DecideItem> = {}): DecideItem {
  return {
    key, source: 'collect', kind: 'note', title: `筆記 ${key}`, origin: `資料源 ${sourceId}`, summary: '', when: '', at: NOW - DAY,
    preview: { type: 'newNote', diff: { context: [], removed: [], added: ['# 筆記'], hidden: 0 } },
    duplicates: [], ref: { source: 'collect', itemId: `item-${sourceId}`, proposalId: key }, status: 'wait',
    noteType: 'knowledge', ...(sourceId ? { sourceIds: [sourceId] } : {}), ...extra,
  }
}

describe('isBatchableNewNote', () => {
  it('only new knowledge notes from a source can be batched', () => {
    expect(isBatchableNewNote(note('a', 'S1'))).toBe(true)
    expect(isBatchableNewNote(note('a', null))).toBe(false)
    expect(isBatchableNewNote(note('a', 'S1', { noteType: 'record' }))).toBe(false)
    expect(isBatchableNewNote(note('a', 'S1', { noteType: undefined }))).toBe(false)
    expect(isBatchableNewNote(note('a', 'S1', { kind: 'task' }))).toBe(false)
    expect(isBatchableNewNote(note('a', 'S1', { source: 'draft' }))).toBe(false)
    expect(isBatchableNewNote(note('a', 'S1', { preview: { type: 'file', path: 'a.md', diff: null } }))).toBe(false)
    expect(isBatchableNewNote(note('a', 'S1', { card: { label: 'knowledge', verb: 'modify' } }))).toBe(false)
    expect(isBatchableNewNote(note('a', 'S1', { journalTag: { confidence: 'high', only: true } }))).toBe(false)
    expect(isBatchableNewNote(note('a', 'S1', { journalTag: { confidence: 'high' } }))).toBe(true)
    expect(isBatchableNewNote(note('a', 'S1', { status: 'discussing' }))).toBe(false)
  })

  it('same source key ignores order and duplicates', () => {
    expect(sourceBatchKey({ sourceIds: ['b', 'a', 'a'] })).toBe(sourceBatchKey({ sourceIds: ['a', 'b'] }))
    expect(sourceBatchKey({ sourceIds: ['a'] })).not.toBe(sourceBatchKey({ sourceIds: ['b'] }))
  })
})

describe('batchProposals', () => {
  it('groups two or more notes from the same source at the first one\'s position; others stay single and in order', () => {
    const items = [
      note('a1', 'S1'),
      note('t', 'S1', { kind: 'task', noteType: undefined }),
      note('b1', 'S2'),
      note('a2', 'S1'),
      note('r', 'S1', { noteType: 'record' }),
      note('a3', 'S1'),
    ]
    const entries = batchProposals(items)
    expect(entries.map(entry => entry.type === 'batch' ? `batch:${entry.items.map(item => item.key).join(',')}` : entry.item.key))
      .toEqual(['batch:a1,a2,a3', 't', 'b1', 'r'])
  })

  it('a single note from a source stays a normal card', () => {
    expect(batchProposals([note('a', 'S1'), note('b', 'S2')]).every(entry => entry.type === 'single')).toBe(true)
  })
})

describe('batch card in buildReviewCards', () => {
  it('shows one batch card listing every note; acceptAll label; members rebuild into single proposal cards', () => {
    const cards = buildReviewCards({ now: NOW, proposals: [note('a1', 'S1', { at: NOW - 2 * DAY }), note('a2', 'S1'), note('b', 'S2')] })
    expect(cards.map(card => card.key)).toEqual([batchCardKey('S1'), 'b'])
    const batch = cards[0]!
    expect(batch).toMatchObject({ kind: 'batch', group: 'proposal', label: 'note', verb: 'add', title: '筆記 a1', more: 1, summary: '資料源 S1', at: NOW - 2 * DAY, actions: ['accept'] })
    expect(batch.batch?.map(item => item.key)).toEqual(['a1', 'a2'])
    expect(batch.decide).toBeUndefined()
    expect(actionLabelKey(batch, 'accept')).toBe('acceptAll')
    expect(memberCard(batch, 'a2', NOW)).toMatchObject({ key: 'a2', kind: 'proposal', decide: expect.objectContaining({ key: 'a2' }) })
    expect(memberCard(batch, 'nope', NOW)).toBeNull()
  })
})

describe('acceptEach', () => {
  it('accepts one by one; a failure does not stop the others and is reported', async () => {
    const order: string[] = []
    const outcome = await acceptEach(['a', 'b', 'c'], async key => {
      order.push(key)
      if (key === 'b') throw new Error('boom')
      return key.toUpperCase()
    })
    expect(order).toEqual(['a', 'b', 'c'])
    expect(outcome.accepted).toEqual([{ item: 'a', value: 'A' }, { item: 'c', value: 'C' }])
    expect(outcome.failed.map(entry => entry.item)).toEqual(['b'])
  })
})

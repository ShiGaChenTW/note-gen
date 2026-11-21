// Fork（almanac ALMNC-54.8）：知識卡（成立新領域）與確認卡（到期要重新確認）從筆記庫索引算出來。
import { describe, expect, it } from 'vitest'
import { computeDomainProposals, confirmNotesFromIndex, knowledgeNotesFromIndex } from './domain-cards'

const NOW = Date.parse('2026-11-21T10:00:00')
const note = (path: string, frontmatter: Record<string, unknown> | null, tags: string[] = []) => ({ path, frontmatter, tags })

describe('domain and confirm cards', () => {
  const notes = [
    note('k/a.md', { type: 'knowledge', tags: ['資料工程'] }),
    note('k/b.md', { type: 'knowledge', tags: ['資料工程'], title: 'dbt 增量模型' }),
    note('k/c.md', { type: 'knowledge' }, ['#資料工程']),
    note('r/d.md', { type: 'record', tags: ['資料工程'] }),
    note('k/old.md', { type: 'knowledge', lastConfirmed: '2025-08-20', domains: ['dom_1'] }),
    note('k/fresh.md', { type: 'knowledge', lastConfirmed: '2026-10-01' }),
    note('k/gone.md', { type: 'knowledge', lastConfirmed: '2020-01-01', status: 'archived' }),
    note('plain.md', null),
  ]

  it('reads knowledge notes from frontmatter and inline tags', () => {
    const knowledge = knowledgeNotesFromIndex(notes)
    expect(knowledge.map(entry => entry.path)).toEqual(['k/a.md', 'k/b.md', 'k/c.md', 'k/old.md', 'k/fresh.md', 'k/gone.md'])
    expect(knowledge[1].title).toBe('dbt 增量模型')
    expect(knowledge[2].tags).toEqual(['資料工程'])
  })

  it('proposes a domain for 3+ unassigned notes on one topic, unless dismissed', () => {
    const knowledge = knowledgeNotesFromIndex(notes)
    const [proposal] = computeDomainProposals(knowledge, [], [], [])
    expect(proposal).toMatchObject({ id: 'domain:資料工程', notePaths: ['k/a.md', 'k/b.md', 'k/c.md'] })
    expect(computeDomainProposals(knowledge, [], [], ['domain:資料工程'])).toEqual([])
  })

  it('lists knowledge notes not confirmed for a year, oldest first, skipping archived ones', () => {
    expect(confirmNotesFromIndex(notes, NOW)).toEqual([{ path: 'k/old.md', title: 'old', lastConfirmed: '2025-08-20' }])
  })
})

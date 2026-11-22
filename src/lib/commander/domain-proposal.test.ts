import { describe, expect, it, vi } from 'vitest'
import type { Domain } from '@/lib/v3-model/domain'
import { acceptDomainProposal, describeDomainProposal, domainProposal, type KnowledgeNoteLike } from './domain-proposal'
import type { RosterAgent } from './types'

const roster: RosterAgent[] = [
  { id: 'cmd', name: 'Mia', role: 'commander', enabled: true },
  { id: 'ie', name: 'Alex', role: 'expert', domain: '工業工程', enabled: true },
]
const domains: Domain[] = [{ id: 'd-cook', name: '料理', overview: '', createdAt: 0, updatedAt: 0 }]
const note = (path: string, partial: Partial<KnowledgeNoteLike> = {}): KnowledgeNoteLike =>
  ({ path, title: path, type: 'knowledge', domains: [], tags: [], domainHint: '投資', ...partial })

describe('domainProposal', () => {
  it('同一主題剛好 3 則未歸屬的知識筆記 → 一則提案：領域＋新專家（本名、soul、rules）', () => {
    const [proposal, ...rest] = domainProposal([note('a.md'), note('b.md'), note('c.md')], domains, roster)
    expect(rest).toEqual([])
    expect(proposal).toMatchObject({ id: 'domain:投資', topic: '投資', domainName: '投資', notePaths: ['a.md', 'b.md', 'c.md'] })
    // Alex 已經用掉，跳到下一個名字
    expect(proposal.expert).toMatchObject({ name: 'Ivy', role: 'expert', domain: '投資' })
    expect(proposal.expert.soul).toContain('- 本名：Ivy')
    expect(proposal.expert.soul).toContain('- 負責領域：投資')
    expect(proposal.expert.rules).toContain('## 領域：投資')
    expect(proposal.expert.rules).toContain('## 共用工作記憶')
  })

  it('只有 2 則不提', () => {
    expect(domainProposal([note('a.md'), note('b.md')], domains, roster)).toEqual([])
  })

  it('已歸入存在的領域、不是知識筆記的不算；歸到不存在的領域仍算未歸屬', () => {
    const notes = [
      note('a.md'), note('b.md'),
      note('c.md', { domains: ['d-cook'] }),
      note('d.md', { type: 'record' }),
    ]
    expect(domainProposal(notes, domains, roster)).toEqual([])
    expect(domainProposal([...notes, note('e.md', { domains: ['d-gone'] })], domains, roster)).toHaveLength(1)
  })

  it('沒有 domainHint 用第一個標籤分組；名稱不分大小寫、空白', () => {
    const notes = [note('a.md', { domainHint: undefined, tags: ['UX'] }), note('b.md', { domainHint: ' ux ' }), note('c.md', { domainHint: 'Ux' })]
    expect(domainProposal(notes, domains, roster)).toHaveLength(1)
  })

  it('主題已經有同名領域或專家、或同一則提案還在等決定，就不再提', () => {
    const ie = [note('a.md', { domainHint: '工業工程' }), note('b.md', { domainHint: '工業工程' }), note('c.md', { domainHint: '工業工程' })]
    expect(domainProposal(ie, domains, roster)).toEqual([])
    const invest = [note('a.md'), note('b.md'), note('c.md')]
    expect(domainProposal(invest, domains, roster, { pendingIds: ['domain:投資'] })).toEqual([])
  })

  it('工作台文字依語系組字', () => {
    const [proposal] = domainProposal([note('a.md'), note('b.md'), note('c.md')], domains, roster)
    const t = (key: string, values?: Record<string, string | number>) => `${key}:${JSON.stringify(values)}`
    expect(describeDomainProposal(proposal, t)).toEqual({
      title: 'domainProposal.title:{"domain":"投資","name":"Ivy"}',
      summary: 'domainProposal.summary:{"count":3,"topic":"投資"}',
    })
  })
})

describe('acceptDomainProposal', () => {
  it('Scott 接受後才建立領域、專家、存 soul／rules，再把筆記歸入', async () => {
    const [proposal] = domainProposal([note('a.md'), note('b.md'), note('c.md')], domains, roster)
    const calls: string[] = []
    const writer = {
      addDomain: vi.fn(async () => { calls.push('domain'); return { id: 'd-new' } }),
      createExpert: vi.fn(async () => { calls.push('expert'); return 'agent-new' }),
      saveMemory: vi.fn(async () => { calls.push('memory') }),
      addNoteDomain: vi.fn(async (path: string) => { calls.push(`note:${path}`) }),
    }
    expect(await acceptDomainProposal(proposal, writer)).toEqual({ domainId: 'd-new', agentId: 'agent-new' })
    expect(calls).toEqual(['domain', 'expert', 'memory', 'note:a.md', 'note:b.md', 'note:c.md'])
    expect(writer.createExpert).toHaveBeenCalledWith({ name: 'Ivy', domain: '投資' })
    expect(writer.addNoteDomain).toHaveBeenCalledWith('a.md', 'd-new')
  })
})

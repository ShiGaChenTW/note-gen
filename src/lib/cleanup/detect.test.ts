// Fork（almanac ALMNC-54.12）：專家比對——模型輸出解析、沒有類似筆記時不叫模型、模型壞掉不擋流程；類似筆記的排序。
import { describe, expect, it, vi } from 'vitest'
import { createV3Note } from '@/lib/v3-model/note'
import { toNoteText } from './check'
import { createConflictDetector, parseObservations } from './detect'
import { containment, createSimilarFinder, rankSimilarNotes, similarity } from './similar'

const text = (path: string, title: string, body: string) => toNoteText(path, createV3Note({ title, type: 'knowledge', domains: ['ie'] }, `${body}\n`))
const a = text('k/a.md', '節拍時間', '節拍時間是 60 秒。')
const b = text('k/b.md', '節拍時間（新）', '節拍時間是 45 秒。')
const c = text('k/c.md', '產線平衡', '平衡率公式。')

describe('parseObservations', () => {
  const options = { trigger: 'written' as const, domainId: 'ie', by: { role: 'expert' as const, agentId: 'exp_1' } }

  it('keeps valid observations with paths, evidence and extras', () => {
    const raw = JSON.stringify({ observations: [
      { type: 'outdated', notes: [0, 1], evidence: '新量測是 45 秒', conclusionChanged: false, revisedBody: '節拍時間是 45 秒。' },
      { type: 'context', notes: [0, 2], evidence: '單班與兩班', contexts: { 0: '單班', 2: '兩班' } },
    ] })
    expect(parseObservations(raw, a, [b, c], options)).toEqual([
      { type: 'outdated', notePaths: ['k/a.md', 'k/b.md'], evidence: '新量測是 45 秒', conclusionChanged: false, revisedBody: '節拍時間是 45 秒。', domainId: 'ie', by: options.by, trigger: 'written' },
      { type: 'context', notePaths: ['k/a.md', 'k/c.md'], evidence: '單班與兩班', contexts: { 'k/a.md': '單班', 'k/c.md': '兩班' }, domainId: 'ie', by: options.by, trigger: 'written' },
    ])
  })

  it('drops unknown types, missing evidence, bad indexes, lone pair types and duplicates', () => {
    const raw = `前言\n{"observations":[
      {"type":"wrong","notes":[0,1],"evidence":"x"},
      {"type":"duplicate","notes":[0,1],"evidence":""},
      {"type":"duplicate","notes":[0,9],"evidence":"只有一則"},
      {"type":"contradiction","notes":[0,1],"evidence":"說法不同"},
      {"type":"contradiction","notes":[1,0],"evidence":"重複一次"},
      {"type":"outdated","notes":[0],"evidence":"沒有證據來源"}
    ]}`
    expect(parseObservations(raw, a, [b], options).map(entry => entry.type)).toEqual(['contradiction'])
    expect(parseObservations('not json', a, [b], options)).toEqual([])
  })

  it('accepts a single outdated note when external evidence is given', () => {
    const external = [{ title: '新標準', url: 'https://example.com/std', snippet: '45 秒' }]
    const raw = '{"observations":[{"type":"outdated","notes":[0],"evidence":"標準改了","conclusionChanged":true,"external":[0]}]}'
    expect(parseObservations(raw, a, [], { ...options, external })[0]).toMatchObject({ notePaths: ['k/a.md'], externalUrls: ['https://example.com/std'], conclusionChanged: true })
  })
})

describe('createConflictDetector', () => {
  it('does not ask the model without candidates or external evidence', async () => {
    const ask = vi.fn(async () => '{}')
    expect(await createConflictDetector(ask)(a, [a], { trigger: 'written' })).toEqual([])
    expect(ask).not.toHaveBeenCalled()
  })

  it('puts the expert prompt first and survives model failures', async () => {
    const ask = vi.fn<(prompt: string) => Promise<string>>(async () => '{"observations":[{"type":"duplicate","notes":[0,1],"evidence":"同一件事"}]}')
    const found = await createConflictDetector(ask)(a, [b], { trigger: 'handwritten', agentPrompt: '# 專家 rules' })
    expect(found).toHaveLength(1)
    expect(ask.mock.calls[0][0].startsWith('# 專家 rules')).toBe(true)
    expect(ask.mock.calls[0][0]).toContain('[1] 節拍時間（新） (k/b.md')
    expect(ask.mock.calls[0][0]).toContain('Never use dates')
    expect(ask.mock.calls[0][0]).not.toContain('lastConfirmed=')
    const broken = createConflictDetector(async () => { throw new Error('offline') })
    expect(await broken(a, [b], { trigger: 'written' })).toEqual([])
  })
})

describe('similar notes by domain', () => {
  const index = [
    { path: 'k/1.md', frontmatter: { type: 'knowledge', domains: ['ie'], title: '節拍時間的定義' } },
    { path: 'k/2.md', frontmatter: { type: 'knowledge', domains: ['ie'], title: '產線平衡率' }, headings: [{ text: '節拍時間' }] },
    { path: 'k/3.md', frontmatter: { type: 'knowledge', domains: ['other'], title: '節拍時間的定義' } },
    { path: 'k/4.md', frontmatter: { type: 'knowledge', domains: ['ie'], title: '節拍時間（舊）', status: 'superseded' } },
    { path: 'k/5.md', frontmatter: { type: 'knowledge', title: '節拍時間無領域' } },
    { path: 'r/6.md', frontmatter: { type: 'record', domains: ['ie'], title: '節拍時間會議' } },
  ]

  it('scores text with character bigrams', () => {
    expect(similarity('節拍時間', '節拍時間的定義')).toBeGreaterThan(0.5)
    expect(similarity('節拍時間', '烹飪')).toBe(0)
    expect(containment('節拍時間', '今天討論節拍時間與產線')).toBe(1)
  })

  it('ranks active knowledge notes of the same domain only', () => {
    expect(rankSimilarNotes('節拍時間', index, { domainId: 'ie' }).map(note => note.path)).toEqual(['k/1.md', 'k/2.md'])
    expect(rankSimilarNotes('節拍時間', index).map(note => note.path)).toEqual(['k/5.md'])
    expect(rankSimilarNotes('節拍時間', index, { allDomains: true, exclude: ['k/1.md'] }).map(note => note.path)).toEqual(['k/3.md', 'k/5.md', 'k/2.md'])
  })

  it('boosts knowledge search hits and ignores a failing search', async () => {
    const boosted = createSimilarFinder({ notes: () => index, search: async () => [{ path: 'k/2.md', score: 1 }] })
    expect((await boosted('ie', { title: '節拍時間', body: '' }))[0].path).toBe('k/2.md')
    const failing = createSimilarFinder({ notes: () => index, search: async () => { throw new Error('no index') } })
    expect((await failing('ie', { title: '節拍時間', body: '' }))[0].path).toBe('k/1.md')
  })
})

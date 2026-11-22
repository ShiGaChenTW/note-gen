import { describe, expect, it } from 'vitest'
import type { Domain } from '@/lib/v3-model/domain'
import { buildDomainTree, findDomainNode, knowledgeNotesByDomain, parseDomainSections, relatedDomains, splitWikiLinks } from './model'

const domain = (id: string, name: string, parentId?: string, overview = ''): Domain => ({ id, name, parentId, overview, createdAt: 1, updatedAt: 2 })
const note = (path: string, frontmatter: Record<string, unknown> | null, headings: Array<{ level: number, text: string }> = []) => ({ path, frontmatter, headings })

describe('parseDomainSections', () => {
  it('splits the overview into 總覽、核心概念、重點結論（附出處）、矛盾與未解問題', () => {
    const sections = parseDomainSections([
      '# 工業工程', '', '## 總覽', '', '生產系統的分析與改善。', '',
      '## 核心概念', '', '- 瓶頸：限制整體產出的站', '- 在製品', '',
      '## 重點結論', '', '- 縮短換模時間比加人有效（[[k/smed]]）', '',
      '## 矛盾與未解問題', '', '- [[k/a]] ↔ [[k/b]]：兩則對換模時間的說法不同', '',
    ].join('\n'))
    expect(sections.summary).toBe('生產系統的分析與改善。')
    expect(sections.coreConcepts).toEqual(['瓶頸：限制整體產出的站', '在製品'])
    expect(sections.keyConclusions).toEqual(['縮短換模時間比加人有效（[[k/smed]]）'])
    expect(sections.openQuestions).toEqual(['[[k/a]] ↔ [[k/b]]：兩則對換模時間的說法不同'])
  })

  it('reads what cleanup writes: an overview that only has 矛盾與未解問題 leaves the other sections empty', () => {
    const sections = parseDomainSections('# 工業工程\n\n## 矛盾與未解問題\n\n- [[k/a]] ↔ [[k/b]]：contradiction 的證據\n')
    expect(sections.summary).toBe('')
    expect(sections.coreConcepts).toEqual([])
    expect(sections.keyConclusions).toEqual([])
    expect(sections.openQuestions).toHaveLength(1)
  })

  it('uses the text before the first heading as the summary when there is no 總覽 heading, and never invents sections', () => {
    expect(parseDomainSections('# 工程\n\n資料工程與軟體工程。')).toEqual({ summary: '資料工程與軟體工程。', coreConcepts: [], keyConclusions: [], openQuestions: [] })
    expect(parseDomainSections('')).toEqual({ summary: '', coreConcepts: [], keyConclusions: [], openQuestions: [] })
  })

  it('accepts simplified Chinese and English headings, numbered lists and paragraph items, and ignores unknown sections', () => {
    const sections = parseDomainSections([
      '## Core concepts', '1. Bottleneck', '2) WIP',
      '## 重点结论', '第一段', '接著同一段', '', '第二段',
      '## 其他', '- 不要收進來',
      '## Contradictions and open questions', '- 一條',
    ].join('\n'))
    expect(sections.coreConcepts).toEqual(['Bottleneck', 'WIP'])
    expect(sections.keyConclusions).toEqual(['第一段 接著同一段', '第二段'])
    expect(sections.openQuestions).toEqual(['一條'])
  })

  it('does not treat a heading inside a code fence as a section', () => {
    const sections = parseDomainSections('## 總覽\n\n```\n## 核心概念\n```\n')
    expect(sections.coreConcepts).toEqual([])
    expect(sections.summary).toContain('## 核心概念')
  })
})

describe('splitWikiLinks', () => {
  it('splits text and [[links]] (heading and alias aware)', () => {
    expect(splitWikiLinks('見 [[k/a]] 與 [[k/b#段落|B 筆記]]。')).toEqual([
      { kind: 'text', text: '見 ' },
      { kind: 'link', target: 'k/a', label: 'k/a' },
      { kind: 'text', text: ' 與 ' },
      { kind: 'link', target: 'k/b', label: 'B 筆記' },
      { kind: 'text', text: '。' },
    ])
    expect(splitWikiLinks('沒有連結')).toEqual([{ kind: 'text', text: '沒有連結' }])
  })
})

describe('knowledgeNotesByDomain', () => {
  it('lists only 知識筆記 (type: knowledge) under each domain they name, sorted by title, with title fallback and status', () => {
    const byDomain = knowledgeNotesByDomain([
      note('k/b.md', { type: 'knowledge', domains: ['d1', 'd2'], title: 'B 筆記', summary: '摘要', status: 'disputed', lastConfirmed: '2026-11-01' }),
      note('k/a.md', { type: 'knowledge', domains: 'd1' }, [{ level: 1, text: 'A 筆記' }]),
      note('k/c.md', { type: 'knowledge', domains: ['d1'], status: 'weird', lastConfirmed: 'yesterday' }),
      note('r/log.md', { type: 'record', domains: ['d1'] }),
      note('x/plain.md', null),
      note('x/untyped.md', { domains: ['d1'] }),
    ])
    expect(byDomain.get('d1')?.map(n => [n.title, n.status])).toEqual([['A 筆記', 'valid'], ['B 筆記', 'disputed'], ['c', 'valid']])
    expect(byDomain.get('d1')?.[1]).toMatchObject({ summary: '摘要', lastConfirmed: '2026-11-01' })
    expect(byDomain.get('d1')?.[2].lastConfirmed).toBeUndefined()
    expect(byDomain.get('d2')?.map(n => n.path)).toEqual(['k/b.md'])
    expect(byDomain.has('d3')).toBe(false)
  })
})

describe('domain tree (at most two levels)', () => {
  const domains = [
    domain('eng', '工程'), domain('data', '資料工程', 'eng'), domain('soft', '軟體工程', 'eng'),
    domain('ie', '工業工程'), domain('orphan', '孤兒', 'gone'),
  ]
  const notes = knowledgeNotesByDomain([note('k/a.md', { type: 'knowledge', domains: ['data'] })])
  const tree = buildDomainTree(domains, notes)

  it('puts top-level domains first, sub-domains underneath, with display paths and own notes; a missing parent is treated as top-level', () => {
    expect(tree.map(node => node.domain.id).sort()).toEqual(['eng', 'ie', 'orphan'])
    expect(tree.flatMap(node => node.children).every(child => child.domain.parentId === 'eng')).toBe(true)
    const eng = findDomainNode(tree, 'eng')!
    expect(eng.children.map(child => child.path)).toEqual(['工程 › 軟體工程', '工程 › 資料工程'])
    expect(findDomainNode(tree, 'data')?.notes.map(n => n.path)).toEqual(['k/a.md'])
    expect(findDomainNode(tree, 'nope')).toBeUndefined()
  })

  it('relatedDomains gives parent, sub-domains and same-level domains', () => {
    expect(relatedDomains(tree, 'eng').children.map(n => n.domain.id).sort()).toEqual(['data', 'soft'])
    const data = relatedDomains(tree, 'data')
    expect(data.parent?.domain.id).toBe('eng')
    expect(data.siblings.map(n => n.domain.id)).toEqual(['soft'])
    expect(relatedDomains(tree, 'ie')).toEqual({ children: [], siblings: [] })
  })
})

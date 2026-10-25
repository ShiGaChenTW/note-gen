import { describe, expect, it } from 'vitest'
import { indexNote } from '@/lib/vault-index/index-note'
import { emptyLog } from '@/lib/home/activity'
import { aggregateTopics, type AggregateInput } from './aggregate'
import { applyRefresh, changedSince, emptyCache, getTopicSummary, normalizeCache, planRefresh, setTopicSummary, topicFingerprint } from './cache'
import { computeMastery, emptySignals, type TopicSignals } from './mastery'
import { analyzeNote, analyzeSummary, countWords } from './note-signals'
import { addProposals, assignTopics, candidateTopics, parseProposals, parseTopicList, renderTopicList, uncoveredNotes } from './topics'

const T = Date.UTC(2026, 9, 20, 4)

function note(path: string, content: string, mtime = T) {
  return indexNote(path, content, mtime)
}

function signals(partial: Partial<TopicSignals>): TopicSignals {
  return { ...emptySignals(), ...partial }
}

describe('主題清單', () => {
  const text = [
    '---',
    'type: 主題清單',
    '---',
    '# 主題清單',
    '',
    '說明文字',
    '',
    '## Rust',
    '- 標籤：#Rust、#程式/rust',
    '- MOC：[[Rust MOC]]',
    '- 資料夾：/Dev/Rust/',
    '我自己加的一行',
    '',
    '## 時間管理',
    '- 狀態：待確認',
    '- 筆記：[[GTD]]、[[番茄鐘|番茄]]',
    '- 備註：AI 提議',
    '- 不認得的欄位：保留',
  ].join('\n')

  it('解析欄位、待確認、保留不認得的行', () => {
    const list = parseTopicList(text)
    expect(list.preamble).toContain('# 主題清單')
    expect(list.topics.map(t => t.name)).toEqual(['Rust', '時間管理'])
    expect(list.topics[0]).toMatchObject({ tags: ['rust', '程式/rust'], mocs: ['Rust MOC'], folders: ['Dev/Rust'], proposed: false })
    expect(list.topics[0].extra).toContain('我自己加的一行')
    expect(list.topics[1]).toMatchObject({ notes: ['GTD', '番茄鐘'], proposed: true, remark: 'AI 提議' })
    expect(list.topics[1].extra).toContain('- 不認得的欄位：保留')
  })

  it('輸出再解析結果相同；新增提議時同名略過', () => {
    const list = parseTopicList(text)
    expect(parseTopicList(renderTopicList(list))).toEqual(list)
    const next = addProposals(list, [{ ...list.topics[0], name: 'rust' }, { ...list.topics[0], name: '寫作', proposed: false }])
    expect(next.topics.map(t => [t.name, t.proposed])).toEqual([['Rust', false], ['時間管理', true], ['寫作', true]])
    expect(renderTopicList({ preamble: '', topics: [] })).toContain('type: 主題清單')
  })

  it('筆記歸屬：標籤含子標籤、資料夾、MOC 與它的連結、明確列入', () => {
    const notes = [
      note('a.md', '#rust/async 內容'),
      note('Dev/Rust/b.md', '內容'),
      note('Rust MOC.md', '- [[c]]\n- [[d]]'),
      note('c.md', '內容'),
      note('d.md', '內容'),
      note('GTD.md', '內容'),
      note('other.md', '#rustacean'),
    ]
    const list = parseTopicList(text)
    const assignment = assignTopics(list.topics, notes)
    expect([...assignment.get('Rust')!].sort()).toEqual(['Dev/Rust/b.md', 'Rust MOC.md', 'a.md', 'c.md', 'd.md'])
    expect([...assignment.get('時間管理')!]).toEqual(['GTD.md'])
    expect(uncoveredNotes(notes, assignment).map(n => n.path)).toEqual(['other.md'])
  })

  it('候選主題：第一層標籤與 MOC，同名合併，略過工作流程標籤與篇數太少的', () => {
    const notes = [
      note('1.md', '#寫作/技巧 #todo'),
      note('2.md', '#寫作'),
      note('3.md', '#daily'),
      note('寫作 MOC.md', '#moc\n[[1]] [[2]] [[x]]'),
      note('x.md', '一般'),
      note('4.md', '#少'),
    ]
    const candidates = candidateTopics(notes, { minNotes: 3 })
    expect(candidates.map(c => [c.name, c.noteCount, c.tags, c.mocs])).toEqual([['寫作', 4, ['寫作'], ['寫作 MOC']]])
    expect(candidates[0].proposed).toBe(true)
  })

  it('解析 AI 提議：只留存在的筆記路徑', () => {
    const raw = '```json\n{"topics":[{"name":"## 習慣","reason":"都在講習慣","notes":["a.md","不存在.md"]},{"name":"空","notes":[]}]}\n```'
    expect(parseProposals(raw, ['a.md'])).toEqual([
      expect.objectContaining({ name: '習慣', notes: ['a'], proposed: true, remark: '都在講習慣' }),
    ])
    expect(parseProposals('壞掉', [])).toEqual([])
  })
})

describe('筆記訊號', () => {
  it('字數：中文一字一單位、英文一詞一單位', () => {
    expect(countWords('借用檢查 borrow checker!')).toBe(6)
  })

  it('區分自己寫的與引用；callout 只有 quote/cite 算摘抄；程式碼與嵌入不算', () => {
    const content = [
      '---', 'tags: [x]', '---',
      '# 標題', '我自己寫的說明。',
      '> 書上的一段話',
      '> [!note] 我的提醒',
      '> 接著寫',
      '> [!quote]',
      '> 引文內容',
      '```', '程式碼不算', '```',
      '![[圖.png]] [[連結文字|顯示]] https://example.com',
      '- 清單一', '1. 清單二',
    ].join('\n')
    const a = analyzeNote(content, { tags: ['x'] })
    expect(a.ownWords).toBe(countWords('我自己寫的說明。我的提醒接著寫顯示清單一清單二'))
    expect(a.quotedWords).toBe(countWords('書上的一段話引文內容'))
    expect(a).toMatchObject({ headings: 1, listItems: 2, clipped: false, hasSummary: false })
  })

  it('剪藏：正文算摘抄，心得段落算自己寫的；總結段落要有足夠內容', () => {
    const body = ['# 文章', '原文原文原文', '## 我的心得', '這篇讓我想到二十個字以上的自己的想法真的很多很多', '## 總結', '太短'].join('\n')
    const a = analyzeNote(body, { source: 'https://example.com/post' })
    expect(a.clipped).toBe(true)
    expect(a.quotedWords).toBe(countWords('原文原文原文'))
    expect(a.ownWords).toBe(countWords('這篇讓我想到二十個字以上的自己的想法真的很多很多太短'))
    expect(a.hasReflection).toBe(true)
    expect(a.hasSummary).toBe(false)
  })

  it('對話摘要：依節的順序計數，「（無）」不算', () => {
    const md = '---\ntype: 對話摘要\n---\n# 主旨\n\n## Q\n\n- 問\n\n## My views\n\n- 觀點一\n- 觀點二\n\n## AI\n\n- （無）\n\n## 結論\n\n- 決定'
    expect(analyzeSummary(md)).toEqual({ myViews: 2, aiPoints: 0 })
  })
})

describe('掌握度', () => {
  it('只有摘抄：接觸，離整理還差篇數、結構、連結', () => {
    const m = computeMastery(signals({ notes: 1, quotedWords: 5000 }))
    expect(m.level).toBe('contact')
    expect(m.next).toBe('organized')
    expect(m.gaps.map(g => g.options.map(o => o.metric))).toEqual([['notes'], ['structure'], ['internalLinks']])
  })

  it('門檻沒過時等級停住，分數壓在下一級起點之下', () => {
    // 分數夠高，但沒有自己的觀點
    const s = signals({ notes: 10, ownWords: 500, quotedWords: 5000, structuredNotes: 5, internalLinks: 10, touchDays: 8, spanDays: 60, crossLinks: 6 })
    const m = computeMastery(s)
    expect(m.level).toBe('organized')
    expect(m.score).toBeLessThanOrEqual(49)
    expect(m.gaps.map(g => g.options[0].metric)).toEqual(['ownRatio', 'ownViews', 'revisedNotes'])
  })

  it('有自己的觀點與改寫：內化；跨主題或實際用過才融會', () => {
    const base = { notes: 8, ownWords: 3000, quotedWords: 1000, structuredNotes: 4, internalLinks: 8, reflections: 2, myViews: 2, revisedNotes: 3, touchDays: 10, spanDays: 40 }
    const internal = computeMastery(signals(base))
    expect(internal.level).toBe('internalized')
    expect(internal.gaps).toEqual([{ options: [{ metric: 'crossLinks', have: 0, need: 3 }, { metric: 'applied', have: 0, need: 2 }] }])
    const integrated = computeMastery(signals({ ...base, dailyMentions: 2, crossLinks: 1 }))
    expect(integrated.level).toBe('integrated')
    expect(integrated.next).toBeNull()
    expect(integrated.gaps).toEqual([])
  })

  it('門檻都過但分數不夠：回報差幾分', () => {
    const m = computeMastery(signals({ notes: 3, structuredNotes: 2, internalLinks: 2, ownWords: 100 }))
    expect(m.level).toBe('contact')
    expect(m.gaps).toEqual([])
    expect(m.pointsToNext).toBeGreaterThan(0)
  })

  it('分項合計不超過 100', () => {
    const huge = signals({ notes: 99, ownWords: 1e6, quotedWords: 1e6, structuredNotes: 99, hasMoc: true, internalLinks: 99, reflections: 99, summaries: 99, myViews: 99, revisedNotes: 99, touchDays: 999, spanDays: 999, crossLinks: 99, dailyMentions: 99, experienceMemories: 9 })
    expect(computeMastery(huge)).toMatchObject({ score: 100, level: 'integrated' })
  })
})

describe('彙整', () => {
  const topics = parseTopicList('## Rust\n- 標籤：#rust\n\n## 寫作\n- 資料夾：寫作').topics
  const notes = [
    note('r1.md', '#rust\n# A\n## B\n[[r2]] [[w1]] ![[spec.pdf]]', Date.UTC(2026, 9, 1, 4)),
    note('r2.md', '#rust\n內容 [[r1]]', Date.UTC(2026, 9, 10, 4)),
    note('寫作/w1.md', '寫作內容'),
    note('20 Journal/21 Daily/20261015.md', '今天用了 [[r1]]'),
    note('對話摘要/2026/10/2026-10-12 借用.md', '---\ntype: 對話摘要\ndate: 2026-10-12\ntopics: [Rust]\n---\n# 借用\n\n## Q\n\n- q\n\n## 觀點\n\n- 我覺得像讀寫鎖\n\n## AI\n\n- 編譯期規則'),
    note('私人/r3.md', '#rust 不該被算進來'),
    note('報告/主題清單.md', '#rust'),
  ]
  const input: AggregateInput = {
    topics,
    notes,
    analyses: new Map([
      ['r1.md', { ownWords: 100, quotedWords: 50, headings: 2, listItems: 0, hasSummary: true, hasReflection: false, clipped: false }],
      ['r2.md', { ownWords: 20, quotedWords: 0, headings: 0, listItems: 0, hasSummary: false, hasReflection: true, clipped: false }],
    ]),
    summaries: new Map([['對話摘要/2026/10/2026-10-12 借用.md', { myViews: 1, aiPoints: 1 }]]),
    editDays: new Map([['r2.md', ['2026-10-05', '2026-10-10']]]),
    pdfs: new Map([['spec.pdf', { path: 'spec.pdf', words: 400 }]]),
    activity: { days: { '2026-10-18': { reread: ['r1.md'] } } },
    memories: [
      { id: 'm1', content: '我在工作上用 Rust 寫過 CLI', kind: 'experience', status: 'active' },
      { id: 'm2', content: '想把 rust 學好', kind: 'preference', status: 'active' },
      { id: 'm3', content: 'Rust 舊記憶', kind: 'experience', status: 'archived' },
    ],
    daily: { folder: '20 Journal/21 Daily', pattern: 'YYYYMMDD' },
    excludeFolders: ['私人'],
  }

  it('算出訊號：排除資料夾、報告資料夾、每日筆記、摘要、PDF、記憶', () => {
    const [rust, writing] = aggregateTopics(input)
    expect(rust.paths).toEqual(['r1.md', 'r2.md'])
    expect(rust.signals).toMatchObject({
      notes: 2,
      ownWords: 120,
      quotedWords: 450,
      structuredNotes: 1,
      summaries: 1,
      reflections: 1,
      myViews: 1,
      aiPoints: 1,
      internalLinks: 2,
      crossLinks: 1,
      revisedNotes: 1,
      dailyMentions: 1,
      experienceMemories: 1,
    })
    // 10/01、10/05、10/10、10/12、10/15、10/18
    expect(rust.signals.touchDays).toBe(6)
    expect(rust.signals.spanDays).toBe(17)
    expect(rust.evidence).toEqual({
      summaries: ['對話摘要/2026/10/2026-10-12 借用.md'],
      pdfs: ['spec.pdf'],
      dailyNotes: ['20 Journal/21 Daily/20261015.md'],
      memories: [{ id: 'm1', kind: 'experience', content: '我在工作上用 Rust 寫過 CLI' }, { id: 'm2', kind: 'preference', content: '想把 rust 學好' }],
    })
    expect(rust.priority).toBe(1)
    expect(writing.paths).toEqual(['寫作/w1.md'])
    expect(writing.signals.ownWords).toBe(0)
  })

  it('沒有任何活動時也能算（空足跡、沒有記憶）', () => {
    const results = aggregateTopics({ ...input, activity: emptyLog(), memories: [], editDays: new Map() })
    expect(results[0].signals.experienceMemories).toBe(0)
    expect(results[0].mastery.level).toBe('contact')
  })
})

describe('增量快取', () => {
  const analysis = { ownWords: 1, quotedWords: 0, headings: 0, listItems: 0, hasSummary: false, hasReflection: false, clipped: false }

  it('只重讀新增或 mtime 改變的；刪掉的移出', () => {
    let cache = applyRefresh(emptyCache('/v'), [{ path: 'a.md', mtime: T, analysis }, { path: 'gone.md', mtime: T, analysis }], [])
    const plan = planRefresh(cache, new Map([['a.md', T], ['b.md', T]]))
    expect(plan).toEqual({ stale: ['b.md'], removed: ['gone.md'] })
    cache = applyRefresh(cache, [{ path: 'b.md', mtime: T, analysis }], plan.removed)
    expect(Object.keys(cache.notes).sort()).toEqual(['a.md', 'b.md'])
  })

  it('修改日：mtime 變新才記，同一天不重複', () => {
    const d1 = Date.UTC(2026, 9, 1, 4)
    const d2 = Date.UTC(2026, 9, 3, 4)
    let cache = applyRefresh(emptyCache('/v'), [{ path: 'a.md', mtime: d1, analysis }], [])
    cache = applyRefresh(cache, [{ path: 'a.md', mtime: d1 + 1000, analysis }], [])
    cache = applyRefresh(cache, [{ path: 'a.md', mtime: d2, analysis }], [])
    expect(cache.notes['a.md'].editDays).toEqual(['2026-10-01', '2026-10-03'])
  })

  it('版本或工作區不符就重建；主題摘要依指紋失效', () => {
    expect(normalizeCache({ version: 0, workspace: '/v', notes: { x: {} } }, '/v').notes).toEqual({})
    expect(normalizeCache({ ...emptyCache('/other') }, '/v').workspace).toBe('/v')
    const fp = topicFingerprint(['b.md', 'a.md'], () => 1)
    expect(fp).toBe(topicFingerprint(['a.md', 'b.md'], () => 1))
    expect(fp).not.toBe(topicFingerprint(['a.md', 'b.md'], path => (path === 'a.md' ? 2 : 1)))
    const cache = setTopicSummary(emptyCache('/v'), 'Rust', fp, '摘要')
    expect(getTopicSummary(cache, 'Rust', fp)).toBe('摘要')
    expect(getTopicSummary(cache, 'Rust', 'other')).toBeNull()
    expect(changedSince([{ path: 'b', mtime: 5 }, { path: 'a', mtime: 9 }, { path: 'c', mtime: 1 }], 4)).toEqual(['a', 'b'])
  })
})

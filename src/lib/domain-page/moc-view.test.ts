// Fork（almanac ALMNC-69.8）：MOC 頁五區塊的顯示條件、頁首、待釐清分組、未歸屬與搜尋過濾。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseMoc } from '@/lib/moc/parse'
import type { NoteLike } from './model'
import {
  filterNotes, groupOpenItems, headerItem, legacyPageView, mocPageView, parseMocHeader, parseOpenItem, searchableBody, splitList,
  START_HERE_THRESHOLD, unassignedNotes,
} from './moc-view'
import { requestExplore, setExploreHandler } from './explore'

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'moc', 'fixtures', `${name}.md`), 'utf8')

const note = (path: string, frontmatter: Record<string, unknown> | null): NoteLike => ({ path, frontmatter })
/** 連結目標 → `知識/<目標>.md`（範例 vault 的連結都是標題）。 */
const byTitle = (notes: ReadonlyMap<string, NoteLike>) => (target: string) => {
  const path = `知識/${target}.md`
  return notes.has(path) ? path : null
}
const vault = (titles: string[], extra: Record<string, Record<string, unknown>> = {}) =>
  new Map(titles.map(title => [`知識/${title}.md`, note(`知識/${title}.md`, { type: 'knowledge', title, ...extra[title] })]))

const TIME_TITLES = [
  '時間不能管理，能管理的是注意力', '重要但不緊急的事，不排進行程就不會發生', '說不比提高效率更省時間',
  '把最難的工作放在精神最好的時段', '時間區塊要留兩成緩衝', '切換工作的代價比想像中高',
  '計畫的價值在調整，不在照表操課', '每週回顧是讓系統不崩潰的最小動作',
]

describe('parseMocHeader：頁首的上層、相關、相鄰', () => {
  it('reads the example vault header line (links, plain names, trailing notes)', () => {
    const moc = parseMoc(fixture('時間管理'), '20 領域/時間管理.md')
    const header = parseMocHeader(moc.preamble)
    expect(header.parent).toEqual([{ name: '個人效能', label: '個人效能', linked: true, note: '從它的「時間管理」章節長成' }])
    expect(header.related).toEqual([
      { name: '專注力', label: '專注力', linked: true },
      { name: '習慣養成', label: '習慣養成', linked: false, note: '還沒建立' },
    ])
    expect(header.adjacent.map(item => item.name)).toEqual(['睡眠科學', '決策疲勞'])
    expect(header.adjacent[1].note).toBe('研究員建議可以「探索」')
    expect(header.owner).toBe('Ivy · 時間管理專家')
    expect(header.confirmed).toBe('11/20')
  })

  it('ignores blockquotes and returns empty lists when there is no header line', () => {
    expect(parseMocHeader(parseMoc(fixture('個人效能')).preamble)).toEqual({ parent: [], related: [], adjacent: [] })
    expect(parseMocHeader(undefined)).toEqual({ parent: [], related: [], adjacent: [] })
  })

  it('splits lists without breaking links or brackets, and reads aliases', () => {
    expect(splitList('[[A、B]]、C（D、E）, F')).toEqual(['[[A、B]]', 'C（D、E）', 'F'])
    expect(headerItem('[[領域/睡眠|睡眠科學]]')).toEqual({ name: '領域/睡眠', label: '睡眠科學', linked: true })
    expect(parseMocHeader('Related: [[Focus]]  Adjacent: Sleep').adjacent).toEqual([{ name: 'Sleep', label: 'Sleep', linked: false }])
  })
})

describe('parseOpenItem／groupOpenItems：待釐清分矛盾、未解、知識缺口並標來源', () => {
  it('reads the kind label and the trailing source', () => {
    expect(parseOpenItem('**矛盾**：A ⟷ B。**待查證**：還沒有足夠的來源。（來源：筆記之間）')).toEqual({ kind: 'contradiction', text: 'A ⟷ B。**待查證**：還沒有足夠的來源。', source: '筆記之間' })
    expect(parseOpenItem('**未解**：番茄鐘有沒有效（[[文章摘錄 番茄鐘的兩種結論]]）。（來源：資料源之間）')).toEqual({ kind: 'unresolved', text: '番茄鐘有沒有效（[[文章摘錄 番茄鐘的兩種結論]]）。', source: '資料源之間' })
    expect(parseOpenItem('知識缺口：能量管理還沒有筆記')).toEqual({ kind: 'gap', text: '能量管理還沒有筆記' })
    expect(parseOpenItem('[[批次]] ↔ [[串流]]：說法不同')).toEqual({ kind: 'other', text: '[[批次]] ↔ [[串流]]：說法不同' })
  })

  it('groups in the order 矛盾 → 未解 → 知識缺口 → 其他 and drops empty groups', () => {
    const groups = groupOpenItems(['**知識缺口**：x（來源：專家）', '其他說明', '**矛盾**：y（來源：筆記之間）', '**知識缺口**：z'])
    expect(groups.map(group => [group.kind, group.items.length])).toEqual([['contradiction', 1], ['gap', 2], ['other', 1]])
  })
})

describe('mocPageView：五區塊的顯示條件', () => {
  it('example 時間管理 (8 notes): all five blocks, chapters in order with relations, parent from the M id', () => {
    const notes = vault(TIME_TITLES, { 切換工作的代價比想像中高: { status: 'disputed' } })
    const parent = parseMoc(fixture('個人效能'), '20 領域/個人效能.md')
    const moc = parseMoc(fixture('時間管理'), '20 領域/時間管理.md')
    const view = mocPageView(moc, notes, byTitle(notes), [parent, moc])
    expect(view.noteCount).toBe(8)
    expect(view.parent).toEqual({ name: '個人效能', label: '個人效能', linked: true })
    expect(view.adjacent.map(item => item.name)).toEqual(['睡眠科學', '決策疲勞'])
    expect(view.position).toBe('「有限的時間和注意力，怎麼分配給真正重要的事？」')
    expect(view.start).toHaveLength(4) // 引導句＋3 則
    expect(view.chapters.map(chapter => [chapter.title, chapter.count])).toEqual([['決定做什麼', 3], ['什麼時候做', 2], ['怎麼保持專注', 1], ['回顧與調整', 2]])
    expect(view.chapters[0].notes[1]).toMatchObject({ title: '重要但不緊急的事，不排進行程就不會發生', relation: '為什麼待辦清單不夠，要排進時間', path: '知識/重要但不緊急的事，不排進行程就不會發生.md' })
    expect(view.chapters[2].notes[0].status).toBe('disputed')
    expect(view.conclusions).toHaveLength(3)
    expect(view.open!.map(group => [group.kind, group.items.length])).toEqual([['contradiction', 1], ['unresolved', 2], ['gap', 1]])
    expect(view.open![1].items[1].source).toContain('你 11/18 在對話中問過')
    expect(view.owner).toBe('Ivy · 時間管理專家')
  })

  it('example 專注力 (1 note): no 從這裡開始 / 重點結論, 待釐清 still shown', () => {
    const notes = vault(['切換工作的代價比想像中高'])
    const view = mocPageView(parseMoc(fixture('專注力')), notes, byTitle(notes))
    expect(view.start).toBeNull()
    expect(view.conclusions).toBeNull()
    expect(view.open).toEqual([{ kind: 'gap', items: [expect.objectContaining({ source: '專家' })] }])
    expect(view.chapters).toHaveLength(1)
    // 沒有 parent M 編號對得到的 MOC 時，退回頁首的連結。
    expect(view.parent?.name).toBe('個人效能')
  })

  it('從這裡開始 needs 6 formal notes — 5 is not enough, and an empty block never shows', () => {
    const lines = (count: number, start = '1. [[n1]]') => [
      '---', 'kind: domain', '---', '# D', '', '## ② 從這裡開始', start, '', '## ③ 章節', '### 一', '<!-- C-20261120-000001-AAAA -->',
      ...Array.from({ length: count }, (_, i) => `- [[n${i + 1}]] ── 說明`), '',
    ].join('\n')
    const notes = vault(Array.from({ length: 6 }, (_, i) => `n${i + 1}`))
    expect(mocPageView(parseMoc(lines(START_HERE_THRESHOLD - 1)), notes, byTitle(notes)).start).toBeNull()
    expect(mocPageView(parseMoc(lines(START_HERE_THRESHOLD)), notes, byTitle(notes)).start).toEqual(['[[n1]]'])
    expect(mocPageView(parseMoc(lines(START_HERE_THRESHOLD, '')), notes, byTitle(notes)).start).toBeNull()
    // 斷鏈不算進 6 則。
    const five = vault(Array.from({ length: 5 }, (_, i) => `n${i + 1}`))
    expect(mocPageView(parseMoc(lines(6)), five, byTitle(five)).start).toBeNull()
  })

  it('尚未分章 goes last and only when it has notes; empty chapters stay; exploring is read from status', () => {
    const raw = (unsorted: string[]) => [
      '---', 'kind: domain', 'status: 探索中', '---', '# 行為經濟學', '',
      '## ③ 章節', '### 尚未分章', '<!-- C-20261120-000009-UNSO -->', ...unsorted, '',
      '### 人為什麼不理性', '<!-- C-20261120-000001-AAAA -->', '',
      '### 怎麼設計選擇', '<!-- C-20261120-000002-BBBB -->', '- [[推力]] ── 預設值的力量', '- [[推力]] ── 重複的第二條', '',
    ].join('\n')
    const notes = vault(['推力', '損失趨避'])
    const empty = mocPageView(parseMoc(raw([])), notes, byTitle(notes))
    expect(empty.exploring).toBe(true)
    expect(empty.chapters.map(chapter => [chapter.title, chapter.notes.length])).toEqual([['人為什麼不理性', 0], ['怎麼設計選擇', 1]])
    const withUnsorted = mocPageView(parseMoc(raw(['- [[損失趨避]]', '- [[不存在]]'])), notes, byTitle(notes))
    const last = withUnsorted.chapters.at(-1)!
    expect(last.unsorted).toBe(true)
    expect(last.notes.map(row => [row.title, row.path, row.relation])).toEqual([['損失趨避', '知識/損失趨避.md', ''], ['不存在', null, '']])
    expect(withUnsorted.noteCount).toBe(2)
  })

  it('a parent MOC shows grown chapters with their MOC markers, which do not count', () => {
    const notes = vault(TIME_TITLES)
    const view = mocPageView(parseMoc(fixture('個人效能')), notes, byTitle(notes))
    expect(view.chapters[0]).toMatchObject({ title: '時間管理', grownInto: '時間管理', count: 0 })
    expect(view.chapters[0].notes[0]).toMatchObject({ marker: '時間管理', reference: true })
    expect(view.noteCount).toBe(0)
    expect(view.start).toBeNull()
  })
})

describe('legacyPageView：還沒有 MOC 檔的舊領域', () => {
  it('maps overview → ①, members → 尚未分章, 矛盾與未解問題 → ⑤', () => {
    const view = legacyPageView(
      { summary: '總覽', coreConcepts: ['x'], keyConclusions: [], openQuestions: ['[[a]] ↔ [[b]]'] },
      [{ path: 'k/a.md', title: 'A', summary: '', status: 'valid' }],
      '工程',
    )
    expect(view).toMatchObject({ position: '總覽', start: null, conclusions: null, parent: { name: '工程' }, noteCount: 1 })
    expect(view.chapters).toEqual([expect.objectContaining({ unsorted: true, count: 1 })])
    expect(view.open).toEqual([{ kind: 'other', items: [{ kind: 'other', text: '[[a]] ↔ [[b]]' }] }])
    expect(legacyPageView({ summary: '', coreConcepts: [], keyConclusions: [], openQuestions: [] }, []).chapters).toEqual([])
  })
})

describe('未歸屬與搜尋', () => {
  const notes = [
    note('k/a.md', { type: 'knowledge', title: '番茄鐘', summary: '25 分鐘' }),
    note('k/b.md', { type: 'knowledge', title: '睡眠債', status: 'disputed' }),
    note('k/c.md', { type: 'knowledge', title: '已收錄' }),
    note('r/log.md', { type: 'log', title: '日誌' }),
    note('20 領域/X.md', { type: 'knowledge', kind: 'domain', title: 'X' }),
    note('k/none.md', null),
  ]

  it('unassignedNotes: knowledge notes not in any domain, sorted by title', () => {
    const list = unassignedNotes(notes, new Set(['k/c.md']))
    expect(list.map(item => item.title)).toEqual(['番茄鐘', '睡眠債'].sort((a, b) => a.localeCompare(b, 'zh-Hant')))
    expect(list.find(item => item.path === 'k/b.md')?.status).toBe('disputed')
    expect(list.find(item => item.path === 'k/a.md')?.summary).toBe('25 分鐘')
  })

  it('filterNotes: every term must match the title, summary or body; case-insensitive', () => {
    const list = unassignedNotes(notes, new Set())
    const bodies = new Map([['k/b.md', '欠下的睡眠 Debt 會累積']])
    expect(filterNotes(list, '').length).toBe(3)
    expect(filterNotes(list, '番茄').map(item => item.path)).toEqual(['k/a.md'])
    expect(filterNotes(list, '25').map(item => item.path)).toEqual(['k/a.md'])
    expect(filterNotes(list, 'debt', bodies).map(item => item.path)).toEqual(['k/b.md'])
    expect(filterNotes(list, '睡眠 累積', bodies).map(item => item.path)).toEqual(['k/b.md'])
    expect(filterNotes(list, '睡眠 番茄', bodies)).toEqual([])
  })

  it('searchableBody drops the frontmatter', () => {
    expect(searchableBody('---\ntitle: secret\n---\n# 內文\n')).toBe('# 內文\n')
  })
})

describe('explore：探索入口交給 69.13 註冊的處理函式', () => {
  it('returns false until a handler is registered, then forwards the request', () => {
    expect(requestExplore({ origin: 'unassigned', notePaths: ['k/a.md'] })).toBe(false)
    const handler = vi.fn()
    const off = setExploreHandler(handler)
    expect(requestExplore({ origin: 'adjacent', domainId: 'M-1', domainName: '時間管理', topics: ['睡眠科學'] })).toBe(true)
    expect(handler).toHaveBeenCalledWith({ origin: 'adjacent', domainId: 'M-1', domainName: '時間管理', topics: ['睡眠科學'] })
    off()
    expect(requestExplore({ origin: 'unassigned', notePaths: [] })).toBe(false)
  })
})

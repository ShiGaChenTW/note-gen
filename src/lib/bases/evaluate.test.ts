// Phase 2-3b 軌道 A：view 評估（filters、欄位、formulas、排序、limit、錯誤不中斷）
import { describe, expect, it } from 'vitest'
import type { IndexedLink, IndexedNote } from '@/lib/vault-index/index-note'
import { parseBase } from './format'
import {
  cellValue,
  columnLabel,
  DEFAULT_LIMIT,
  evaluateBase,
  evaluateBaseView,
  expandTags,
  isCellError,
  makeIndexResolver,
  normalizeProperties,
  sortRows,
  type ViewRow,
} from './evaluate'
import { makeDate } from './expr'

const NOW = new Date(2026, 9, 19, 10, 0)

function link(target: string, line = 0): IndexedLink {
  return { kind: 'wikilink', target, alias: '', heading: '', embed: false, line, context: '' }
}

function note(path: string, frontmatter: Record<string, unknown> | null, extra: Partial<IndexedNote> = {}): IndexedNote {
  return { path, mtime: new Date(2026, 9, 1).getTime(), frontmatter, tasks: [], links: [], aliases: [], tags: [], headings: [], blockIds: [], ...extra }
}

const NOTES: IndexedNote[] = [
  note('Projects/Alpha.md', { status: 'open', priority: 'high', due: '2026-10-22', tags: ['project', 'home/kitchen'], related: '[[Beta]]' },
    { tags: ['project', 'home/kitchen'], links: [link('Beta')], mtime: new Date(2026, 9, 3).getTime() }),
  note('Projects/Beta.md', { status: 'done', priority: 'low', due: '2026-10-20', count: 3, flag: true, tags: 'project, work' },
    { tags: ['project', 'work'], links: [link('Alpha'), link('Nope')], mtime: new Date(2026, 9, 2).getTime() }),
  note('Projects/Gamma.md', { status: 'open', priority: 'high', count: 10, flag: false, tags: ['project'] },
    { tags: ['project'], mtime: new Date(2026, 9, 1).getTime() }),
  note('Journal/2026-10-19.md', { kind: 'daily', count: 1 }, { tags: ['daily'], links: [link('Alpha')] }),
  note('Loose.md', null),
]

const resolve = makeIndexResolver(NOTES.map(n => n.path))

function run(yaml: string, notes = NOTES) {
  const { base, errors } = parseBase(yaml)
  expect(errors).toEqual([])
  return evaluateBase({ base: base!, notes, resolve, now: NOW })
}

function names(rows: ViewRow[]) {
  return rows.map(r => r.name)
}

describe('normalizeProperties／expandTags／makeIndexResolver', () => {
  it('frontmatter 型別：字串、數字、布林、日期字串、清單、[[連結]]、tags 正規化', () => {
    const props = normalizeProperties({ s: 'x', n: 2, b: true, d: '2026-01-01', l: ['a', 1], w: '[[Note]]', tags: '#a, b', alias: 'single', nested: { k: 'v' }, nil: null, date: new Date(5) })
    expect(props).toEqual({ s: 'x', n: 2, b: true, d: '2026-01-01', l: ['a', 1], w: '[[Note]]', tags: ['a', 'b'], alias: ['single'], nested: { k: 'v' }, nil: null, date: makeDate(5) })
    expect(normalizeProperties(null)).toEqual({})
    expect(normalizeProperties({ tags: ['x/y', 3] }).tags).toEqual(['x/y', '3'])
  })

  it('expandTags 含父層、去重', () => {
    expect(expandTags(['a/b/c', 'a', 'd'])).toEqual(['a', 'a/b', 'a/b/c', 'd'])
  })

  it('makeIndexResolver：完整路徑、檔名、同資料夾優先、找不到', () => {
    const r = makeIndexResolver(['A.md', 'X/B.md', 'Y/B.md', 'Y/C.md'])
    expect(r('A', '')).toBe('A.md')
    expect(r('a.md', '')).toBe('A.md')
    expect(r('X/B', '')).toBe('X/B.md')
    expect(r('B', 'Y/C.md')).toBe('Y/B.md')
    expect(r('B', '')).toBe('X/B.md')
    expect(r('Nope', '')).toBeNull()
    expect(r('Z/B', '')).toBeNull()
    expect(r('', 'A.md')).toBe('A.md')
  })
})

describe('evaluateBase：filters', () => {
  it('全域與 view filters 取交集；and/or/not 巢狀', () => {
    const [view] = run(`
filters:
  and:
    - file.hasTag("project")
    - 'status != "done"'
views:
  - type: table
    name: 進行中
    filters: { and: [ 'priority == "high"' ] }
    order: [file.name]
`)
    expect(names(view.rows)).toEqual(['Alpha', 'Gamma'])
    expect(view.total).toBe(2)

    const [nested] = run(`
filters:
  or:
    - and: [ file.hasTag("daily") ]
    - not:
        - file.hasTag("project")
        - 'count > 1'
views: [{ type: table, order: [file.name], sort: [{ property: file.name }] }]
`)
    // daily；或「不是 project 且沒有 count > 1」→ Loose
    expect(names(nested.rows)).toEqual(['2026-10-19', 'Loose'])
  })

  it('清單形式的 filters 視為 and；沒有 filters 顯示全部', () => {
    const [all] = run('views: [{ type: table, order: [file.name] }]')
    expect(all.total).toBe(5)
    const [listed] = run('filters:\n  - file.inFolder("Projects")\n  - flag == true\nviews: [{ type: table, order: [file.name] }]')
    expect(names(listed.rows)).toEqual(['Beta'])
  })

  it('file.* 每個屬性都能在 filter 裡用', () => {
    const q = (expr: string) => names(run(`filters: '${expr}'\nviews: [{ type: table, order: [file.name], sort: [{ property: file.path }] }]`)[0].rows)
    expect(q('file.name == "Alpha"')).toEqual(['Alpha'])
    expect(q('file.basename == "Alpha"')).toEqual(['Alpha'])
    expect(q('file.path == "Projects/Alpha.md"')).toEqual(['Alpha'])
    expect(q('file.folder == "Journal"')).toEqual(['2026-10-19'])
    expect(q('file.ext == "md"')).toHaveLength(5)
    expect(q('file.mtime > date("2026-10-02")')).toEqual(['Alpha'])
    expect(q('file.ctime == file.mtime')).toHaveLength(5)
    expect(q('file.tags.contains("home")')).toEqual(['Alpha'])
    expect(q('file.hasTag("home")')).toEqual(['Alpha'])
    expect(q('file.links.contains("Projects/Alpha.md")')).toEqual(['2026-10-19', 'Beta'])
    expect(q('file.hasLink("Alpha")')).toEqual(['2026-10-19', 'Beta'])
    expect(q('file.backlinks.length > 0')).toEqual(['Alpha', 'Beta'])
    expect(q('file.backlinks.contains("Journal/2026-10-19.md")')).toEqual(['Alpha'])
    expect(q('file.size == 0')).toHaveLength(5)
    expect(q('file.inFolder("Projects")')).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(q('file.hasProperty("count")')).toEqual(['2026-10-19', 'Beta', 'Gamma'])
  })

  it('filter 出錯的筆記視為不符合，錯誤記進 errors 且不重複', () => {
    const [view] = run(`filters: 'count > 1'\nviews: [{ type: table, order: [file.name] }]`)
    expect(names(view.rows)).toEqual(['Beta', 'Gamma'])
    expect(view.errors).toEqual([])

    const [bad] = run(`filters: 'date(due) > today()'\nviews: [{ type: table, order: [file.name] }]`)
    expect(names(bad.rows)).toEqual(['Alpha', 'Beta'])
    // Gamma、Journal、Loose 沒有 due → date(null) 出錯，各記一次
    expect(bad.errors.length).toBe(3)
    expect(bad.errors[0]).toMatch(/^Projects\/Gamma.md：/)

    const [syntax] = run(`filters: 'status =='\nviews: [{ type: table, order: [file.name] }]`)
    expect(syntax.rows).toEqual([])
    expect(syntax.errors).toHaveLength(5)
  })
})

describe('evaluateBase：欄位與 formulas', () => {
  it('order 決定欄位；displayName；frontmatter 各型別的值', () => {
    const [view] = run(`
formulas:
  days_left: 'if(due, (date(due) - today()).days, "")'
  doubled: 'count * 2'
properties:
  note.status: { displayName: 狀態 }
  formula.days_left: { displayName: 剩餘天數 }
  count: { displayName: 數量 }
views:
  - type: table
    order: [file.name, status, due, count, flag, tags, related, formula.days_left, formula.doubled, file.mtime, note.priority]
    sort: [{ property: file.name }]
`)
    expect(view.columns).toEqual([
      { key: 'file.name', label: 'name' },
      { key: 'status', label: '狀態' },
      { key: 'due', label: 'due' },
      { key: 'count', label: '數量' },
      { key: 'flag', label: 'flag' },
      { key: 'tags', label: 'tags' },
      { key: 'related', label: 'related' },
      { key: 'formula.days_left', label: '剩餘天數' },
      { key: 'formula.doubled', label: 'doubled' },
      { key: 'file.mtime', label: 'mtime' },
      { key: 'note.priority', label: 'priority' },
    ])
    const alpha = view.rows.find(r => r.name === 'Alpha')!
    expect(alpha.cells).toMatchObject({
      'file.name': 'Alpha', status: 'open', due: '2026-10-22', count: null, flag: null,
      tags: ['project', 'home/kitchen'], related: '[[Beta]]', 'formula.days_left': 3, 'note.priority': 'high',
    })
    expect(alpha.cells['file.mtime']).toEqual(makeDate(new Date(2026, 9, 3).getTime()))
    expect(isCellError(alpha.cells['formula.doubled'])).toBe(true)
    const beta = view.rows.find(r => r.name === 'Beta')!
    expect(beta.cells).toMatchObject({ count: 3, flag: true, tags: ['project', 'work'], 'formula.doubled': 6, 'formula.days_left': 1 })
    const gamma = view.rows.find(r => r.name === 'Gamma')!
    expect(gamma.cells['formula.days_left']).toBe('')
    expect(gamma.cells.flag).toBe(false)
    expect(view.rows.find(r => r.name === 'Loose')!.cells.status).toBeNull()
  })

  it('formula 可引用別的 formula；循環偵測；一格錯不影響別格', () => {
    const [view] = run(`
formulas:
  a: 'formula.b + 1'
  b: 'count * 10'
  loop1: 'formula.loop2'
  loop2: 'formula.loop1'
  bad: 'nope()'
views: [{ type: table, order: [file.name, formula.a, formula.loop1, formula.bad, status], sort: [{ property: file.name }] }]
`)
    const beta = view.rows.find(r => r.name === 'Beta')!
    expect(beta.cells['formula.a']).toBe(31)
    const loop = beta.cells['formula.loop1']
    expect(isCellError(loop) && loop.message).toMatch(/循環參照：loop1 → loop2 → loop1/)
    const bad = beta.cells['formula.bad']
    expect(isCellError(bad) && bad.message).toMatch(/不支援的函式 nope/)
    expect(beta.cells.status).toBe('done')
    expect(view.errors).toEqual([])
  })

  it('未指定 order：file.name＋出現過的 frontmatter 屬性＋formulas', () => {
    const [view] = run(`formulas:\n  x: '1'\nfilters: file.inFolder("Projects")\nviews: [{ type: table, sort: [{ property: file.name }] }]`)
    expect(view.columns.map(c => c.key)).toEqual(['file.name', 'status', 'priority', 'due', 'tags', 'related', 'count', 'flag', 'formula.x'])
  })

  it('cellValue 與 columnLabel 的對應規則', () => {
    expect(columnLabel('status', { 'note.status': { displayName: '狀' } })).toBe('狀')
    expect(columnLabel('note.status', { status: { displayName: '狀' } })).toBe('狀')
    expect(columnLabel('file.name', {})).toBe('name')
    expect(columnLabel('a.b', {})).toBe('a.b')
    const ctx = { file: { name: 'n', basename: 'n', path: 'n.md', folder: '', ext: 'md', mtime: 1, ctime: 1, tags: [], links: () => [], backlinks: () => [], size: 0 }, properties: { 'a.b': 1 }, formula: () => 2, now: NOW }
    expect(cellValue('a.b', ctx)).toBe(1)
    expect(cellValue('file.name', ctx)).toBe('n')
    expect(cellValue('formula.z', ctx)).toBe(2)
    const err = cellValue('file.zzz', ctx)
    expect(isCellError(err) && err.message).toMatch(/file.zzz/)
  })
})

describe('evaluateBase：排序、limit、view 型別', () => {
  it('多鍵排序；null 不論方向都最後', () => {
    const [asc] = run(`views: [{ type: table, order: [file.name, priority, count], sort: [{ property: priority, direction: ASC }, { property: count, direction: DESC }] }]`)
    expect(names(asc.rows)).toEqual(['Gamma', 'Alpha', 'Beta', '2026-10-19', 'Loose'])
    const [desc] = run(`views: [{ type: table, order: [file.name, count], sort: [{ property: count, direction: DESC }] }]`)
    expect(names(desc.rows)).toEqual(['Gamma', 'Beta', '2026-10-19', 'Alpha', 'Loose'])
    const [byDate] = run(`views: [{ type: table, order: [file.name, due], sort: [{ property: due, direction: ASC }] }]`)
    expect(names(byDate.rows).slice(0, 2)).toEqual(['Beta', 'Alpha'])
    const [byMtime] = run(`views: [{ type: table, order: [file.name], sort: [{ property: file.mtime, direction: DESC }] }]`)
    expect(names(byMtime.rows).slice(0, 3)).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(byMtime.rows[0].cells['file.mtime']).toBeDefined()
  })

  it('sortRows 穩定且錯誤值當 null', () => {
    const rows: ViewRow[] = [
      { path: 'a', name: 'a', cells: { k: 2 } },
      { path: 'b', name: 'b', cells: { k: { type: 'error', message: 'x' } } },
      { path: 'c', name: 'c', cells: { k: 1 } },
      { path: 'd', name: 'd', cells: { k: 1 } },
    ]
    expect(sortRows(rows, [{ property: 'k', direction: 'ASC' }]).map(r => r.name)).toEqual(['c', 'd', 'a', 'b'])
    expect(sortRows(rows, [{ property: 'k', direction: 'DESC' }]).map(r => r.name)).toEqual(['a', 'c', 'd', 'b'])
    expect(sortRows(rows, [])).toBe(rows)
  })

  it('limit：預設 200，超過標記 truncated 並保留 total', () => {
    const many = Array.from({ length: 250 }, (_, i) => note(`N/${String(i).padStart(3, '0')}.md`, { n: i }))
    const [view] = run('views: [{ type: table, order: [file.name, n], sort: [{ property: n, direction: DESC }] }]', many)
    expect(view.rows).toHaveLength(DEFAULT_LIMIT)
    expect(view.total).toBe(250)
    expect(view.truncated).toBe(true)
    expect(view.rows[0].name).toBe('249')
    const [limited] = run('views: [{ type: table, order: [file.name], limit: 2 }]', many)
    expect(limited.rows).toHaveLength(2)
    expect(limited.truncated).toBe(true)
    const [fits] = run('views: [{ type: table, order: [file.name], limit: 500 }]', many)
    expect(fits.truncated).toBe(false)
  })

  it('不支援的 view 型別退回 table，但保留 requestedType；list 保留', () => {
    const views = run('views:\n  - { type: cards, name: C }\n  - { type: list, name: L, order: [file.name] }\n  - { type: table, name: T }')
    expect(views.map(v => [v.type, v.requestedType, v.name])).toEqual([['table', 'cards', 'C'], ['list', 'list', 'L'], ['table', 'table', 'T']])
  })

  it('evaluateBaseView 的 sortOverride 覆蓋 view.sort（先排序再 limit）', () => {
    const { base } = parseBase('views: [{ type: table, order: [file.name, count], sort: [{ property: count, direction: DESC }], limit: 2 }]')
    const input = { base: base!, notes: NOTES, resolve, now: NOW }
    expect(names(evaluateBaseView(input, base!.views[0]).rows)).toEqual(['Gamma', 'Beta'])
    expect(names(evaluateBaseView(input, base!.views[0], { sortOverride: [{ property: 'file.name', direction: 'ASC' }] }).rows)).toEqual(['2026-10-19', 'Alpha'])
    expect(names(evaluateBaseView(input, base!.views[0], { sortOverride: [] }).rows)).toEqual(['Gamma', 'Beta'])
  })

  it('today() 由 now 注入', () => {
    const { base } = parseBase(`formulas:\n  left: '(date(due) - today()).days'\nfilters: due\nviews: [{ type: table, order: [file.name, formula.left], sort: [{ property: file.name }] }]`)
    const later = evaluateBase({ base: base!, notes: NOTES, resolve, now: new Date(2026, 9, 21) })[0]
    expect(later.rows.map(r => r.cells['formula.left'])).toEqual([1, -1])
  })
})

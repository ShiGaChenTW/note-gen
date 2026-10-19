// Phase 2-3b 軌道 A：Bases 運算式的 tokenizer／parser／求值
import { describe, expect, it } from 'vitest'
import {
  compareForSort,
  type EvalContext,
  evaluateExpr,
  ExprError,
  type FileFacts,
  formatDate,
  formatValue,
  isDate,
  makeDate,
  parseDateString,
  parseExpr,
  tokenize,
  truthy,
  type Value,
} from './expr'

const NOW = new Date(2026, 9, 19, 14, 30) // 2026-10-19 14:30 本地

function file(overrides: Partial<FileFacts> = {}): FileFacts {
  return {
    name: 'Note',
    basename: 'Note',
    path: 'Projects/Note.md',
    folder: 'Projects',
    ext: 'md',
    mtime: new Date(2026, 9, 1).getTime(),
    ctime: new Date(2026, 9, 1).getTime(),
    tags: ['project', 'project/active', 'home'],
    links: () => ['Other.md', 'Sub/Deep.md'],
    backlinks: () => ['Index.md'],
    size: 0,
    ...overrides,
  }
}

function ctx(properties: Record<string, Value> = {}, overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    file: file(),
    properties,
    formula: (name) => {
      if (name === 'double') return 2 * Number(properties.n ?? 0)
      throw new ExprError(`沒有這個 formula：${name}`)
    },
    now: NOW,
    ...overrides,
  }
}

const ev = (src: string, c: EvalContext = ctx()) => evaluateExpr(src, c)

describe('tokenize', () => {
  it('每種 token', () => {
    const kinds = tokenize('a.b("x", \'y\') == 1.5 && !c || [1, 2] >= -3 != <= > <').map(t => `${t.kind}:${t.value}`)
    expect(kinds).toEqual([
      'ident:a', 'punct:.', 'ident:b', 'punct:(', 'string:x', 'punct:,', 'string:y', 'punct:)',
      'punct:==', 'number:1.5', 'punct:&&', 'punct:!', 'ident:c', 'punct:||',
      'punct:[', 'number:1', 'punct:,', 'number:2', 'punct:]', 'punct:>=', 'punct:-', 'number:3',
      'punct:!=', 'punct:<=', 'punct:>', 'punct:<', 'eof:',
    ])
  })

  it('字串跳脫與未結尾', () => {
    expect(tokenize('"a\\"b\\n"')[0]).toMatchObject({ kind: 'string', value: 'a"b\n' })
    expect(() => tokenize('"abc')).toThrow(ExprError)
    expect(() => tokenize('a @ b')).toThrow(/無法辨識/)
  })

  it('識別字可含連字號與中文；x-1 仍是減法', () => {
    expect(tokenize('due-date').map(t => t.value)).toEqual(['due-date', ''])
    expect(tokenize('狀態 == "完成"').map(t => t.kind)).toEqual(['ident', 'punct', 'string', 'eof'])
    expect(tokenize('x-1').map(t => t.value)).toEqual(['x', '-', 1, ''])
  })
})

describe('parseExpr：每種節點', () => {
  it('literal、list、ident、member、call、method、unary、binary', () => {
    expect(parseExpr('1')).toEqual({ type: 'literal', value: 1 })
    expect(parseExpr('"s"')).toEqual({ type: 'literal', value: 's' })
    expect(parseExpr('true')).toEqual({ type: 'literal', value: true })
    expect(parseExpr('null')).toEqual({ type: 'literal', value: null })
    expect(parseExpr('[1, "a",]')).toEqual({ type: 'list', items: [{ type: 'literal', value: 1 }, { type: 'literal', value: 'a' }] })
    expect(parseExpr('status')).toEqual({ type: 'ident', name: 'status' })
    expect(parseExpr('file.name')).toEqual({ type: 'member', object: { type: 'ident', name: 'file' }, name: 'name' })
    expect(parseExpr('date(due)')).toEqual({ type: 'call', name: 'date', args: [{ type: 'ident', name: 'due' }] })
    expect(parseExpr('file.hasTag("a")')).toEqual({ type: 'method', object: { type: 'ident', name: 'file' }, name: 'hasTag', args: [{ type: 'literal', value: 'a' }] })
    expect(parseExpr('!done')).toEqual({ type: 'unary', op: '!', arg: { type: 'ident', name: 'done' } })
    expect(parseExpr('-3')).toEqual({ type: 'unary', op: '-', arg: { type: 'literal', value: 3 } })
    expect(parseExpr('a == b')).toEqual({ type: 'binary', op: '==', left: { type: 'ident', name: 'a' }, right: { type: 'ident', name: 'b' } })
  })

  it('優先順序：|| < && < == < < < + < * < unary < postfix', () => {
    const ast = parseExpr('a || b && c == d + e * f')
    expect(ast.type).toBe('binary')
    expect((ast as { op: string }).op).toBe('||')
    const right = (ast as { right: { op: string, right: { op: string, right: { op: string, right: { op: string } } } } }).right
    expect(right.op).toBe('&&')
    expect(right.right.op).toBe('==')
    expect(right.right.right.op).toBe('+')
    expect(right.right.right.right.op).toBe('*')
    expect(ev('1 + 2 * 3')).toBe(7)
    expect(ev('(1 + 2) * 3')).toBe(9)
    expect(ev('-2 * 3')).toBe(-6)
    expect(ev('10 - 2 - 3')).toBe(5)
  })

  it('鏈式成員與方法', () => {
    expect(parseExpr('(date(due) - today()).days').type).toBe('member')
    expect(parseExpr('a.b.c(1).d').type).toBe('member')
  })

  it('語法錯誤', () => {
    expect(() => parseExpr('')).toThrow(/空的/)
    expect(() => parseExpr('1 +')).toThrow(/不完整/)
    expect(() => parseExpr('(1')).toThrow(/預期「\)」/)
    expect(() => parseExpr('1 2')).toThrow(/多餘/)
    expect(() => parseExpr('a.')).toThrow(/名稱/)
  })
})

describe('求值：值與運算子', () => {
  it('比較與邏輯', () => {
    const c = ctx({ status: 'done', n: 3, flag: false, empty: '', list: ['a', 'b'] })
    expect(ev('status == "done"', c)).toBe(true)
    expect(ev('status != "done"', c)).toBe(false)
    expect(ev('n > 2 && n <= 3', c)).toBe(true)
    expect(ev('n < 2 || flag', c)).toBe(false)
    expect(ev('!flag', c)).toBe(true)
    expect(ev('!empty', c)).toBe(true)
    expect(ev('missing == null', c)).toBe(true)
    expect(ev('n == "3"', c)).toBe(true)
    expect(ev('list == ["a", "b"]', c)).toBe(true)
    expect(ev('"b" > "a"', c)).toBe(true)
  })

  it('算術與字串串接', () => {
    expect(ev('1 + 2')).toBe(3)
    expect(ev('"a" + 1')).toBe('a1')
    expect(ev('7 / 2')).toBe(3.5)
    expect(ev('[1] + [2]')).toEqual([1, 2])
    expect(() => ev('1 / 0')).toThrow(/除以零/)
    expect(() => ev('"a" * 2')).toThrow(ExprError)
    expect(() => ev('[1] < 2')).toThrow(/需要數字/)
    expect(() => ev('true < "a"')).toThrow(/無法用/)
    // 缺少的屬性（null）比較一律不成立、不報錯
    expect(ev('missing > 1')).toBe(false)
    expect(ev('missing <= 1')).toBe(false)
    expect(ev('1 < missing')).toBe(false)
  })

  it('truthy', () => {
    expect(truthy(null)).toBe(false)
    expect(truthy('')).toBe(false)
    expect(truthy(0)).toBe(false)
    expect(truthy([])).toBe(false)
    expect(truthy('x')).toBe(true)
    expect(truthy(makeDate(0))).toBe(true)
  })
})

describe('求值：file.*', () => {
  it('每個屬性', () => {
    expect(ev('file.name')).toBe('Note')
    expect(ev('file.basename')).toBe('Note')
    expect(ev('file.path')).toBe('Projects/Note.md')
    expect(ev('file.folder')).toBe('Projects')
    expect(ev('file.ext')).toBe('md')
    expect(ev('file.mtime')).toEqual(makeDate(new Date(2026, 9, 1).getTime()))
    expect(ev('file.ctime')).toEqual(makeDate(new Date(2026, 9, 1).getTime()))
    expect(ev('file.tags')).toEqual(['project', 'project/active', 'home'])
    expect(ev('file.links')).toEqual(['Other.md', 'Sub/Deep.md'])
    expect(ev('file.backlinks')).toEqual(['Index.md'])
    expect(ev('file.size')).toBe(0)
    expect(() => ev('file.nope')).toThrow(/不支援 file.nope/)
    expect(() => ev('file')).toThrow(/屬性/)
  })

  it('方法：hasTag（任一、含巢狀父層）、inFolder（含子資料夾）、hasLink、hasProperty', () => {
    expect(ev('file.hasTag("project")')).toBe(true)
    expect(ev('file.hasTag("#home")')).toBe(true)
    expect(ev('file.hasTag("nope", "home")')).toBe(true)
    expect(ev('file.hasTag("nope")')).toBe(false)
    expect(ev('file.inFolder("Projects")')).toBe(true)
    expect(ev('file.inFolder("Proj")')).toBe(false)
    expect(ev('file.inFolder("Projects/Sub")', ctx({}, { file: file({ folder: 'Projects/Sub/Deep' }) }))).toBe(true)
    expect(ev('file.inFolder("")')).toBe(true)
    expect(ev('file.hasLink("Other")')).toBe(true)
    expect(ev('file.hasLink("Deep")')).toBe(true)
    expect(ev('file.hasLink("Sub/Deep.md")')).toBe(true)
    expect(ev('file.hasLink("Nope")')).toBe(false)
    expect(ev('file.hasProperty("status")', ctx({ status: null }))).toBe(true)
    expect(ev('file.hasProperty("status")')).toBe(false)
    expect(() => ev('file.nope()')).toThrow(/不支援 file.nope\(\)/)
  })

  it('file.mtime 可與日期比較', () => {
    expect(ev('file.mtime < today()')).toBe(true)
    expect(ev('file.mtime >= date("2026-10-01")')).toBe(true)
  })
})

describe('求值：note.* 與 formula.*', () => {
  it('note.xxx 與裸名稱是同一個屬性；沒有時 null', () => {
    const c = ctx({ status: 'open', n: 4, 'due-date': '2026-12-01' })
    expect(ev('note.status', c)).toBe('open')
    expect(ev('status', c)).toBe('open')
    expect(ev('note.nope', c)).toBeNull()
    expect(ev('nope', c)).toBeNull()
    expect(ev('due-date', c)).toBe('2026-12-01')
    expect(ev('formula.double', c)).toBe(8)
    expect(() => ev('formula.nope', c)).toThrow(/沒有這個 formula/)
  })

  it('巢狀物件成員', () => {
    expect(ev('meta.author', ctx({ meta: { author: 'Scott' } }))).toBe('Scott')
    expect(ev('meta.nope', ctx({ meta: { author: 'Scott' } }))).toBeNull()
    expect(ev('nothing.x')).toBeNull()
    expect(() => ev('n.x', ctx({ n: 1 }))).toThrow(/沒有 .x/)
  })
})

describe('求值：函式', () => {
  it('if 只算選中的分支', () => {
    expect(ev('if(true, 1, 2)')).toBe(1)
    expect(ev('if(false, 1, 2)')).toBe(2)
    expect(ev('if(false, 1)')).toBeNull()
    expect(ev('if(due, date(due), "")', ctx({}))).toBe('')
    expect(() => ev('if(1)')).toThrow(/if 需要/)
  })

  it('date／today／now', () => {
    const d = ev('date("2026-10-19")')
    expect(isDate(d) && d.dateOnly).toBe(true)
    expect(ev('today()')).toEqual(makeDate(new Date(2026, 9, 19).getTime(), true))
    expect(ev('now()')).toEqual(makeDate(NOW.getTime()))
    expect(ev('date("2026-10-19 09:05")')).toEqual(makeDate(new Date(2026, 9, 19, 9, 5).getTime()))
    expect(ev('date(due)', ctx({ due: '2026-10-20' }))).toEqual(makeDate(new Date(2026, 9, 20).getTime(), true))
    expect(() => ev('date("not a date")')).toThrow(/不是日期/)
    expect(() => ev('date(null)')).toThrow(/需要日期/)
    expect(parseDateString('2026-02-30')).toBeNull()
    expect(parseDateString('2026-10-19T00:00:00Z')?.time).toBe(Date.UTC(2026, 9, 19))
  })

  it('日期相減得時間差；.days 取整數天；日期 ± 時間差', () => {
    const c = ctx({ due: '2026-10-22' })
    expect(ev('(date(due) - today()).days', c)).toBe(3)
    expect(ev('(today() - date(due)).days', c)).toBe(-3)
    expect(ev('(date("2026-10-19 14:30") - today()).hours')).toBe(14)
    expect(ev('(date("2026-10-19 14:30") - today()).days')).toBe(0)
    expect(ev('date(due) - today() > today() - date(due)', c)).toBe(true)
    expect(ev('today() + (date(due) - today()) == date(due)', c)).toBe(true)
    expect(ev('date(due) - (date(due) - today()) == today()', c)).toBe(true)
    expect(() => ev('(date(due) - today()).weeks', c)).toThrow(/時間差沒有/)
  })

  it('日期成員', () => {
    expect(ev('today().year')).toBe(2026)
    expect(ev('today().month')).toBe(10)
    expect(ev('today().day')).toBe(19)
  })

  it('number／string／lower／upper／round／min／max', () => {
    expect(ev('number("3.5")')).toBe(3.5)
    expect(ev('number(true)')).toBe(1)
    expect(ev('number(null)')).toBeNull()
    expect(() => ev('number("x")')).toThrow(/需要數字/)
    expect(ev('string(3)')).toBe('3')
    expect(ev('string(["a", "b"])')).toBe('a, b')
    expect(ev('lower("ABC")')).toBe('abc')
    expect(ev('upper("abc")')).toBe('ABC')
    expect(ev('"Abc".lower()')).toBe('abc')
    expect(ev('round(3.14159, 2)')).toBe(3.14)
    expect(ev('round(2.5)')).toBe(3)
    expect(ev('min(3, 1, 2)')).toBe(1)
    expect(ev('max([3, 1, 2])')).toBe(3)
    expect(() => ev('min()')).toThrow(/至少/)
  })

  it('contains／startsWith／endsWith／length／join，含方法寫法', () => {
    const c = ctx({ tags: ['a', 'b'], title: 'Hello world' })
    expect(ev('contains(tags, "a")', c)).toBe(true)
    expect(ev('tags.contains("c")', c)).toBe(false)
    expect(ev('title.contains("world")', c)).toBe(true)
    expect(ev('contains(null, "x")', c)).toBe(false)
    expect(() => ev('contains(1, "x")', c)).toThrow(/需要清單或字串/)
    expect(ev('title.startsWith("Hello")', c)).toBe(true)
    expect(ev('endsWith(title, "x")', c)).toBe(false)
    expect(ev('tags.length', c)).toBe(2)
    expect(ev('length(title)', c)).toBe(11)
    expect(ev('length(null)', c)).toBe(0)
    expect(ev('join(tags, "/")', c)).toBe('a/b')
    expect(ev('tags.join()', c)).toBe('a, b')
    expect(() => ev('join("x", ",")', c)).toThrow(/需要清單/)
  })

  it('不支援的函式與方法', () => {
    expect(() => ev('nope(1)')).toThrow(/不支援的函式 nope/)
    expect(() => ev('"x".nope()')).toThrow(/不支援的方法 .nope/)
  })
})

describe('格式化與排序比較', () => {
  it('formatValue', () => {
    expect(formatValue(null)).toBe('')
    expect(formatValue('s')).toBe('s')
    expect(formatValue(3)).toBe('3')
    expect(formatValue(1 / 3)).toBe('0.333')
    expect(formatValue(true)).toBe('✓')
    expect(formatValue(false)).toBe('')
    expect(formatValue(['a', 1])).toBe('a, 1')
    expect(formatValue({ type: 'duration', ms: 3 * 86400000 })).toBe('3d')
    expect(formatValue({ a: 1 })).toBe('{"a":1}')
    expect(formatDate(makeDate(new Date(2026, 0, 5).getTime(), true))).toBe('2026-01-05')
    expect(formatDate(makeDate(new Date(2026, 0, 5, 9, 7).getTime()))).toBe('2026-01-05 09:07')
    expect(formatDate(makeDate(new Date(2026, 0, 5).getTime()))).toBe('2026-01-05')
  })

  it('compareForSort：數字／日期／字串各自比，null 最後', () => {
    expect(compareForSort(1, 2)).toBeLessThan(0)
    expect(compareForSort(makeDate(2), makeDate(1))).toBeGreaterThan(0)
    expect(compareForSort('b', 'a')).toBeGreaterThan(0)
    expect(compareForSort('a2', 'a10')).toBeLessThan(0)
    expect(compareForSort(null, 'a')).toBeGreaterThan(0)
    expect(compareForSort('a', null)).toBeLessThan(0)
    expect(compareForSort(null, null)).toBe(0)
    expect(compareForSort(1, 'a')).toBeLessThan(0)
    expect(compareForSort(false, true)).toBeLessThan(0)
  })
})

/**
 * Fork (Phase 2-3b, 軌道 A)：Obsidian Bases 運算式語言的子集。
 * 自己寫的 tokenizer＋遞迴下降 parser＋求值器，純函式、無 I/O、不引入套件。
 *
 * 值：字串、數字、布林、null、清單、日期（`date()`／`today()`／`now()`／`file.mtime`）、
 * 時間差（兩個日期相減，`.days`／`.hours`）、物件（frontmatter 的巢狀值）。
 * 屬性：`file.*`、`note.xxx` 或裸 `xxx`（frontmatter）、`formula.xxx`（同檔的 formulas）。
 * 運算子：`== != < > <= >= && || ! + - * /`、括號、`.` 成員與方法呼叫。
 * 函式最小集見 FUNCTIONS；`x.fn(args)` 等同 `fn(x, args)`，`file.hasTag()` 等四個是 file 專用方法。
 * 型別錯誤或不支援的函式丟 ExprError，由評估層接住顯示在該格，不讓整個 view 失敗。
 */

// ---------------------------------------------------------------------------
// 值

export interface BaseDate {
  type: 'date'
  /** 毫秒 timestamp */
  time: number
  /** 原字串只有日期沒有時間（顯示成 YYYY-MM-DD） */
  dateOnly: boolean
}

export interface BaseDuration {
  type: 'duration'
  /** 毫秒 */
  ms: number
}

export type Value =
  | string
  | number
  | boolean
  | null
  | BaseDate
  | BaseDuration
  | Value[]
  | { [key: string]: Value }

export class ExprError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExprError'
  }
}

export function isDate(value: Value): value is BaseDate {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as BaseDate).type === 'date'
}

export function isDuration(value: Value): value is BaseDuration {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as BaseDuration).type === 'duration'
}

function isPlainObject(value: Value): value is { [key: string]: Value } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isDate(value) && !isDuration(value)
}

export function makeDate(time: number, dateOnly = false): BaseDate {
  return { type: 'date', time, dateOnly }
}

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

/** 本地時區的當天 0 點。 */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * 把字串轉成日期：`YYYY-MM-DD`（本地午夜、dateOnly）、`YYYY-MM-DD HH:mm[:ss]`、ISO 字串。
 * 其他格式交給 Date.parse；都不行回傳 null。
 */
export function parseDateString(text: string): BaseDate | null {
  const trimmed = text.trim()
  const m = DATE_RE.exec(trimmed)
  if (m) {
    const [, y, mo, d, h, mi, s, zone] = m
    if (!h) {
      const local = new Date(Number(y), Number(mo) - 1, Number(d))
      if (local.getMonth() !== Number(mo) - 1 || local.getDate() !== Number(d)) return null
      return makeDate(local.getTime(), true)
    }
    if (zone) {
      const time = Date.parse(trimmed.replace(' ', 'T'))
      return Number.isNaN(time) ? null : makeDate(time)
    }
    const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0))
    return Number.isNaN(local.getTime()) ? null : makeDate(local.getTime())
  }
  if (!/\d{4}/.test(trimmed)) return null
  const time = Date.parse(trimmed)
  return Number.isNaN(time) ? null : makeDate(time)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 顯示用：`YYYY-MM-DD`，有時間時 `YYYY-MM-DD HH:mm`。 */
export function formatDate(value: BaseDate): string {
  const d = new Date(value.time)
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (value.dateOnly || (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0)) return day
  return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 顯示用的純文字；清單用 `, ` 串起、物件用 JSON。 */
export function formatValue(value: Value): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000)
  if (typeof value === 'boolean') return value ? '✓' : ''
  if (isDate(value)) return formatDate(value)
  if (isDuration(value)) return `${Math.trunc(value.ms / MS_PER_DAY)}d`
  if (Array.isArray(value)) return value.map(formatValue).join(', ')
  return JSON.stringify(value)
}

/** 布林判斷：null、空字串、0、false、空清單為假。 */
export function truthy(value: Value): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value !== ''
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.length > 0
  return true
}

function typeName(value: Value): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'object') return (value as BaseDate).type === 'date' ? 'date' : (value as BaseDuration).type === 'duration' ? 'duration' : 'object'
  return typeof value
}

// ---------------------------------------------------------------------------
// Tokenizer

export type Token =
  | { kind: 'number', value: number, pos: number }
  | { kind: 'string', value: string, pos: number }
  | { kind: 'ident', value: string, pos: number }
  | { kind: 'punct', value: string, pos: number }
  | { kind: 'eof', value: '', pos: number }

const PUNCTS = ['==', '!=', '<=', '>=', '&&', '||', '(', ')', '[', ']', ',', '.', '+', '-', '*', '/', '!', '<', '>']

export function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      let text = ''
      let closed = false
      while (j < src.length) {
        const c = src[j]
        if (c === '\\' && j + 1 < src.length) {
          const next = src[j + 1]
          text += next === 'n' ? '\n' : next === 't' ? '\t' : next
          j += 2
          continue
        }
        if (c === quote) { closed = true; j++; break }
        text += c
        j++
      }
      if (!closed) throw new ExprError(`字串沒有結尾引號（位置 ${i}）`)
      out.push({ kind: 'string', value: text, pos: i })
      i = j
      continue
    }
    // 數字：整數、小數；前面是 `.` 成員存取時不算（例如 list.0 不支援）
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? '') && !(out.length && out[out.length - 1].kind === 'ident'))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!
      out.push({ kind: 'number', value: Number(m[0]), pos: i })
      i += m[0].length
      continue
    }
    if (/[\p{L}_$]/u.test(ch)) {
      // 識別字允許「連字號＋字母」（frontmatter 常見 `due-date`）；`x-1`、`a - b` 仍是減法
      const m = /^[\p{L}_$][\p{L}\p{N}_$]*(?:-[\p{L}_][\p{L}\p{N}_$]*)*/u.exec(src.slice(i))!
      out.push({ kind: 'ident', value: m[0], pos: i })
      i += m[0].length
      continue
    }
    const punct = PUNCTS.find(p => src.startsWith(p, i))
    if (!punct) throw new ExprError(`無法辨識的字元「${ch}」（位置 ${i}）`)
    out.push({ kind: 'punct', value: punct, pos: i })
    i += punct.length
  }
  out.push({ kind: 'eof', value: '', pos: src.length })
  return out
}

// ---------------------------------------------------------------------------
// AST 與 parser

export type Ast =
  | { type: 'literal', value: string | number | boolean | null }
  | { type: 'list', items: Ast[] }
  | { type: 'ident', name: string }
  | { type: 'member', object: Ast, name: string }
  | { type: 'call', name: string, args: Ast[] }
  | { type: 'method', object: Ast, name: string, args: Ast[] }
  | { type: 'unary', op: '!' | '-', arg: Ast }
  | { type: 'binary', op: string, left: Ast, right: Ast }

class Parser {
  private i = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.i] }
  private next(): Token { return this.tokens[this.i++] }
  private isPunct(value: string): boolean {
    const t = this.peek()
    return t.kind === 'punct' && t.value === value
  }
  private expectPunct(value: string): void {
    if (!this.isPunct(value)) throw new ExprError(`預期「${value}」，但遇到「${this.peek().value || '結尾'}」`)
    this.next()
  }

  parse(): Ast {
    const ast = this.or()
    if (this.peek().kind !== 'eof') throw new ExprError(`多餘的內容「${this.peek().value}」`)
    return ast
  }

  private or(): Ast {
    let left = this.and()
    while (this.isPunct('||')) { this.next(); left = { type: 'binary', op: '||', left, right: this.and() } }
    return left
  }

  private and(): Ast {
    let left = this.equality()
    while (this.isPunct('&&')) { this.next(); left = { type: 'binary', op: '&&', left, right: this.equality() } }
    return left
  }

  private equality(): Ast {
    let left = this.comparison()
    while (this.isPunct('==') || this.isPunct('!=')) {
      const op = String(this.next().value)
      left = { type: 'binary', op, left, right: this.comparison() }
    }
    return left
  }

  private comparison(): Ast {
    let left = this.additive()
    while (this.isPunct('<') || this.isPunct('>') || this.isPunct('<=') || this.isPunct('>=')) {
      const op = String(this.next().value)
      left = { type: 'binary', op, left, right: this.additive() }
    }
    return left
  }

  private additive(): Ast {
    let left = this.multiplicative()
    while (this.isPunct('+') || this.isPunct('-')) {
      const op = String(this.next().value)
      left = { type: 'binary', op, left, right: this.multiplicative() }
    }
    return left
  }

  private multiplicative(): Ast {
    let left = this.unary()
    while (this.isPunct('*') || this.isPunct('/')) {
      const op = String(this.next().value)
      left = { type: 'binary', op, left, right: this.unary() }
    }
    return left
  }

  private unary(): Ast {
    if (this.isPunct('!')) { this.next(); return { type: 'unary', op: '!', arg: this.unary() } }
    if (this.isPunct('-')) { this.next(); return { type: 'unary', op: '-', arg: this.unary() } }
    return this.postfix()
  }

  private args(): Ast[] {
    this.expectPunct('(')
    const args: Ast[] = []
    if (this.isPunct(')')) { this.next(); return args }
    for (;;) {
      args.push(this.or())
      if (this.isPunct(',')) { this.next(); continue }
      this.expectPunct(')')
      return args
    }
  }

  private postfix(): Ast {
    let node = this.primary()
    for (;;) {
      if (this.isPunct('.')) {
        this.next()
        const t = this.next()
        if (t.kind !== 'ident') throw new ExprError(`「.」後面要接名稱`)
        if (this.isPunct('(')) node = { type: 'method', object: node, name: t.value, args: this.args() }
        else node = { type: 'member', object: node, name: t.value }
        continue
      }
      if (this.isPunct('(') && node.type === 'ident') {
        node = { type: 'call', name: node.name, args: this.args() }
        continue
      }
      return node
    }
  }

  private primary(): Ast {
    const t = this.next()
    if (t.kind === 'number') return { type: 'literal', value: t.value }
    if (t.kind === 'string') return { type: 'literal', value: t.value }
    if (t.kind === 'ident') {
      if (t.value === 'true') return { type: 'literal', value: true }
      if (t.value === 'false') return { type: 'literal', value: false }
      if (t.value === 'null') return { type: 'literal', value: null }
      return { type: 'ident', name: t.value }
    }
    if (t.kind === 'punct') {
      if (t.value === '(') {
        const inner = this.or()
        this.expectPunct(')')
        return inner
      }
      if (t.value === '[') {
        const items: Ast[] = []
        if (this.isPunct(']')) { this.next(); return { type: 'list', items } }
        for (;;) {
          items.push(this.or())
          if (this.isPunct(',')) { this.next(); if (this.isPunct(']')) { this.next(); return { type: 'list', items } } continue }
          this.expectPunct(']')
          return { type: 'list', items }
        }
      }
    }
    throw new ExprError(t.kind === 'eof' ? '運算式不完整' : `預期值，但遇到「${t.value}」`)
  }
}

export function parseExpr(src: string): Ast {
  if (!src.trim()) throw new ExprError('運算式是空的')
  return new Parser(tokenize(src)).parse()
}

// ---------------------------------------------------------------------------
// 求值

/** 一篇筆記在運算式裡看得到的 `file.*` 事實；由評估層從索引組出來。 */
export interface FileFacts {
  /** 不含副檔名的檔名（Obsidian 表格「Name」欄顯示的字） */
  name: string
  basename: string
  path: string
  folder: string
  ext: string
  mtime: number
  ctime: number
  /** 含巢狀父層（`a/b` → `a`、`a/b`） */
  tags: string[]
  /** 連出：解析後的路徑 */
  links: () => string[]
  /** 連入：來源路徑 */
  backlinks: () => string[]
  size: number
}

export interface EvalContext {
  file: FileFacts
  /** frontmatter（已正規化：tags／aliases 是清單） */
  properties: Record<string, Value>
  /** 同檔的 formulas；由評估層負責循環偵測 */
  formula: (name: string) => Value
  now: Date
}

function expectNumber(value: Value, what: string): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  throw new ExprError(`${what} 需要數字，得到 ${typeName(value)}`)
}

function expectString(value: Value, what: string): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return ''
  throw new ExprError(`${what} 需要字串，得到 ${typeName(value)}`)
}

function toDate(value: Value, what: string): BaseDate {
  if (isDate(value)) return value
  if (typeof value === 'string') {
    const parsed = parseDateString(value)
    if (parsed) return parsed
    throw new ExprError(`${what}：「${value}」不是日期`)
  }
  if (typeof value === 'number') return makeDate(value)
  throw new ExprError(`${what} 需要日期，得到 ${typeName(value)}`)
}

function valuesEqual(a: Value, b: Value): boolean {
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return false
  if (isDate(a) || isDate(b)) {
    try { return toDate(a, '==').time === toDate(b, '==').time } catch { return false }
  }
  if (isDuration(a) && isDuration(b)) return a.ms === b.ms
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => valuesEqual(item, b[i]))
  if (typeof a === 'number' && typeof b === 'string') return b.trim() !== '' && Number(b) === a
  if (typeof a === 'string' && typeof b === 'number') return a.trim() !== '' && Number(a) === b
  if (typeof a !== typeof b) return false
  if (isPlainObject(a) && isPlainObject(b)) return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

/** 大小比較：數字、字串、日期各自比；日期對字串會先把字串當日期解析。任一邊是 null 時回傳 NaN（所有比較都不成立，照 Obsidian）。 */
function compareOrdered(a: Value, b: Value, op: string): number {
  if (a === null || a === undefined || b === null || b === undefined) return Number.NaN
  if (isDate(a) || isDate(b)) return toDate(a, op).time - toDate(b, op).time
  if (isDuration(a) && isDuration(b)) return a.ms - b.ms
  if (typeof a === 'number' || typeof b === 'number') return expectNumber(a, op) - expectNumber(b, op)
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  throw new ExprError(`無法用 ${op} 比較 ${typeName(a)} 與 ${typeName(b)}`)
}

function contains(haystack: Value, needle: Value): boolean {
  if (Array.isArray(haystack)) return haystack.some(item => valuesEqual(item, needle))
  if (typeof haystack === 'string') return haystack.includes(expectString(needle, 'contains'))
  if (haystack === null) return false
  throw new ExprError(`contains 需要清單或字串，得到 ${typeName(haystack)}`)
}

function lengthOf(value: Value): number {
  if (value === null || value === undefined) return 0
  if (Array.isArray(value) || typeof value === 'string') return value.length
  if (isPlainObject(value)) return Object.keys(value).length
  throw new ExprError(`length 需要清單或字串，得到 ${typeName(value)}`)
}

type Fn = (args: Value[], ctx: EvalContext) => Value

const FUNCTIONS: Record<string, Fn> = {
  date: ([x]) => toDate(x ?? null, 'date'),
  today: (_, ctx) => makeDate(startOfDay(ctx.now).getTime(), true),
  now: (_, ctx) => makeDate(ctx.now.getTime()),
  number: ([x]) => {
    if (x === null || x === undefined) return null
    if (typeof x === 'boolean') return x ? 1 : 0
    return expectNumber(x, 'number')
  },
  string: ([x]) => formatValue(x ?? null),
  lower: ([x]) => expectString(x ?? null, 'lower').toLowerCase(),
  upper: ([x]) => expectString(x ?? null, 'upper').toUpperCase(),
  contains: ([x, y]) => contains(x ?? null, y ?? null),
  startsWith: ([x, y]) => expectString(x ?? null, 'startsWith').startsWith(expectString(y ?? null, 'startsWith')),
  endsWith: ([x, y]) => expectString(x ?? null, 'endsWith').endsWith(expectString(y ?? null, 'endsWith')),
  length: ([x]) => lengthOf(x ?? null),
  join: ([x, sep]) => {
    if (!Array.isArray(x)) throw new ExprError(`join 需要清單，得到 ${typeName(x ?? null)}`)
    return x.map(formatValue).join(sep === undefined ? ', ' : expectString(sep, 'join'))
  },
  min: (args) => {
    const nums = args.flatMap(a => Array.isArray(a) ? a : [a]).map(a => expectNumber(a, 'min'))
    if (!nums.length) throw new ExprError('min 需要至少一個數字')
    return Math.min(...nums)
  },
  max: (args) => {
    const nums = args.flatMap(a => Array.isArray(a) ? a : [a]).map(a => expectNumber(a, 'max'))
    if (!nums.length) throw new ExprError('max 需要至少一個數字')
    return Math.max(...nums)
  },
  round: ([x, n]) => {
    const digits = n === undefined ? 0 : expectNumber(n, 'round')
    const factor = 10 ** digits
    return Math.round(expectNumber(x ?? null, 'round') * factor) / factor
  },
}

/** `file.xxx` 的值；評估層的欄位取值也用這個。 */
export function fileMember(file: FileFacts, name: string): Value {
  switch (name) {
    case 'name': return file.name
    case 'basename': return file.basename
    case 'path': return file.path
    case 'folder': return file.folder
    case 'ext': return file.ext
    case 'mtime': return makeDate(file.mtime)
    case 'ctime': return makeDate(file.ctime)
    case 'tags': return file.tags
    case 'links': return file.links()
    case 'backlinks': return file.backlinks()
    case 'size': return file.size
    default: throw new ExprError(`不支援 file.${name}`)
  }
}

function fileMethod(file: FileFacts, ctx: EvalContext, name: string, args: Value[]): Value {
  switch (name) {
    case 'hasTag': {
      const wanted = args.map(a => expectString(a, 'hasTag').replace(/^#/, '').toLowerCase())
      // 巢狀：hasTag("a") 對 `a/b` 也成立（file.tags 已含父層）
      return wanted.some(tag => file.tags.some(t => t.toLowerCase() === tag))
    }
    case 'inFolder': {
      const folder = expectString(args[0] ?? null, 'inFolder').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      if (folder === '') return true
      const own = file.folder
      return own === folder || own.startsWith(`${folder}/`)
    }
    case 'hasLink': {
      const target = expectString(args[0] ?? null, 'hasLink').replace(/\.md$/i, '').toLowerCase()
      return file.links().some(path => {
        const lower = path.toLowerCase()
        const key = lower.replace(/\.md$/i, '')
        return key === target || key.endsWith(`/${target}`)
      })
    }
    case 'hasProperty': {
      const key = expectString(args[0] ?? null, 'hasProperty')
      return Object.prototype.hasOwnProperty.call(ctx.properties, key)
    }
    default: throw new ExprError(`不支援 file.${name}()`)
  }
}

function valueMember(value: Value, name: string): Value {
  if (isDuration(value)) {
    switch (name) {
      case 'days': return Math.trunc(value.ms / MS_PER_DAY)
      case 'hours': return Math.trunc(value.ms / MS_PER_HOUR)
      case 'minutes': return Math.trunc(value.ms / 60000)
      case 'milliseconds': return value.ms
      default: throw new ExprError(`時間差沒有 .${name}`)
    }
  }
  if (isDate(value)) {
    const d = new Date(value.time)
    switch (name) {
      case 'year': return d.getFullYear()
      case 'month': return d.getMonth() + 1
      case 'day': return d.getDate()
      case 'hour': return d.getHours()
      case 'minute': return d.getMinutes()
      case 'weekday': return d.getDay()
      default: throw new ExprError(`日期沒有 .${name}`)
    }
  }
  if (name === 'length') return lengthOf(value)
  if (isPlainObject(value)) return Object.prototype.hasOwnProperty.call(value, name) ? value[name] : null
  if (value === null) return null
  throw new ExprError(`${typeName(value)} 沒有 .${name}`)
}

export function evaluate(ast: Ast, ctx: EvalContext): Value {
  switch (ast.type) {
    case 'literal': return ast.value
    case 'list': return ast.items.map(item => evaluate(item, ctx))
    case 'ident': {
      if (ast.name === 'file' || ast.name === 'note' || ast.name === 'formula') throw new ExprError(`「${ast.name}」後面要接 .屬性`)
      return Object.prototype.hasOwnProperty.call(ctx.properties, ast.name) ? ctx.properties[ast.name] : null
    }
    case 'member': {
      if (ast.object.type === 'ident') {
        if (ast.object.name === 'file') return fileMember(ctx.file, ast.name)
        if (ast.object.name === 'note') return Object.prototype.hasOwnProperty.call(ctx.properties, ast.name) ? ctx.properties[ast.name] : null
        if (ast.object.name === 'formula') return ctx.formula(ast.name)
      }
      return valueMember(evaluate(ast.object, ctx), ast.name)
    }
    case 'call': {
      if (ast.name === 'if') {
        if (ast.args.length < 2 || ast.args.length > 3) throw new ExprError('if 需要 2 或 3 個參數')
        // 只算被選中的分支，沒選到的分支出錯也不影響
        if (truthy(evaluate(ast.args[0], ctx))) return evaluate(ast.args[1], ctx)
        return ast.args[2] ? evaluate(ast.args[2], ctx) : null
      }
      const fn = FUNCTIONS[ast.name]
      if (!fn) throw new ExprError(`不支援的函式 ${ast.name}()`)
      return fn(ast.args.map(arg => evaluate(arg, ctx)), ctx)
    }
    case 'method': {
      if (ast.object.type === 'ident' && ast.object.name === 'file') {
        return fileMethod(ctx.file, ctx, ast.name, ast.args.map(arg => evaluate(arg, ctx)))
      }
      const receiver = evaluate(ast.object, ctx)
      const fn = FUNCTIONS[ast.name]
      if (!fn) throw new ExprError(`不支援的方法 .${ast.name}()`)
      return fn([receiver, ...ast.args.map(arg => evaluate(arg, ctx))], ctx)
    }
    case 'unary': {
      const value = evaluate(ast.arg, ctx)
      if (ast.op === '!') return !truthy(value)
      return -expectNumber(value, '負號')
    }
    case 'binary': {
      if (ast.op === '&&') return truthy(evaluate(ast.left, ctx)) && truthy(evaluate(ast.right, ctx))
      if (ast.op === '||') return truthy(evaluate(ast.left, ctx)) || truthy(evaluate(ast.right, ctx))
      const left = evaluate(ast.left, ctx)
      const right = evaluate(ast.right, ctx)
      switch (ast.op) {
        case '==': return valuesEqual(left, right)
        case '!=': return !valuesEqual(left, right)
        case '<': return compareOrdered(left, right, '<') < 0
        case '>': return compareOrdered(left, right, '>') > 0
        case '<=': return compareOrdered(left, right, '<=') <= 0
        case '>=': return compareOrdered(left, right, '>=') >= 0
        case '+': {
          if (typeof left === 'string' || typeof right === 'string') return formatValue(left) + formatValue(right)
          if (isDate(left) && isDuration(right)) return makeDate(left.time + right.ms)
          if (isDuration(left) && isDate(right)) return makeDate(right.time + left.ms)
          if (isDuration(left) && isDuration(right)) return { type: 'duration', ms: left.ms + right.ms }
          if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right]
          return expectNumber(left, '+') + expectNumber(right, '+')
        }
        case '-': {
          if (isDate(left) && isDate(right)) return { type: 'duration', ms: left.time - right.time }
          if (isDate(left) && isDuration(right)) return makeDate(left.time - right.ms)
          if (isDuration(left) && isDuration(right)) return { type: 'duration', ms: left.ms - right.ms }
          return expectNumber(left, '-') - expectNumber(right, '-')
        }
        case '*': return expectNumber(left, '*') * expectNumber(right, '*')
        case '/': {
          const divisor = expectNumber(right, '/')
          if (divisor === 0) throw new ExprError('除以零')
          return expectNumber(left, '/') / divisor
        }
        default: throw new ExprError(`不支援的運算子 ${ast.op}`)
      }
    }
  }
}

/** 解析＋求值的捷徑；錯誤一律丟 ExprError。 */
export function evaluateExpr(src: string, ctx: EvalContext): Value {
  return evaluate(parseExpr(src), ctx)
}

/** 排序用：數字／日期／字串各自比較，null（與錯誤）最後；不同型別依型別順序。 */
export function compareForSort(a: Value, b: Value): number {
  const rank = (v: Value): number => {
    if (v === null || v === undefined) return 9
    if (typeof v === 'number') return 0
    if (isDate(v)) return 1
    if (isDuration(v)) return 2
    if (typeof v === 'string') return 3
    if (typeof v === 'boolean') return 4
    if (Array.isArray(v)) return 5
    return 6
  }
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra === 9) return 0
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (isDate(a) && isDate(b)) return a.time - b.time
  if (isDuration(a) && isDuration(b)) return a.ms - b.ms
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const sa = formatValue(a)
  const sb = formatValue(b)
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' }) || (sa < sb ? -1 : sa > sb ? 1 : 0)
}

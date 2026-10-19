/**
 * Fork (Phase 2-3b, 軌道 A)：把 `.base` 的 view 套在索引上，算出表格資料。純函式、無 I/O。
 *
 * 輸入索引的 IndexedNote（frontmatter、tags、links）與連結解析函式；輸出每個 view 的欄位、
 * 列、總數與錯誤。`now` 由參數注入，today()/now() 才能在測試固定。
 * 運算式錯誤只影響該格（CellError），filter 出錯的筆記視為不符合並把訊息記進 view.errors。
 */

import type { IndexedNote } from '@/lib/vault-index/index-note'
import { noteKeyOf } from '@/lib/markdown/wikilink'
import { type BaseFile, type BaseSort, type BaseView, type FilterNode, SUPPORTED_VIEW_TYPES } from './format'
import {
  type Ast,
  compareForSort,
  type EvalContext,
  evaluate,
  ExprError,
  type FileFacts,
  fileMember,
  makeDate,
  parseExpr,
  truthy,
  type Value,
} from './expr'

export const DEFAULT_LIMIT = 200
/** 未指定 order 時，自動加入的 frontmatter 欄位上限 */
const AUTO_COLUMN_CAP = 30

export interface CellError {
  type: 'error'
  message: string
}

export type CellValue = Value | CellError

export function isCellError(value: CellValue): value is CellError {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as CellError).type === 'error'
}

export interface ViewColumn {
  key: string
  label: string
}

export interface ViewRow {
  path: string
  /** 不含副檔名的檔名（list view 與連結顯示用） */
  name: string
  /** 欄位值；含 order 與 sort 用到的所有 key */
  cells: Record<string, CellValue>
}

export interface ViewResult {
  name: string
  /** 實際渲染的型別；不支援的型別退回 table */
  type: 'table' | 'list'
  /** `.base` 裡寫的型別 */
  requestedType: string
  columns: ViewColumn[]
  rows: ViewRow[]
  /** 符合 filter 的總數（未套 limit） */
  total: number
  truncated: boolean
  errors: string[]
}

export interface EvaluateInput {
  base: BaseFile
  notes: Iterable<IndexedNote>
  /** wikilink 目標 → vault 路徑；找不到 null */
  resolve: (target: string, sourcePath: string) => string | null
  /** today()／now() 的基準；預設 new Date() */
  now?: Date
}

export interface EvaluateViewOptions {
  /** 表頭點擊的排序，覆蓋 view.sort（不寫回檔案） */
  sortOverride?: BaseSort[] | null
}

// ---------------------------------------------------------------------------
// frontmatter 正規化

function toValue(raw: unknown): Value {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw
  if (raw instanceof Date) return makeDate(raw.getTime())
  if (Array.isArray(raw)) return raw.map(toValue)
  if (typeof raw === 'object') {
    const out: Record<string, Value> = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) out[key] = toValue(value)
    return out
  }
  return String(raw)
}

function toStringList(raw: unknown, split: boolean): string[] {
  const values = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw]
  return values
    .flatMap(item => typeof item === 'string' ? (split ? item.split(/[,\s]+/) : [item]) : typeof item === 'number' ? [String(item)] : [])
    .map(item => item.trim())
    .filter(Boolean)
}

/** frontmatter → 運算式用的屬性；`tags`／`aliases` 正規化成字串清單（Obsidian 也把單數別名收進同一欄）。 */
export function normalizeProperties(frontmatter: Record<string, unknown> | null): Record<string, Value> {
  const out: Record<string, Value> = {}
  if (!frontmatter) return out
  for (const [key, raw] of Object.entries(frontmatter)) {
    if (key === 'tags' || key === 'tag') out[key] = toStringList(raw, true).map(tag => tag.replace(/^#/, ''))
    else if (key === 'aliases' || key === 'alias') out[key] = toStringList(raw, false)
    else out[key] = toValue(raw)
  }
  return out
}

/** `a/b/c` → `a`、`a/b`、`a/b/c`（去重、保留順序）。 */
export function expandTags(tags: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const parts = tag.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/')
      if (!seen.has(prefix)) { seen.add(prefix); out.push(prefix) }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 連結解析（比 resolveWikilinkTarget 快的版本：對照表只建一次）

/**
 * 以所有路徑建一份對照表，回傳 Obsidian「shortest path when possible」規則的解析函式：
 * 先比完整相對路徑（可省 .md），再比檔名（不分大小寫）；多個同名時先同資料夾、再路徑最短。
 */
export function makeIndexResolver(paths: Iterable<string>): (target: string, sourcePath: string) => string | null {
  const byPath = new Map<string, string>()
  const byName = new Map<string, string[]>()
  for (const path of paths) {
    const normalized = path.replace(/\\/g, '/').replace(/^\.?\//, '')
    byPath.set(normalized.toLowerCase(), normalized)
    const key = noteKeyOf(normalized).toLowerCase()
    const list = byName.get(key)
    if (list) list.push(normalized)
    else byName.set(key, [normalized])
  }
  const folderOf = (path: string) => {
    const i = path.lastIndexOf('/')
    return i < 0 ? '' : path.slice(0, i)
  }
  return (target, sourcePath) => {
    const wanted = target.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/')
    if (!wanted) return sourcePath || null
    const lower = wanted.toLowerCase()
    const exact = byPath.get(lower) ?? (/\.md$/i.test(lower) ? undefined : byPath.get(`${lower}.md`))
    if (exact) return exact
    if (wanted.includes('/')) return null
    const candidates = byName.get(noteKeyOf(wanted).toLowerCase())
    if (!candidates?.length) return null
    if (candidates.length === 1) return candidates[0]
    const sourceFolder = folderOf(sourcePath)
    return [...candidates].sort((a, b) => {
      const aSame = folderOf(a) === sourceFolder ? 0 : 1
      const bSame = folderOf(b) === sourceFolder ? 0 : 1
      if (aSame !== bSame) return aSame - bSame
      if (a.length !== b.length) return a.length - b.length
      return a.localeCompare(b)
    })[0]
  }
}

// ---------------------------------------------------------------------------
// 每篇筆記的求值環境

interface NoteContext {
  note: IndexedNote
  ctx: EvalContext
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function extOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1)
}

class Vault {
  readonly notes: IndexedNote[]
  private readonly outgoing = new Map<string, string[]>()
  private backlinks: Map<string, string[]> | null = null
  private readonly formulaAsts = new Map<string, Ast | ExprError>()
  private readonly exprAsts = new Map<string, Ast | ExprError>()
  private readonly contexts = new Map<string, NoteContext>()

  constructor(
    notes: Iterable<IndexedNote>,
    private readonly resolve: EvaluateInput['resolve'],
    private readonly base: BaseFile,
    readonly now: Date,
  ) {
    this.notes = [...notes]
  }

  linksOf(note: IndexedNote): string[] {
    let cached = this.outgoing.get(note.path)
    if (cached) return cached
    const out: string[] = []
    const seen = new Set<string>()
    for (const link of note.links) {
      const resolved = this.resolve(link.target, note.path)
      if (resolved && !seen.has(resolved)) { seen.add(resolved); out.push(resolved) }
    }
    cached = out
    this.outgoing.set(note.path, cached)
    return cached
  }

  backlinksOf(path: string): string[] {
    if (!this.backlinks) {
      this.backlinks = new Map()
      for (const note of this.notes) {
        for (const target of this.linksOf(note)) {
          if (target === note.path) continue
          const list = this.backlinks.get(target)
          if (list) list.push(note.path)
          else this.backlinks.set(target, [note.path])
        }
      }
    }
    return this.backlinks.get(path) ?? []
  }

  /** 運算式字串 → AST；同一字串只解析一次（解析失敗也快取）。 */
  ast(src: string): Ast {
    let cached = this.exprAsts.get(src)
    if (!cached) {
      try { cached = parseExpr(src) } catch (error) { cached = error instanceof ExprError ? error : new ExprError(String(error)) }
      this.exprAsts.set(src, cached)
    }
    if (cached instanceof ExprError) throw cached
    return cached
  }

  formulaAst(name: string): Ast {
    let cached = this.formulaAsts.get(name)
    if (!cached) {
      const src = this.base.formulas[name]
      if (src === undefined) cached = new ExprError(`沒有這個 formula：${name}`)
      else {
        try { cached = parseExpr(src) } catch (error) { cached = error instanceof ExprError ? error : new ExprError(String(error)) }
      }
      this.formulaAsts.set(name, cached)
    }
    if (cached instanceof ExprError) throw cached
    return cached
  }

  contextOf(note: IndexedNote): NoteContext {
    const cached = this.contexts.get(note.path)
    if (cached) return cached
    const name = noteKeyOf(note.path)
    const file: FileFacts = {
      name,
      basename: name,
      path: note.path,
      folder: folderOf(note.path),
      ext: extOf(note.path),
      mtime: note.mtime,
      // 索引沒有建立時間，照規格用 mtime
      ctime: note.mtime,
      tags: expandTags(note.tags),
      links: () => this.linksOf(note),
      backlinks: () => this.backlinksOf(note.path),
      size: 0,
    }
    const properties = normalizeProperties(note.frontmatter)
    const formulaCache = new Map<string, Value | ExprError>()
    const stack = new Set<string>()
    const ctx: EvalContext = {
      file,
      properties,
      now: this.now,
      formula: (formulaName) => {
        const cached = formulaCache.get(formulaName)
        if (cached !== undefined) {
          if (cached instanceof ExprError) throw cached
          return cached
        }
        if (stack.has(formulaName)) throw new ExprError(`formula 循環參照：${[...stack, formulaName].join(' → ')}`)
        stack.add(formulaName)
        try {
          const value = evaluate(this.formulaAst(formulaName), ctx)
          formulaCache.set(formulaName, value)
          return value
        } catch (error) {
          const wrapped = error instanceof ExprError ? error : new ExprError(String(error))
          formulaCache.set(formulaName, wrapped)
          throw wrapped
        } finally {
          stack.delete(formulaName)
        }
      },
    }
    const context = { note, ctx }
    this.contexts.set(note.path, context)
    return context
  }
}

// ---------------------------------------------------------------------------
// filter、欄位、排序

function matchesFilter(filter: FilterNode, vault: Vault, ctx: EvalContext): boolean {
  if (typeof filter === 'string') return truthy(evaluate(vault.ast(filter), ctx))
  if ('and' in filter) return filter.and.every(item => matchesFilter(item, vault, ctx))
  if ('or' in filter) return filter.or.some(item => matchesFilter(item, vault, ctx))
  return !filter.not.some(item => matchesFilter(item, vault, ctx))
}

/** 欄位 key（`file.name`、`note.status`、`status`、`formula.x`）→ 該筆記的值；錯誤變成 CellError。 */
export function cellValue(key: string, ctx: EvalContext): CellValue {
  try {
    if (key.startsWith('file.')) return fileMember(ctx.file, key.slice(5))
    if (key.startsWith('formula.')) return ctx.formula(key.slice(8))
    const name = key.startsWith('note.') ? key.slice(5) : key
    return Object.prototype.hasOwnProperty.call(ctx.properties, name) ? ctx.properties[name] : null
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

/** 欄位標題：properties 的 displayName，沒有就用 key 的最後一段。 */
export function columnLabel(key: string, properties: BaseFile['properties']): string {
  const direct = properties[key]?.displayName
  if (direct) return direct
  if (key.startsWith('note.')) {
    const bare = properties[key.slice(5)]?.displayName
    if (bare) return bare
  } else if (!key.startsWith('file.') && !key.startsWith('formula.')) {
    const prefixed = properties[`note.${key}`]?.displayName
    if (prefixed) return prefixed
  }
  const dot = key.indexOf('.')
  return dot >= 0 && (key.startsWith('file.') || key.startsWith('formula.') || key.startsWith('note.')) ? key.slice(dot + 1) : key
}

function sortValue(value: CellValue): Value {
  return isCellError(value) ? null : value
}

/** 多鍵排序；每鍵數字／日期／字串各自比較，null 與錯誤一律最後（不論方向）。穩定。 */
export function sortRows(rows: ViewRow[], sort: readonly BaseSort[]): ViewRow[] {
  if (!sort.length) return rows
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const { property, direction } of sort) {
        const va = sortValue(a.row.cells[property] ?? null)
        const vb = sortValue(b.row.cells[property] ?? null)
        const aNull = va === null
        const bNull = vb === null
        if (aNull !== bNull) return aNull ? 1 : -1
        if (aNull) continue
        const cmp = compareForSort(va, vb)
        if (cmp !== 0) return direction === 'DESC' ? -cmp : cmp
      }
      return a.index - b.index
    })
    .map(item => item.row)
}

function autoColumns(contexts: NoteContext[], base: BaseFile): string[] {
  const keys: string[] = ['file.name']
  const seen = new Set<string>()
  for (const { ctx } of contexts) {
    for (const key of Object.keys(ctx.properties)) {
      if (seen.has(key)) continue
      seen.add(key)
      if (seen.size <= AUTO_COLUMN_CAP) keys.push(key)
    }
  }
  for (const name of Object.keys(base.formulas)) keys.push(`formula.${name}`)
  return keys
}

function viewType(type: string): 'table' | 'list' {
  return (SUPPORTED_VIEW_TYPES as readonly string[]).includes(type) ? (type as 'table' | 'list') : 'table'
}

function evaluateViewWith(vault: Vault, base: BaseFile, view: BaseView, options: EvaluateViewOptions = {}): ViewResult {
  const errors: string[] = []
  const seenErrors = new Set<string>()
  const recordError = (message: string) => {
    if (seenErrors.has(message)) return
    seenErrors.add(message)
    errors.push(message)
  }

  const filters: FilterNode[] = []
  if (base.filters) filters.push(base.filters)
  if (view.filters) filters.push(view.filters)
  const filter: FilterNode | null = filters.length === 0 ? null : filters.length === 1 ? filters[0] : { and: filters }

  const matched: NoteContext[] = []
  for (const note of vault.notes) {
    const context = vault.contextOf(note)
    if (filter) {
      try {
        if (!matchesFilter(filter, vault, context.ctx)) continue
      } catch (error) {
        recordError(`${note.path}：${error instanceof Error ? error.message : String(error)}`)
        continue
      }
    }
    matched.push(context)
  }

  const orderKeys = view.order.length ? view.order : autoColumns(matched, base)
  const sort = options.sortOverride?.length ? options.sortOverride : view.sort
  const cellKeys = [...new Set([...orderKeys, ...sort.map(item => item.property)])]

  let rows: ViewRow[] = matched.map(({ note, ctx }) => {
    const cells: Record<string, CellValue> = {}
    for (const key of cellKeys) cells[key] = cellValue(key, ctx)
    return { path: note.path, name: ctx.file.name, cells }
  })
  rows = sortRows(rows, sort)

  const limit = view.limit ?? DEFAULT_LIMIT
  const total = rows.length
  const truncated = total > limit
  if (truncated) rows = rows.slice(0, limit)

  const type = viewType(view.type)
  return {
    name: view.name,
    type,
    requestedType: view.type,
    columns: orderKeys.map(key => ({ key, label: columnLabel(key, base.properties) })),
    rows,
    total,
    truncated,
    errors,
  }
}

/** 評估單一 view（頁面在表頭排序時用，sortOverride 覆蓋 view.sort）。 */
export function evaluateBaseView(input: EvaluateInput, view: BaseView, options: EvaluateViewOptions = {}): ViewResult {
  const vault = new Vault(input.notes, input.resolve, input.base, input.now ?? new Date())
  return evaluateViewWith(vault, input.base, view, options)
}

/** 評估 `.base` 的所有 view。 */
export function evaluateBase(input: EvaluateInput): ViewResult[] {
  const vault = new Vault(input.notes, input.resolve, input.base, input.now ?? new Date())
  return input.base.views.map(view => evaluateViewWith(vault, input.base, view))
}

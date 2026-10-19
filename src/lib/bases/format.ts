/**
 * Fork (Phase 2-3b, 軌道 A)：`.base` 檔（與筆記內 ```base 區塊）的 YAML 解析。純函式、無 I/O。
 *
 * 支援的子集：`filters`（and／or／not 可巢狀，葉節點是運算式字串）、`formulas`、
 * `properties`（只用 displayName）、`views`（table／list；其他型別保留原名，由評估層退回 table）。
 * 本段只讀不寫，所以這裡沒有序列化。
 */

import { parse as parseYaml, YAMLParseError } from 'yaml'

export type FilterNode =
  | { and: FilterNode[] }
  | { or: FilterNode[] }
  | { not: FilterNode[] }
  | string

export interface BaseSort {
  property: string
  direction: 'ASC' | 'DESC'
}

export interface BaseView {
  /** 原始型別字串（`table`、`list`、或不支援的 `cards` 等） */
  type: string
  name: string
  filters: FilterNode | null
  /** 欄位順序；空陣列表示未指定 */
  order: string[]
  sort: BaseSort[]
  /** null 表示未指定（評估層用預設 200） */
  limit: number | null
}

export interface BaseFile {
  filters: FilterNode | null
  formulas: Record<string, string>
  properties: Record<string, { displayName?: string }>
  views: BaseView[]
}

export interface BaseParseError {
  message: string
  /** 1 起算；YAML 語法錯誤才有 */
  line?: number
}

export const SUPPORTED_VIEW_TYPES = ['table', 'list'] as const

export const DEFAULT_VIEW_NAME = 'Table'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/**
 * 把 YAML 的 filters 轉成 FilterNode。字串就是運算式；物件只認 and／or／not（值可以是清單或單一節點）。
 * 不合法的節點記進 errors 並略過（不讓整份失敗）。
 */
export function normalizeFilter(value: unknown, errors: BaseParseError[], where = 'filters'): FilterNode | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() === '' ? null : value
  if (Array.isArray(value)) {
    // 直接給清單時視為 and
    const items = value.map(item => normalizeFilter(item, errors, where)).filter((item): item is FilterNode => item !== null)
    return items.length ? { and: items } : null
  }
  if (!isRecord(value)) {
    errors.push({ message: `${where}：不支援的節點型別` })
    return null
  }
  const keys = Object.keys(value)
  if (keys.length !== 1 || !['and', 'or', 'not'].includes(keys[0])) {
    errors.push({ message: `${where}：只支援 and／or／not，得到 ${keys.join(', ') || '空物件'}` })
    return null
  }
  const key = keys[0] as 'and' | 'or' | 'not'
  const raw = value[key]
  const list = Array.isArray(raw) ? raw : [raw]
  const items = list.map(item => normalizeFilter(item, errors, `${where}.${key}`)).filter((item): item is FilterNode => item !== null)
  if (!items.length) return null
  if (key === 'and') return { and: items }
  if (key === 'or') return { or: items }
  return { not: items }
}

function normalizeSort(value: unknown, errors: BaseParseError[], where: string): BaseSort[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) {
    errors.push({ message: `${where}.sort 必須是清單` })
    return []
  }
  const out: BaseSort[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      out.push({ property: item, direction: 'ASC' })
      continue
    }
    if (!isRecord(item) || typeof item.property !== 'string') {
      errors.push({ message: `${where}.sort：每項需要 property` })
      continue
    }
    const direction = asString(item.direction).toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    out.push({ property: item.property, direction })
  }
  return out
}

function normalizeView(value: unknown, index: number, errors: BaseParseError[]): BaseView | null {
  const where = `views[${index}]`
  if (!isRecord(value)) {
    errors.push({ message: `${where} 必須是物件` })
    return null
  }
  const type = asString(value.type).trim() || 'table'
  const name = asString(value.name).trim() || (index === 0 ? DEFAULT_VIEW_NAME : `${DEFAULT_VIEW_NAME} ${index + 1}`)
  const orderRaw = value.order
  let order: string[] = []
  if (Array.isArray(orderRaw)) order = orderRaw.map(asString).map(s => s.trim()).filter(Boolean)
  else if (orderRaw !== undefined && orderRaw !== null) errors.push({ message: `${where}.order 必須是清單` })
  let limit: number | null = null
  if (value.limit !== undefined && value.limit !== null) {
    const n = Number(value.limit)
    if (Number.isFinite(n) && n > 0) limit = Math.floor(n)
    else errors.push({ message: `${where}.limit 必須是正整數` })
  }
  return {
    type,
    name,
    filters: normalizeFilter(value.filters, errors, `${where}.filters`),
    order,
    sort: normalizeSort(value.sort, errors, where),
    limit,
  }
}

/** 沒有 `views` 時（例如 ```base 區塊）當作單一 table。 */
export function defaultView(): BaseView {
  return { type: 'table', name: DEFAULT_VIEW_NAME, filters: null, order: [], sort: [], limit: null }
}

/**
 * 解析 `.base` 的 YAML。語法錯誤時 `base` 為 null 並附行號；結構問題（型別不對）記進 errors
 * 但仍回傳能用的部分。
 */
export function parseBase(text: string): { base: BaseFile | null, errors: BaseParseError[] } {
  const errors: BaseParseError[] = []
  let data: unknown
  try {
    data = parseYaml(text.replace(/^﻿/, ''))
  } catch (error) {
    const line = error instanceof YAMLParseError ? error.linePos?.[0]?.line : undefined
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
    return { base: null, errors: [{ message, line }] }
  }
  if (data === null || data === undefined || (typeof data === 'string' && data.trim() === '')) {
    return { base: { filters: null, formulas: {}, properties: {}, views: [defaultView()] }, errors }
  }
  if (!isRecord(data)) {
    return { base: null, errors: [{ message: '最上層必須是物件（filters／formulas／properties／views）' }] }
  }

  const formulas: Record<string, string> = {}
  if (data.formulas !== undefined && data.formulas !== null) {
    if (isRecord(data.formulas)) {
      for (const [key, value] of Object.entries(data.formulas)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') formulas[key] = String(value)
        else errors.push({ message: `formulas.${key} 必須是運算式字串` })
      }
    } else errors.push({ message: 'formulas 必須是物件' })
  }

  const properties: Record<string, { displayName?: string }> = {}
  if (data.properties !== undefined && data.properties !== null) {
    if (isRecord(data.properties)) {
      for (const [key, value] of Object.entries(data.properties)) {
        if (isRecord(value)) properties[key] = typeof value.displayName === 'string' ? { displayName: value.displayName } : {}
        else errors.push({ message: `properties.${key} 必須是物件` })
      }
    } else errors.push({ message: 'properties 必須是物件' })
  }

  let views: BaseView[] = []
  if (data.views !== undefined && data.views !== null) {
    if (Array.isArray(data.views)) {
      views = data.views.map((view, index) => normalizeView(view, index, errors)).filter((view): view is BaseView => view !== null)
    } else errors.push({ message: 'views 必須是清單' })
  }
  if (!views.length) views = [defaultView()]

  return {
    base: { filters: normalizeFilter(data.filters, errors), formulas, properties, views },
    errors,
  }
}

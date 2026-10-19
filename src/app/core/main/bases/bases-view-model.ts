/**
 * Fork (Phase 2-3b, 軌道 A)：Bases 頁面與 ```base 區塊共用的純邏輯（無 React、無 I/O），方便測試。
 * view 切換、表頭排序覆蓋、格子的顯示分類。
 */

import type { BaseSort, BaseView } from '@/lib/bases/format'
import { type CellValue, isCellError, type ViewRow } from '@/lib/bases/evaluate'
import { formatDate, formatValue, isDate, isDuration } from '@/lib/bases/expr'

export type SortOverride = BaseSort[] | null

/**
 * 表頭點擊：沒排序 → ASC；同欄 ASC → DESC；同欄 DESC → 取消覆蓋（回到檔案的 sort）；別欄 → 該欄 ASC。
 * 只覆蓋在記憶體，不寫回 `.base`。
 */
export function nextSortOverride(current: SortOverride, key: string): SortOverride {
  const active = current?.[0]
  if (!active || active.property !== key) return [{ property: key, direction: 'ASC' }]
  if (active.direction === 'ASC') return [{ property: key, direction: 'DESC' }]
  return null
}

/** 表頭要畫的箭頭：目前生效的排序（覆蓋優先，其次檔案的 sort）裡第一鍵是這欄時才顯示。 */
export function sortIndicator(effective: readonly BaseSort[], key: string): 'ASC' | 'DESC' | null {
  const first = effective[0]
  return first && first.property === key ? first.direction : null
}

/** 覆蓋存在時用覆蓋，否則用 view 自己的 sort。 */
export function effectiveSort(view: Pick<BaseView, 'sort'>, override: SortOverride): BaseSort[] {
  return override && override.length ? override : view.sort
}

/** view 數量改變（重新整理、編輯）時，讓目前的索引不越界。 */
export function clampViewIndex(viewCount: number, index: number): number {
  if (viewCount <= 0) return 0
  if (!Number.isFinite(index) || index < 0) return 0
  return Math.min(Math.floor(index), viewCount - 1)
}

export type CellDisplay =
  | { kind: 'empty' }
  | { kind: 'text', text: string }
  | { kind: 'bool', value: boolean }
  /** `file.name`：點開筆記 */
  | { kind: 'note', path: string, label: string }
  /** frontmatter 裡的 `"[[連結]]"` 字串 */
  | { kind: 'wikilink', raw: string, label: string }
  | { kind: 'chips', items: string[] }
  | { kind: 'error', message: string }

const WIKILINK_RE = /^!?\[\[([^\]\n]*?)\]\]$/

function wikilinkLabel(raw: string): string {
  const inner = WIKILINK_RE.exec(raw)?.[1] ?? raw
  const pipe = inner.search(/\\?\|/)
  const target = pipe >= 0 ? inner.slice(0, pipe) : inner
  const alias = pipe >= 0 ? inner.slice(pipe + (inner[pipe] === '\\' ? 2 : 1)).trim() : ''
  if (alias) return alias
  const name = target.split('#')[0].split('/').filter(Boolean).pop() ?? target
  return name.replace(/\.md$/i, '') || inner
}

/**
 * 格子值 → 顯示方式。日期 `YYYY-MM-DD`、清單 chip、布林 ✓／空白、`file.name` 連結、
 * `"[[X]]"` 字串顯示成可點的連結、錯誤顯示訊息。
 */
export function describeCell(key: string, value: CellValue, row: Pick<ViewRow, 'path' | 'name'>): CellDisplay {
  if (isCellError(value)) return { kind: 'error', message: value.message }
  if (key === 'file.name' || key === 'file.basename') return { kind: 'note', path: row.path, label: row.name }
  if (value === null || value === undefined) return { kind: 'empty' }
  if (typeof value === 'boolean') return { kind: 'bool', value }
  if (typeof value === 'string') {
    if (value === '') return { kind: 'empty' }
    if (WIKILINK_RE.test(value.trim())) return { kind: 'wikilink', raw: value.trim(), label: wikilinkLabel(value.trim()) }
    return { kind: 'text', text: value }
  }
  if (Array.isArray(value)) {
    const items = value.map(item => isDate(item) ? formatDate(item) : formatValue(item)).filter(item => item !== '')
    return items.length ? { kind: 'chips', items } : { kind: 'empty' }
  }
  if (isDate(value)) return { kind: 'text', text: formatDate(value) }
  if (isDuration(value)) return { kind: 'text', text: formatValue(value) }
  return { kind: 'text', text: formatValue(value) }
}

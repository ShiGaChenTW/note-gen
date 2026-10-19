// @vitest-environment jsdom
// Phase 2-3b 軌道 A：`.base` 整頁的純邏輯（view 切換、表頭排序覆蓋、格子顯示分類）
import { describe, expect, it } from 'vitest'
import { makeDate } from '@/lib/bases/expr'
import {
  clampViewIndex,
  describeCell,
  effectiveSort,
  nextSortOverride,
  sortIndicator,
} from './bases-view-model'

const row = { path: 'Projects/Alpha.md', name: 'Alpha' }

describe('排序覆蓋', () => {
  it('nextSortOverride：無 → ASC → DESC → 取消；換欄從 ASC 開始', () => {
    const asc = nextSortOverride(null, 'due')
    expect(asc).toEqual([{ property: 'due', direction: 'ASC' }])
    const desc = nextSortOverride(asc, 'due')
    expect(desc).toEqual([{ property: 'due', direction: 'DESC' }])
    expect(nextSortOverride(desc, 'due')).toBeNull()
    expect(nextSortOverride(desc, 'file.name')).toEqual([{ property: 'file.name', direction: 'ASC' }])
    expect(nextSortOverride([], 'x')).toEqual([{ property: 'x', direction: 'ASC' }])
  })

  it('effectiveSort：覆蓋優先，否則用檔案的 sort', () => {
    const view = { sort: [{ property: 'due', direction: 'ASC' as const }] }
    expect(effectiveSort(view, null)).toBe(view.sort)
    expect(effectiveSort(view, [])).toBe(view.sort)
    const override = [{ property: 'count', direction: 'DESC' as const }]
    expect(effectiveSort(view, override)).toBe(override)
  })

  it('sortIndicator 只看第一鍵', () => {
    const sort = [{ property: 'due', direction: 'DESC' as const }, { property: 'file.name', direction: 'ASC' as const }]
    expect(sortIndicator(sort, 'due')).toBe('DESC')
    expect(sortIndicator(sort, 'file.name')).toBeNull()
    expect(sortIndicator([], 'due')).toBeNull()
  })
})

describe('view 切換', () => {
  it('clampViewIndex：越界與無 view', () => {
    expect(clampViewIndex(3, 0)).toBe(0)
    expect(clampViewIndex(3, 2)).toBe(2)
    expect(clampViewIndex(3, 5)).toBe(2)
    expect(clampViewIndex(3, -1)).toBe(0)
    expect(clampViewIndex(0, 2)).toBe(0)
    expect(clampViewIndex(3, Number.NaN)).toBe(0)
  })
})

describe('describeCell', () => {
  it('file.name 是筆記連結（不管值）', () => {
    expect(describeCell('file.name', 'Alpha', row)).toEqual({ kind: 'note', path: 'Projects/Alpha.md', label: 'Alpha' })
    expect(describeCell('file.basename', null, row)).toEqual({ kind: 'note', path: 'Projects/Alpha.md', label: 'Alpha' })
  })

  it('空值、布林、文字、數字、日期、時間差', () => {
    expect(describeCell('x', null, row)).toEqual({ kind: 'empty' })
    expect(describeCell('x', '', row)).toEqual({ kind: 'empty' })
    expect(describeCell('x', true, row)).toEqual({ kind: 'bool', value: true })
    expect(describeCell('x', false, row)).toEqual({ kind: 'bool', value: false })
    expect(describeCell('x', 'hello', row)).toEqual({ kind: 'text', text: 'hello' })
    expect(describeCell('x', 2.5, row)).toEqual({ kind: 'text', text: '2.5' })
    expect(describeCell('x', makeDate(new Date(2026, 9, 19, 8, 30).getTime()), row)).toEqual({ kind: 'text', text: '2026-10-19 08:30' })
    expect(describeCell('x', makeDate(new Date(2026, 9, 19).getTime(), true), row)).toEqual({ kind: 'text', text: '2026-10-19' })
    expect(describeCell('x', { type: 'duration', ms: 2 * 86400000 }, row)).toEqual({ kind: 'text', text: '2d' })
    expect(describeCell('x', { a: 1 }, row)).toEqual({ kind: 'text', text: '{"a":1}' })
  })

  it('清單 chip；空清單與全空項目視為空', () => {
    expect(describeCell('tags', ['a', 'b/c', 3, makeDate(new Date(2026, 0, 1).getTime(), true)], row)).toEqual({ kind: 'chips', items: ['a', 'b/c', '3', '2026-01-01'] })
    expect(describeCell('tags', [], row)).toEqual({ kind: 'empty' })
    expect(describeCell('tags', [null, ''], row)).toEqual({ kind: 'empty' })
  })

  it('"[[連結]]" 字串可點；別名、標題、路徑的顯示文字', () => {
    expect(describeCell('related', '[[Beta]]', row)).toEqual({ kind: 'wikilink', raw: '[[Beta]]', label: 'Beta' })
    expect(describeCell('related', '[[Beta|別名]]', row)).toEqual({ kind: 'wikilink', raw: '[[Beta|別名]]', label: '別名' })
    expect(describeCell('related', '[[Beta\\|表格]]', row)).toEqual({ kind: 'wikilink', raw: '[[Beta\\|表格]]', label: '表格' })
    expect(describeCell('related', '[[Sub/Beta.md#標題]]', row)).toEqual({ kind: 'wikilink', raw: '[[Sub/Beta.md#標題]]', label: 'Beta' })
    expect(describeCell('related', 'see [[Beta]]', row)).toEqual({ kind: 'text', text: 'see [[Beta]]' })
  })

  it('錯誤格', () => {
    expect(describeCell('formula.x', { type: 'error', message: '不支援的函式 nope()' }, row)).toEqual({ kind: 'error', message: '不支援的函式 nope()' })
    // file.name 欄即使出錯也不會變連結以外的東西
    expect(describeCell('file.name', { type: 'error', message: 'x' }, row).kind).toBe('error')
  })
})

// Phase 2-3b 軌道 A：`.base` YAML 解析
import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW_NAME, normalizeFilter, parseBase, type BaseParseError } from './format'

const SAMPLE = `filters:
  and:
    - file.hasTag("project")
    - 'status != "done"'
formulas:
  days_left: 'if(due, (date(due) - today()).days, "")'
properties:
  note.status: { displayName: 狀態 }
  formula.days_left: { displayName: 剩餘天數 }
views:
  - type: table
    name: 進行中
    filters: { and: [ 'priority == "high"' ] }
    order: [file.name, status, due, formula.days_left]
    sort: [{ property: due, direction: ASC }, { property: file.name, direction: DESC }]
    limit: 50
  - type: list
    name: 清單
    order: [file.name]
  - type: cards
    name: 卡片
`

describe('parseBase', () => {
  it('規格範例', () => {
    const { base, errors } = parseBase(SAMPLE)
    expect(errors).toEqual([])
    expect(base).not.toBeNull()
    expect(base!.filters).toEqual({ and: ['file.hasTag("project")', 'status != "done"'] })
    expect(base!.formulas).toEqual({ days_left: 'if(due, (date(due) - today()).days, "")' })
    expect(base!.properties).toEqual({ 'note.status': { displayName: '狀態' }, 'formula.days_left': { displayName: '剩餘天數' } })
    expect(base!.views).toHaveLength(3)
    expect(base!.views[0]).toEqual({
      type: 'table',
      name: '進行中',
      filters: { and: ['priority == "high"'] },
      order: ['file.name', 'status', 'due', 'formula.days_left'],
      sort: [{ property: 'due', direction: 'ASC' }, { property: 'file.name', direction: 'DESC' }],
      limit: 50,
    })
    expect(base!.views[1]).toMatchObject({ type: 'list', name: '清單', filters: null, sort: [], limit: null })
    expect(base!.views[2]).toMatchObject({ type: 'cards', name: '卡片' })
  })

  it('沒有 views（```base 區塊）當作單一 table；空內容也是', () => {
    expect(parseBase('filters:\n  - file.hasTag("x")\n').base!.views).toEqual([
      { type: 'table', name: DEFAULT_VIEW_NAME, filters: null, order: [], sort: [], limit: null },
    ])
    expect(parseBase('').base!.views).toHaveLength(1)
    expect(parseBase('   \n').errors).toEqual([])
    expect(parseBase('views: []').base!.views).toHaveLength(1)
  })

  it('YAML 語法錯誤：base 為 null，附行號', () => {
    const { base, errors } = parseBase('filters:\n  and: [1\nviews: 2\n')
    expect(base).toBeNull()
    expect(errors).toHaveLength(1)
    expect(errors[0].line).toBe(3)
    expect(errors[0].message).toMatch(/\S/)
  })

  it('最上層不是物件', () => {
    expect(parseBase('- a\n- b\n').base).toBeNull()
    expect(parseBase('- a\n').errors[0].message).toMatch(/最上層/)
  })

  it('結構錯誤記進 errors，其餘仍可用', () => {
    const { base, errors } = parseBase([
      'formulas: 3',
      'properties:',
      '  a: 1',
      '  b: { displayName: B }',
      'views:',
      '  - type: table',
      '    order: nope',
      '    limit: -1',
      '    sort: x',
      '  - 3',
      '  - name: ok',
    ].join('\n'))
    expect(base).not.toBeNull()
    expect(base!.properties).toEqual({ b: { displayName: 'B' } })
    expect(base!.views.map(v => v.name)).toEqual([DEFAULT_VIEW_NAME, 'ok'])
    expect(base!.views[0]).toMatchObject({ order: [], limit: null, sort: [] })
    expect(base!.views[1].type).toBe('table')
    const messages = errors.map((e: BaseParseError) => e.message)
    expect(messages).toContainEqual(expect.stringMatching(/formulas 必須/))
    expect(messages).toContainEqual(expect.stringMatching(/properties.a/))
    expect(messages).toContainEqual(expect.stringMatching(/order/))
    expect(messages).toContainEqual(expect.stringMatching(/limit/))
    expect(messages).toContainEqual(expect.stringMatching(/sort/))
    expect(messages).toContainEqual(expect.stringMatching(/views\[1\]/))
  })

  it('sort 可用字串（預設 ASC），direction 不分大小寫', () => {
    const { base } = parseBase('views:\n  - sort: [due, { property: x, direction: desc }]\n')
    expect(base!.views[0].sort).toEqual([{ property: 'due', direction: 'ASC' }, { property: 'x', direction: 'DESC' }])
  })

  it('BOM 與數字型 formula', () => {
    const { base } = parseBase('﻿formulas:\n  one: 1\n')
    expect(base!.formulas).toEqual({ one: '1' })
  })
})

describe('normalizeFilter', () => {
  it('字串、清單（視為 and）、巢狀 and/or/not、單一節點的 not', () => {
    const errors: BaseParseError[] = []
    expect(normalizeFilter('a == 1', errors)).toBe('a == 1')
    expect(normalizeFilter('  ', errors)).toBeNull()
    expect(normalizeFilter(['a', 'b'], errors)).toEqual({ and: ['a', 'b'] })
    expect(normalizeFilter({ or: ['a', { not: 'b' }, { and: [{ or: ['c'] }] }] }, errors)).toEqual({ or: ['a', { not: ['b'] }, { and: [{ or: ['c'] }] }] })
    expect(normalizeFilter({ and: [] }, errors)).toBeNull()
    expect(errors).toEqual([])
  })

  it('不合法的節點', () => {
    const errors: BaseParseError[] = []
    expect(normalizeFilter({ xor: ['a'] }, errors)).toBeNull()
    expect(normalizeFilter({ and: ['a'], or: ['b'] }, errors)).toBeNull()
    expect(normalizeFilter(3, errors)).toBeNull()
    expect(normalizeFilter({ and: ['a', 3] }, errors)).toEqual({ and: ['a'] })
    expect(errors).toHaveLength(4)
    expect(errors[3].message).toMatch(/filters.and/)
  })
})

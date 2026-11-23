// Fork（almanac ALMNC-65.1）：提案卡差異檢視的逐行比較與摺疊。
import { describe, expect, it } from 'vitest'
import { changeLines, changeRows, changeStats, LCS_MAX_CELLS } from './change-diff'

const lines = (n: number, prefix = 'l') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join('\n')

describe('changeLines', () => {
  it('中間插一行：前後都是 equal', () => {
    expect(changeLines('a\nb\nc\n', 'a\nb\nX\nc\n')).toEqual([
      { type: 'equal', text: 'a' }, { type: 'equal', text: 'b' }, { type: 'add', text: 'X' }, { type: 'equal', text: 'c' },
    ])
  })

  it('新增（before null）全是 add、刪除（after null）全是 remove', () => {
    expect(changeLines(null, 'a\nb')).toEqual([{ type: 'add', text: 'a' }, { type: 'add', text: 'b' }])
    expect(changeLines('a', null)).toEqual([{ type: 'remove', text: 'a' }])
  })

  it('只多一個空行也看得到', () => {
    expect(changeLines('a\nb', 'a\n\nb')).toEqual([{ type: 'equal', text: 'a' }, { type: 'add', text: '' }, { type: 'equal', text: 'b' }])
  })

  it('兩處分開的修改都找得到（LCS，不是只比一段）', () => {
    const rows = changeLines('a\nb\nc\nd\ne', 'A\nb\nc\nd\nE')
    expect(rows.filter(row => row.type !== 'equal').map(row => `${row.type}:${row.text}`)).toEqual(['remove:a', 'add:A', 'remove:e', 'add:E'])
  })

  it('中段太大不跑 LCS，整段當換掉', () => {
    const size = Math.ceil(Math.sqrt(LCS_MAX_CELLS)) + 1
    const rows = changeLines(lines(size, 'a'), lines(size, 'b'))
    expect(rows).toHaveLength(size * 2)
    expect(rows[0].type).toBe('remove')
    expect(rows[size].type).toBe('add')
  })
})

describe('changeRows', () => {
  it('沒變的行摺起來，只留上下兩行', () => {
    const before = lines(20)
    const after = before.replace('l10', 'l10 改')
    expect(changeRows(before, after)).toEqual([
      { type: 'gap', count: 7 },
      { type: 'equal', text: 'l8' }, { type: 'equal', text: 'l9' },
      { type: 'remove', text: 'l10' }, { type: 'add', text: 'l10 改' },
      { type: 'equal', text: 'l11' }, { type: 'equal', text: 'l12' },
      { type: 'gap', count: 8 },
    ])
  })

  it('完全沒變回空陣列', () => {
    expect(changeRows('a\nb', 'a\nb')).toEqual([])
    expect(changeRows(null, null)).toEqual([])
  })
})

describe('changeStats', () => {
  it('新增、刪除各幾行', () => {
    expect(changeStats('a\nb\nc', 'a\nB\nc\nd')).toEqual({ added: 2, removed: 1 })
  })
})

// almanac ALMNC-45：行程的「私人」標記用穩定的鍵保存。
import { describe, expect, it } from 'vitest'
import { MAX_PRIVATE_ITEMS, normalizePrivateItems, privacyKey, setPrivate } from './privacy'

describe('privacyKey', () => {
  it('行事曆事件用事件 id；任務用路徑＋標題（不用行號）；時段綁在那一天', () => {
    expect(privacyKey({ kind: 'calendar', key: 'cal:E1', title: '看牙醫' }, '2026-11-21')).toBe('cal:E1')
    expect(privacyKey({ kind: 'task', key: 'task:a.md:12', title: ' 寫報告 ', task: { path: 'a.md' } }, '2026-11-21')).toBe('task:a.md#寫報告')
    expect(privacyKey({ kind: 'anchor', key: 'anchor:3', title: '午休' }, '2026-11-21')).toBe('anchor:2026-11-21#午休')
  })
})

describe('setPrivate／normalizePrivateItems', () => {
  it('標記與取消', () => {
    const on = setPrivate([], 'cal:E1', true)
    expect(on).toEqual(['cal:E1'])
    expect(setPrivate(on, 'cal:E1', true)).toEqual(['cal:E1'])
    expect(setPrivate(on, 'cal:E1', false)).toEqual([])
  })

  it('讀回時去重、丟掉壞值，超過上限丟最舊的', () => {
    expect(normalizePrivateItems(['a', 'a', 3, '', 'b'])).toEqual(['a', 'b'])
    const many = Array.from({ length: MAX_PRIVATE_ITEMS + 5 }, (_, i) => `cal:${i}`)
    const kept = normalizePrivateItems(many)
    expect(kept).toHaveLength(MAX_PRIVATE_ITEMS)
    expect(kept[0]).toBe('cal:5')
  })
})

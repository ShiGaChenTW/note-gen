import { describe, expect, it } from 'vitest'
import {
  folderTabCapacity,
  orderTabsByRecency,
  pickFallbackAfterClose,
  pickMountedTabIds,
  reconcileRecency,
  splitVisibleTabs,
  touchRecency,
} from './recency'

describe('touchRecency', () => {
  it('把切到的分頁移到最前面', () => {
    expect(touchRecency(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })
  it('新的分頁加在最前面', () => {
    expect(touchRecency(['a'], 'n')).toEqual(['n', 'a'])
  })
})

describe('reconcileRecency', () => {
  it('拿掉已關閉的、沒記錄的接在最後，目前這張移到最前', () => {
    expect(reconcileRecency(['x', 'b', 'a'], ['a', 'b', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  })
  it('內容沒變時回傳同一個陣列', () => {
    const recency = ['a', 'b']
    expect(reconcileRecency(recency, ['b', 'a'], 'a')).toBe(recency)
  })
})

describe('orderTabsByRecency', () => {
  const tabs = [
    { id: 'a' },
    { id: 'p1', pinned: true },
    { id: 'b' },
    { id: 'p2', pinned: true },
    { id: 'c' },
  ]
  it('固定的照原本順序排最左，其餘依最近使用', () => {
    expect(orderTabsByRecency(tabs, ['c', 'p2', 'a', 'b']).map(tab => tab.id)).toEqual(['p1', 'p2', 'c', 'a', 'b'])
  })
  it('沒記錄的排在最後並維持原本相對順序', () => {
    expect(orderTabsByRecency(tabs, ['b']).map(tab => tab.id)).toEqual(['p1', 'p2', 'b', 'a', 'c'])
  })
})

describe('pickMountedTabIds', () => {
  const tabs = Array.from({ length: 10 }, (_, index) => ({ id: `t${index}` }))
  const recency = tabs.map(tab => tab.id)

  it('最多掛載上限張，依最近使用', () => {
    const mounted = pickMountedTabIds(tabs, recency, 't0', 3)
    expect([...mounted].sort()).toEqual(['t0', 't1', 't2'])
  })
  it('目前這張即使最久沒看也一定掛載', () => {
    const mounted = pickMountedTabIds(tabs, recency, 't9', 3)
    expect(mounted.has('t9')).toBe(true)
    expect(mounted.size).toBe(3)
  })
  it('固定的分頁一定掛載，不會被卸載', () => {
    const withPinned = tabs.map(tab => tab.id === 't8' ? { ...tab, pinned: true } : tab)
    const mounted = pickMountedTabIds(withPinned, recency, 't0', 3)
    expect(mounted.has('t8')).toBe(true)
    expect([...mounted].sort()).toEqual(['t0', 't1', 't8'])
  })
  it('預設上限是 8', () => {
    expect(pickMountedTabIds(tabs, recency, 't0').size).toBe(8)
  })
})

describe('pickFallbackAfterClose', () => {
  it('切到剩下分頁裡最近使用的那張', () => {
    expect(pickFallbackAfterClose(['a', 'c', 'b'], 'a', ['b', 'c'])).toBe('c')
  })
  it('沒有記錄時用剩下的第一張', () => {
    expect(pickFallbackAfterClose([], 'a', ['b', 'c'])).toBe('b')
  })
  it('沒有剩下的分頁時回傳 undefined', () => {
    expect(pickFallbackAfterClose(['a'], 'a', [])).toBeUndefined()
  })
})

describe('folderTabCapacity', () => {
  it('全部放得下時回傳總張數', () => {
    expect(folderTabCapacity(1000, 3)).toBe(3)
  })
  it('放不下時扣掉「更多」按鈕的位置', () => {
    // (400 - 20 + 8 - 76) / 142 = 2.19 → 2 張
    expect(folderTabCapacity(400, 6)).toBe(2)
  })
  it('再窄也至少一張', () => {
    expect(folderTabCapacity(80, 6)).toBe(1)
  })
})

describe('splitVisibleTabs', () => {
  const ordered = [{ id: 'p', pinned: true }, { id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('依容量切開，最久沒看的收進更多', () => {
    const { visible, hidden } = splitVisibleTabs(ordered, 'a', 2)
    expect(visible.map(tab => tab.id)).toEqual(['p', 'a'])
    expect(hidden.map(tab => tab.id)).toEqual(['b', 'c'])
  })
  it('目前這張被擠出去時換掉最後一張看得到的', () => {
    const { visible, hidden } = splitVisibleTabs(ordered, 'c', 2)
    expect(visible.map(tab => tab.id)).toEqual(['p', 'c'])
    expect(hidden.map(tab => tab.id)).toEqual(['a', 'b'])
  })
})

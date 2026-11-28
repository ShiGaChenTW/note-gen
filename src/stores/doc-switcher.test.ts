import { beforeEach, describe, expect, it, vi } from 'vitest'
import useArticleStore, { type OpenTabInfo } from '@/stores/article'
import { useDocSwitcherStore } from '@/stores/doc-switcher'

const tab = (id: string): OpenTabInfo => ({ id, path: `${id}.md`, name: id, isFolder: false, kind: 'file' })

describe('useDocSwitcherStore', () => {
  beforeEach(() => {
    useDocSwitcherStore.setState({ recency: [] })
  })

  it('跟著 article store 的分頁與目前這張更新最近使用順序', () => {
    useArticleStore.setState({ openTabs: [tab('a'), tab('b'), tab('c')], activeTabId: 'a' })
    expect(useDocSwitcherStore.getState().recency).toEqual(['a', 'b', 'c'])

    useArticleStore.setState({ activeTabId: 'c' })
    expect(useDocSwitcherStore.getState().recency).toEqual(['c', 'a', 'b'])

    useArticleStore.setState({ openTabs: [tab('a'), tab('b')], activeTabId: 'a' })
    expect(useDocSwitcherStore.getState().recency).toEqual(['a', 'b'])
  })

  it('分頁還沒載入（空的）時不清掉舊紀錄', () => {
    useDocSwitcherStore.setState({ recency: ['x', 'y'] })
    useArticleStore.setState({ openTabs: [], activeTabId: '' })
    expect(useDocSwitcherStore.getState().recency).toEqual(['x', 'y'])
  })
})

describe('beginAnimation（ALMNC-97.6）', () => {
  it('動畫期間 animating 為 true，結束後再等一下才回到 false', () => {
    vi.useFakeTimers()
    useDocSwitcherStore.getState().beginAnimation()
    expect(useDocSwitcherStore.getState().animating).toBe(true)
    vi.advanceTimersByTime(300)
    expect(useDocSwitcherStore.getState().animating).toBe(true)
    vi.advanceTimersByTime(100)
    expect(useDocSwitcherStore.getState().animating).toBe(false)
    vi.useRealTimers()
  })

  it('連續切換時從最後一次重新計時', () => {
    vi.useFakeTimers()
    const { beginAnimation } = useDocSwitcherStore.getState()
    beginAnimation()
    vi.advanceTimersByTime(300)
    beginAnimation()
    vi.advanceTimersByTime(300)
    expect(useDocSwitcherStore.getState().animating).toBe(true)
    vi.advanceTimersByTime(100)
    expect(useDocSwitcherStore.getState().animating).toBe(false)
    vi.useRealTimers()
  })
})

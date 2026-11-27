import { beforeEach, describe, expect, it } from 'vitest'
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

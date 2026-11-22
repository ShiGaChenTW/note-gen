// almanac ALMNC-54.17：V3 一次只開一篇——版面收成單一群組、單一分頁。
import { describe, expect, it } from 'vitest'
import type { OpenTabInfo } from '@/stores/article'
import { createEditorWorkspaceLayout, getEditorGroupIds, splitEditorGroup } from './editor-group-layout'
import { collapseToSingleDocument } from './single-document'

const tab = (id: string): OpenTabInfo => ({ id, path: `${id}.md`, name: id, isFolder: false, kind: 'file' })

describe('collapseToSingleDocument', () => {
  it('leaves a single-tab layout untouched', () => {
    const layout = createEditorWorkspaceLayout([tab('a')])
    const result = collapseToSingleDocument(layout, 'a')
    expect(result.layout).toBe(layout)
    expect(result.removedTabIds).toEqual([])
  })

  it('leaves an empty layout untouched', () => {
    const layout = createEditorWorkspaceLayout([])
    expect(collapseToSingleDocument(layout, '').layout).toBe(layout)
  })

  it('replaces the previous document: keeps the newly opened tab, drops the rest', () => {
    // 開新檔時新分頁加在最後並成為使用中，舊的那頁要被收掉
    const layout = createEditorWorkspaceLayout([tab('old'), tab('new')])
    const result = collapseToSingleDocument(layout, 'new')
    const group = result.layout.groups[result.layout.activeGroupId]
    expect(group.tabIds).toEqual(['new'])
    expect(group.activeTabId).toBe('new')
    expect(result.removedTabIds).toEqual(['old'])
  })

  it('collapses split panes into the group holding the kept tab', () => {
    const base = createEditorWorkspaceLayout([tab('a'), tab('b'), tab('c')])
    const split = splitEditorGroup(base, base.activeGroupId, 'right', 'c', { moveFromGroupId: base.activeGroupId })
    expect(getEditorGroupIds(split.root)).toHaveLength(2)
    const result = collapseToSingleDocument({ ...split, maximizedGroupId: split.activeGroupId }, 'a')
    expect(getEditorGroupIds(result.layout.root)).toHaveLength(1)
    const group = result.layout.groups[result.layout.activeGroupId]
    expect(group.tabIds).toEqual(['a'])
    expect(result.layout.maximizedGroupId).toBeUndefined()
    expect(result.removedTabIds.sort()).toEqual(['b', 'c'])
  })

  it('falls back to the active group tab when the kept id is unknown', () => {
    const layout = createEditorWorkspaceLayout([tab('a'), tab('b')])
    const result = collapseToSingleDocument(layout, 'missing')
    expect(result.layout.groups[result.layout.activeGroupId].tabIds).toEqual(['b'])
    expect(result.removedTabIds).toEqual(['a'])
  })
})

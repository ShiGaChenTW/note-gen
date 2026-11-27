// almanac ALMNC-97.1：V3 可同時開多篇，但只有一個編輯群組——分割的窗格收成一個，分頁全部留下。
import { describe, expect, it } from 'vitest'
import type { OpenTabInfo } from '@/stores/article'
import { createEditorWorkspaceLayout, getEditorGroupIds, splitEditorGroup } from './editor-group-layout'
import { collapseToSingleGroup } from './single-document'

const tab = (id: string): OpenTabInfo => ({ id, path: `${id}.md`, name: id, isFolder: false, kind: 'file' })

describe('collapseToSingleGroup', () => {
  it('leaves a single-group layout untouched', () => {
    const layout = createEditorWorkspaceLayout([tab('a'), tab('b')])
    expect(collapseToSingleGroup(layout, 'b')).toBe(layout)
  })

  it('leaves an empty layout untouched', () => {
    const layout = createEditorWorkspaceLayout([])
    expect(collapseToSingleGroup(layout, '')).toBe(layout)
  })

  it('keeps every tab when a new document is opened (no longer replaces the previous one)', () => {
    const layout = createEditorWorkspaceLayout([tab('old'), tab('new')])
    const result = collapseToSingleGroup(layout, 'old')
    expect(result).toBe(layout)
    expect(result.groups[result.activeGroupId].tabIds).toEqual(['old', 'new'])
  })

  it('merges split panes into one group, keeping all tabs and clearing maximize', () => {
    const base = createEditorWorkspaceLayout([tab('a'), tab('b'), tab('c')])
    const split = splitEditorGroup(base, base.activeGroupId, 'right', 'c', { moveFromGroupId: base.activeGroupId })
    expect(getEditorGroupIds(split.root)).toHaveLength(2)
    const result = collapseToSingleGroup({ ...split, maximizedGroupId: split.activeGroupId }, 'a')
    expect(getEditorGroupIds(result.root)).toHaveLength(1)
    const group = result.groups[result.activeGroupId]
    expect([...group.tabIds].sort()).toEqual(['a', 'b', 'c'])
    expect(group.tabIds[0]).toBe('a')
    expect(group.activeTabId).toBe('a')
    expect(result.maximizedGroupId).toBeUndefined()
  })

  it('falls back to the active group tab when the kept id is unknown', () => {
    const base = createEditorWorkspaceLayout([tab('a'), tab('b'), tab('c')])
    const split = splitEditorGroup(base, base.activeGroupId, 'right', 'c', { moveFromGroupId: base.activeGroupId })
    const result = collapseToSingleGroup(split, 'missing')
    const group = result.groups[result.activeGroupId]
    expect([...group.tabIds].sort()).toEqual(['a', 'b', 'c'])
    expect(group.activeTabId).toBe(split.groups[split.activeGroupId].activeTabId)
  })
})

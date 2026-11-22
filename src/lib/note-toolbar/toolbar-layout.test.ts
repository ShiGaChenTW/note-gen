// almanac：V3 編輯區右上角工具列的顯示範圍與窄版收合。
import { describe, expect, it } from 'vitest'
import { COMPACT_TOOLBAR_WIDTH, isCompactToolbar, noteToolbarScope } from './toolbar-layout'

describe('noteToolbarScope', () => {
  it('hides the toolbar outside the active group or without a tab', () => {
    expect(noteToolbarScope({ path: 'a.md', kind: 'file' }, false)).toBe('hidden')
    expect(noteToolbarScope(undefined, true)).toBe('hidden')
  })

  it('keeps the old undo/redo rule: no toolbar for record, blank, plugin and browser tabs', () => {
    for (const kind of ['record', 'blank', 'plugin', 'browser'] as const) {
      expect(noteToolbarScope({ path: 'x', kind }, true)).toBe('hidden')
    }
  })

  it('shows note buttons only for markdown notes', () => {
    expect(noteToolbarScope({ path: 'work/a.md', kind: 'file' }, true)).toBe('note')
    expect(noteToolbarScope({ path: 'A.MD' }, true)).toBe('note')
  })

  it('keeps only the basic buttons for canvas, folders and other files', () => {
    expect(noteToolbarScope({ path: 'canvas://1', kind: 'canvas' }, true)).toBe('basic')
    expect(noteToolbarScope({ path: 'work', isFolder: true, kind: 'file' }, true)).toBe('basic')
    expect(noteToolbarScope({ path: 'img.png', kind: 'file' }, true)).toBe('basic')
    expect(noteToolbarScope({ path: 'notes.txt', kind: 'file' }, true)).toBe('basic')
    expect(noteToolbarScope({ path: 'board.canvas', kind: 'file' }, true)).toBe('basic')
  })
})

describe('isCompactToolbar', () => {
  it('collapses below the threshold, but not before the width is measured', () => {
    expect(isCompactToolbar(0)).toBe(false)
    expect(isCompactToolbar(COMPACT_TOOLBAR_WIDTH - 1)).toBe(true)
    expect(isCompactToolbar(COMPACT_TOOLBAR_WIDTH)).toBe(false)
  })
})

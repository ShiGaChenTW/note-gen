// almanac ALMNC-54.17：V3 底部格式列——項目、亮起狀態與快捷鍵顯示。
import { describe, expect, it } from 'vitest'
import { editorShortcutDefinitions } from '@/config/editor-shortcuts'
import { BOTTOM_TOOLBAR_GROUPS, BOTTOM_TOOLBAR_MORE, activeToolbarItems, formatShortcutLabel } from './bottom-format-toolbar-items'

describe('bottom toolbar items', () => {
  it('follows the reference layout and keeps less-used blocks in the more menu', () => {
    expect(BOTTOM_TOOLBAR_GROUPS.map(group => group.map(item => item.id))).toEqual([
      ['bold', 'italic', 'underline', 'strike', 'code'],
      ['heading1', 'heading2', 'heading3'],
      ['highlight', 'textColor', 'bulletList'],
      ['table', 'image', 'link'],
      ['attachment'],
    ])
    expect(BOTTOM_TOOLBAR_MORE.map(item => item.id))
      .toEqual(['orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule', 'clearFormatting'])
  })

  it('only references existing editor shortcut ids', () => {
    const known = new Set<string>(editorShortcutDefinitions.map(definition => definition.id))
    for (const item of [...BOTTOM_TOOLBAR_GROUPS.flat(), ...BOTTOM_TOOLBAR_MORE]) {
      if (item.shortcut) expect(known.has(item.shortcut)).toBe(true)
    }
  })
})

describe('activeToolbarItems', () => {
  it('maps marks, heading levels and blocks to item ids', () => {
    const on = new Set(['bold', 'heading:2', 'bulletList', 'link', 'taskList'])
    const active = activeToolbarItems((name, attrs) => on.has(attrs?.level ? `${name}:${attrs.level}` : name))
    expect([...active].sort()).toEqual(['bold', 'bulletList', 'heading2', 'link', 'taskList'])
  })

  it('never lights up insert-only actions', () => {
    const active = activeToolbarItems(() => true)
    for (const id of ['table', 'image', 'attachment', 'horizontalRule', 'clearFormatting'] as const) {
      expect(active.has(id)).toBe(false)
    }
  })
})

describe('formatShortcutLabel', () => {
  it('uses symbols on mac and words elsewhere', () => {
    expect(formatShortcutLabel('Mod+B', true)).toBe('⌘B')
    expect(formatShortcutLabel('Shift+Mod+S', true)).toBe('⇧⌘S')
    expect(formatShortcutLabel('Mod+Alt+1', true)).toBe('⌥⌘1')
    expect(formatShortcutLabel('Shift+Mod+8', false)).toBe('Ctrl+Shift+8')
    expect(formatShortcutLabel('Mod+Alt+-', false)).toBe('Ctrl+Alt+-')
    expect(formatShortcutLabel('', true)).toBe('')
  })
})

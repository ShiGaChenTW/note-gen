import { describe, expect, it } from 'vitest'

import {
  engineOfPresentation,
  normalizeEditorViewPresentation,
  presentationForEngine,
  resolveEditorViewPresentation,
} from '@/lib/editor-layout-styles'
import { normalizeSettingsSnapshot } from '@/lib/sync/settings-snapshot'
import { useEditorFocusStore } from '@/stores/editor-focus'

describe('editor view presentations (ALMNC-63)', () => {
  it('maps each presentation to its engine', () => {
    expect(engineOfPresentation('wysiwyg')).toBe('visual')
    expect(engineOfPresentation('reading')).toBe('visual')
    expect(engineOfPresentation('markup')).toBe('source')
    expect(engineOfPresentation('live')).toBe('source')
    expect(engineOfPresentation('live')).toBe('source')
    expect(presentationForEngine('visual')).toBe('wysiwyg')
    expect(presentationForEngine('source')).toBe('markup')
  })

  it('derives a missing presentation from the legacy view mode', () => {
    expect(normalizeEditorViewPresentation(undefined, 'source')).toBe('markup')
    expect(normalizeEditorViewPresentation(undefined, 'visual')).toBe('wysiwyg')
    expect(normalizeEditorViewPresentation('bogus', undefined)).toBe('wysiwyg')
    expect(normalizeEditorViewPresentation('split', 'visual')).toBe('live')
  })

  it('collapses extended presentations in the classic UI', () => {
    expect(resolveEditorViewPresentation({ preferred: 'live', effectiveMode: 'source', allowExtended: false })).toBe('markup')
    expect(resolveEditorViewPresentation({ preferred: 'reading', effectiveMode: 'visual', allowExtended: false })).toBe('wysiwyg')
    expect(resolveEditorViewPresentation({ preferred: 'live', effectiveMode: 'source', allowExtended: true })).toBe('live')
  })

  it('follows the engine when it is forced to change', () => {
    // 解析失敗退回原始碼：閱讀檢視顯示成 markup
    expect(resolveEditorViewPresentation({ preferred: 'reading', effectiveMode: 'source', allowExtended: true })).toBe('markup')
    expect(resolveEditorViewPresentation({ preferred: 'live', effectiveMode: 'visual', allowExtended: true })).toBe('wysiwyg')
  })

  it('keeps synced snapshots consistent with the engine', () => {
    const defaults = { editorViewMode: 'visual', editorViewPresentation: 'wysiwyg' }
    expect(normalizeSettingsSnapshot({ editorViewMode: 'source' }, defaults).editorViewPresentation).toBe('markup')
    expect(normalizeSettingsSnapshot({ editorViewMode: 'source', editorViewPresentation: 'live' }, defaults).editorViewPresentation).toBe('live')
    expect(normalizeSettingsSnapshot({ editorViewMode: 'visual', editorViewPresentation: 'live' }, defaults).editorViewPresentation).toBe('wysiwyg')
  })

  it('keeps focus mode in a session-only store', () => {
    const store = useEditorFocusStore
    store.getState().setFocusMode(false)
    store.getState().toggleFocusMode()
    expect(store.getState().focusMode).toBe(true)
    store.getState().toggleFocusMode()
    expect(store.getState().focusMode).toBe(false)
  })
})

describe('editor content width (almanac)', () => {
  it('gives V3 full width a 20px gap and keeps classic unchanged', async () => {
    const { getEditorContentContainerClass, V3_EDITOR_CONTENT_WIDTHS } = await import('./editor-layout-styles')
    expect(getEditorContentContainerClass({ contentWidth: 'full', isMobile: false, v3: true })).toBe('px-5')
    expect(getEditorContentContainerClass({ contentWidth: 'full', isMobile: false })).toBe('px-10')
    expect(getEditorContentContainerClass({ contentWidth: 'narrow', isMobile: false, v3: true })).toContain('max-w-2xl')
    expect(V3_EDITOR_CONTENT_WIDTHS).toEqual(['narrow', 'wide', 'full'])
  })
})

describe('focus mode shortcut (almanac)', () => {
  it('matches ⌘⇧D on mac and Ctrl+Shift+D elsewhere, nothing else', async () => {
    const { isFocusModeShortcut, focusModeShortcutLabel } = await import('@/app/core/main/editor/markdown/editor-focus-mode')
    const key = (extra: Partial<KeyboardEvent>) => ({ metaKey: false, ctrlKey: false, shiftKey: true, altKey: false, code: 'KeyD', ...extra })
    expect(isFocusModeShortcut(key({ metaKey: true }), true)).toBe(true)
    expect(isFocusModeShortcut(key({ ctrlKey: true }), true)).toBe(false)
    expect(isFocusModeShortcut(key({ ctrlKey: true }), false)).toBe(true)
    expect(isFocusModeShortcut(key({ metaKey: true, shiftKey: false }), true)).toBe(false)
    expect(isFocusModeShortcut(key({ metaKey: true, altKey: true }), true)).toBe(false)
    expect(focusModeShortcutLabel(true)).toBe('⌘⇧D')
    expect(focusModeShortcutLabel(false)).toBe('Ctrl+Shift+D')
  })

  it('lists WYSIWYG first and no longer offers the split view', async () => {
    const { EDITOR_VIEW_PRESENTATIONS } = await import('./editor-layout-styles')
    expect(EDITOR_VIEW_PRESENTATIONS).toEqual(['wysiwyg', 'reading', 'live', 'markup'])
  })
})

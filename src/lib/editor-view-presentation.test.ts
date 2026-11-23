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
    expect(engineOfPresentation('split')).toBe('source')
    expect(presentationForEngine('visual')).toBe('wysiwyg')
    expect(presentationForEngine('source')).toBe('markup')
  })

  it('derives a missing presentation from the legacy view mode', () => {
    expect(normalizeEditorViewPresentation(undefined, 'source')).toBe('markup')
    expect(normalizeEditorViewPresentation(undefined, 'visual')).toBe('wysiwyg')
    expect(normalizeEditorViewPresentation('bogus', undefined)).toBe('wysiwyg')
    expect(normalizeEditorViewPresentation('split', 'visual')).toBe('split')
  })

  it('collapses extended presentations in the classic UI', () => {
    expect(resolveEditorViewPresentation({ preferred: 'live', effectiveMode: 'source', allowExtended: false })).toBe('markup')
    expect(resolveEditorViewPresentation({ preferred: 'reading', effectiveMode: 'visual', allowExtended: false })).toBe('wysiwyg')
    expect(resolveEditorViewPresentation({ preferred: 'live', effectiveMode: 'source', allowExtended: true })).toBe('live')
  })

  it('follows the engine when it is forced to change', () => {
    // 解析失敗退回原始碼：閱讀檢視顯示成 markup
    expect(resolveEditorViewPresentation({ preferred: 'reading', effectiveMode: 'source', allowExtended: true })).toBe('markup')
    expect(resolveEditorViewPresentation({ preferred: 'split', effectiveMode: 'visual', allowExtended: true })).toBe('wysiwyg')
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

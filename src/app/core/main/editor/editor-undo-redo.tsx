'use client'

// Fork（almanac ALMNC-54.17）：V3 沒有分頁列，復原／重做移到編輯區右上角（現在是筆記工具列 editor-note-toolbar.tsx 的最後一組）。
// 行為與分頁列（tab-bar.tsx 的 runUndoRedo）相同：同樣的事件、提示文字與快捷鍵（⌘Z／⌘⇧Z）。classic 仍用分頁列上的那組。
import { useCallback, useEffect, useState } from 'react'
import emitter from '@/lib/emitter'
import { getCanvasIdFromTabPath, isCanvasTabPath } from '../canvas/canvas-tab'
import type { TabInfo } from './tab-bar'

/** 使用中分頁能不能復原／重做，以及執行的方法（畫布走 canvas-*、其他走 editor-* 事件）。 */
export function useEditorUndoRedo(activeTab: TabInfo | undefined, isActiveGroup: boolean) {
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const activeCanvasId = activeTab && (activeTab.kind === 'canvas' || isCanvasTabPath(activeTab.path))
    ? activeTab.canvasId || getCanvasIdFromTabPath(activeTab.path)
    : null

  const query = useCallback(() => {
    if (!isActiveGroup) return
    const resolve = (value: { undo: boolean, redo: boolean }) => {
      setCanUndo(value.undo)
      setCanRedo(value.redo)
    }
    if (activeCanvasId) emitter.emit('canvas-can-undo-redo', { canvasId: activeCanvasId, resolve })
    else emitter.emit('editor-can-undo-redo', { resolve })
  }, [activeCanvasId, isActiveGroup])

  useEffect(() => {
    query()
    if (!isActiveGroup) return
    const handleChange = (value: { undo: boolean, redo: boolean }) => {
      setCanUndo(value.undo)
      setCanRedo(value.redo)
    }
    if (activeCanvasId) {
      emitter.on('canvas-undo-redo-changed', handleChange)
      return () => emitter.off('canvas-undo-redo-changed', handleChange)
    }
    emitter.on('editor-undo-redo-changed', handleChange)
    return () => emitter.off('editor-undo-redo-changed', handleChange)
  }, [activeCanvasId, activeTab?.id, isActiveGroup, query])

  const run = useCallback((redo: boolean) => {
    if (activeCanvasId) emitter.emit(redo ? 'canvas-redo' : 'canvas-undo', { canvasId: activeCanvasId })
    else emitter.emit(redo ? 'editor-redo' : 'editor-undo')
    window.setTimeout(query, 0)
  }, [activeCanvasId, query])

  return { canUndo, canRedo, run }
}

'use client'

// Fork（almanac ALMNC-54.17）：V3 沒有分頁列，復原／重做移到編輯區右上角的兩個小圖示按鈕。
// 行為與分頁列（tab-bar.tsx 的 runUndoRedo）相同：同樣的事件、提示文字與快捷鍵（⌘Z／⌘⇧Z）。classic 仍用分頁列上的那組。
import { useCallback, useEffect, useState } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import { platform } from '@tauri-apps/plugin-os'
import { useTranslations } from 'next-intl'
import { TooltipButton } from '@/components/tooltip-button'
import emitter from '@/lib/emitter'
import useSettingStore from '@/stores/setting'
import { getCanvasIdFromTabPath, isCanvasTabPath } from '../canvas/canvas-tab'
import type { TabInfo } from './tab-bar'

export function EditorUndoRedo({ activeTab, isActiveGroup }: { activeTab?: TabInfo, isActiveGroup: boolean }) {
  const showEditorUndoRedo = useSettingStore(state => state.showEditorUndoRedo)
  const t = useTranslations('tabContext')
  const [modKey, setModKey] = useState('Ctrl+')
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
    try { setModKey(platform() === 'macos' ? '⌘' : 'Ctrl+') } catch { setModKey('Ctrl+') }
  }, [])

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

  const run = (redo: boolean) => {
    if (activeCanvasId) emitter.emit(redo ? 'canvas-redo' : 'canvas-undo', { canvasId: activeCanvasId })
    else emitter.emit(redo ? 'editor-redo' : 'editor-undo')
    window.setTimeout(query, 0)
  }

  if (!isActiveGroup || !showEditorUndoRedo || !activeTab) return null
  if (activeTab.kind === 'record' || activeTab.kind === 'blank' || activeTab.kind === 'plugin' || activeTab.kind === 'browser') return null

  return (
    <div className="absolute top-2 right-3 z-20 flex items-center gap-0.5 rounded-md bg-background/80 text-muted-ink" data-testid="editor-undo-redo">
      <TooltipButton icon={<Undo2 />} tooltipText={`${t('undo')} (${modKey}Z)`} side="bottom" buttonClassName="size-7 text-muted-ink hover:text-ink" disabled={!canUndo} onClick={() => run(false)} />
      <TooltipButton icon={<Redo2 />} tooltipText={`${t('redo')} (${modKey}Shift+Z)`} side="bottom" buttonClassName="size-7 text-muted-ink hover:text-ink" disabled={!canRedo} onClick={() => run(true)} />
    </div>
  )
}

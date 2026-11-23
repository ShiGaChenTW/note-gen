// Fork（almanac ALMNC-63）：專注模式。疊在任何檢視上：
// - <html data-editor-focus> 讓 style.css 藏起側欄、分頁列、狀態列（標了 data-focus-hide 的元素）
// - 淡化游標所在段落以外的內容（Tiptap 用下面的擴充標出目前區塊；CodeMirror 用 .cm-activeLine）
// - 打字機捲動：游標保持在畫面垂直中間
// - Esc 退出
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { useEffect, type RefObject } from 'react'

import { useEditorFocusStore } from '@/stores/editor-focus'

export const FOCUS_ROOT_ATTRIBUTE = 'data-editor-focus'
const focusBlockKey = new PluginKey('almanacFocusBlock')

/** 標出游標所在的最上層區塊（class is-focus-block）；只有專注模式的 CSS 會用到它。 */
export const FocusBlockExtension = Extension.create({
  name: 'almanacFocusBlock',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: focusBlockKey,
      props: {
        decorations(state) {
          const { $head } = state.selection
          if ($head.depth < 1) return DecorationSet.empty
          const from = $head.before(1)
          const node = state.doc.nodeAt(from)
          if (!node) return DecorationSet.empty
          return DecorationSet.create(state.doc, [Decoration.node(from, from + node.nodeSize, { class: 'is-focus-block' })])
        },
      },
    })]
  },
})

function isOverlayOpen() {
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'))
}

function findScrollParent(element: Element | null, boundary: HTMLElement): HTMLElement {
  for (let node = element?.parentElement ?? null; node && node !== boundary.parentElement; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return boundary
}

/** 把游標捲到捲動容器的垂直中間；回傳捲動的距離（測試用）。 */
export function centerCaret(container: HTMLElement, selection: Selection | null = window.getSelection()): number {
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return 0
  const anchor = selection.anchorNode
  if (!anchor || !container.contains(anchor)) return 0
  const range = selection.getRangeAt(0)
  let rect = range.getBoundingClientRect()
  if (rect.height === 0 && rect.top === 0) {
    const element = anchor instanceof Element ? anchor : anchor.parentElement
    if (!element) return 0
    rect = element.getBoundingClientRect()
  }
  const scroller = findScrollParent(anchor instanceof Element ? anchor : anchor.parentElement, container)
  const box = scroller.getBoundingClientRect()
  const delta = rect.top + rect.height / 2 - (box.top + box.height / 2)
  if (Math.abs(delta) < 4) return 0
  scroller.scrollTop += delta
  return delta
}

/**
 * 只有目前作用中的編輯器呼叫；focusMode 關閉或編輯器不在前景時什麼都不做。
 */
export function useEditorFocusMode(options: { active: boolean; containerRef: RefObject<HTMLElement | null> }) {
  const { active, containerRef } = options
  const focusMode = useEditorFocusStore(state => state.focusMode)
  const setFocusMode = useEditorFocusStore(state => state.setFocusMode)
  const enabled = focusMode && active

  useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    root.setAttribute(FOCUS_ROOT_ATTRIBUTE, 'true')

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || isOverlayOpen()) return
      setFocusMode(false)
    }

    let frame = 0
    const handleSelectionChange = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const container = containerRef.current
        if (container) centerCaret(container)
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      root.removeAttribute(FOCUS_ROOT_ATTRIBUTE)
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('selectionchange', handleSelectionChange)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [containerRef, enabled, setFocusMode])

  return enabled
}

// Fork（almanac ALMNC-63）：專注模式。疊在任何檢視上：
// - app 視窗切成簡單全螢幕（lib/focus-window.ts），編輯器變成正中間的閱讀卡片（style.css 的 [data-focus-editor]），
//   四周的介面留在原位，蓋一層模糊、壓暗的背景；卡片寬度與模糊程度在卡片右上角選
// - 進出都有動畫：編輯器從原本的位置平順移到卡片位置，退出時倒過來（lib/focus-transition.ts）
// - 淡化游標所在段落以外的內容（Tiptap 用下面的擴充標出目前區塊；CodeMirror 用 .cm-activeLine）
// - 溫和的打字機捲動：只在「打字或用鍵盤移動游標」時，游標跑出畫面中段才捲回來；滑鼠點擊不捲
// - 進出：⌘⇧D（Windows／Linux 為 Ctrl+Shift+D）、Esc 退出、右上角按鈕、筆記工具列、狀態列檢視選單、命令面板
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

import { enterFocusWindow, exitFocusWindow } from '@/lib/focus-window'
import {
  animateBox,
  applyBackdropLevel,
  boxOf,
  createFocusBackdrop,
  fadeBackdrop,
  followEachFrame,
  FOCUS_CARD_MS,
  FOCUS_WINDOW_MS,
  motionMs,
  pinBox,
  unpinBox,
  type BoxStyle,
} from '@/lib/focus-transition'
import { useEditorFocusStore } from '@/stores/editor-focus'

export const FOCUS_ROOT_ATTRIBUTE = 'data-editor-focus'
const focusBlockKey = new PluginKey('almanacFocusBlock')

/** 游標保持在捲動區的這個範圍內（比例）；超出才捲 */
export const CARET_BAND = { top: 0.25, bottom: 0.65 } as const
/** 鍵盤操作後多久內的游標移動算「打字造成的」 */
const KEYBOARD_WINDOW_MS = 400

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

export function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
}

export function focusModeShortcutLabel(mac = isMacPlatform()) {
  return mac ? '⌘⇧D' : 'Ctrl+Shift+D'
}

/** ⌘⇧D／Ctrl+Shift+D */
export function isFocusModeShortcut(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'code'>, mac = isMacPlatform()) {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  return mod && event.shiftKey && !event.altKey && event.code === 'KeyD'
}

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

/**
 * 游標超出捲動區的 CARET_BAND 範圍時，捲到剛好回到範圍邊緣；在範圍內就不動。回傳捲動的距離（測試用）。
 */
export function keepCaretInBand(container: HTMLElement, selection: Selection | null = window.getSelection()): number {
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
  const top = box.top + box.height * CARET_BAND.top
  const bottom = box.top + box.height * CARET_BAND.bottom
  let delta = 0
  if (rect.bottom > bottom) delta = rect.bottom - bottom
  else if (rect.top < top && scroller.scrollTop > 0) delta = Math.max(rect.top - top, -scroller.scrollTop)
  if (Math.abs(delta) < 2) return 0
  scroller.scrollTop += delta
  return delta
}

const CARD_RADIUS = 14

function cardStyleOf(element: HTMLElement): BoxStyle {
  return { ...boxOf(element), radius: CARD_RADIUS, shadow: true, paddingTop: parseFloat(getComputedStyle(element).paddingTop) || 0 }
}

function slotStyleOf(slot: Element): BoxStyle {
  return { ...boxOf(slot), radius: 0, shadow: false, paddingTop: 0 }
}

/**
 * active：這個編輯器現在可以進專注模式（作用中的編輯器、V3、桌面）；只有它會接 ⌘⇧D、做轉場。
 * 回傳專注模式是否正作用在這個編輯器上。
 */
export function useEditorFocusMode(options: { active: boolean; containerRef: RefObject<HTMLElement | null> }) {
  const { active, containerRef } = options
  const focusMode = useEditorFocusStore(state => state.focusMode)
  const blurLevel = useEditorFocusStore(state => state.blurLevel)
  const cardWidth = useEditorFocusStore(state => state.cardWidth)
  const setFocusMode = useEditorFocusStore(state => state.setFocusMode)
  const toggleFocusMode = useEditorFocusStore(state => state.toggleFocusMode)
  const enabled = focusMode && active
  /** 使用者剛切換（要播轉場）；編輯器只是重新掛載（換篇筆記）時是 null，不播 */
  const transitionRef = useRef<'enter' | 'exit' | null>(null)
  /** 退出那一刻（React 重畫之前）卡片的位置與樣子 */
  const cardStyleRef = useRef<BoxStyle | null>(null)
  const backdropRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !isFocusModeShortcut(event)) return
      event.preventDefault()
      toggleFocusMode()
    }
    // zustand 的訂閱在 setState 當下同步執行，這時畫面還是切換前的樣子
    const unsubscribe = useEditorFocusStore.subscribe((state, previous) => {
      if (state.focusMode === previous.focusMode) return
      transitionRef.current = state.focusMode ? 'enter' : 'exit'
      const element = containerRef.current
      cardStyleRef.current = !state.focusMode && element ? cardStyleOf(element) : null
    })
    window.addEventListener('keydown', handleShortcut)
    return () => {
      window.removeEventListener('keydown', handleShortcut)
      unsubscribe()
    }
  }, [active, containerRef, toggleFocusMode])

  // 卡片寬度：style.css 依 <html data-editor-focus-width> 決定
  useEffect(() => {
    if (!enabled) return
    document.documentElement.setAttribute('data-editor-focus-width', cardWidth)
    return () => document.documentElement.removeAttribute('data-editor-focus-width')
  }, [cardWidth, enabled])

  useEffect(() => {
    if (backdropRef.current) applyBackdropLevel(backdropRef.current, blurLevel)
  }, [blurLevel])

  // 轉場用 layout effect：在瀏覽器畫出來之前就把筆記釘好，不會先閃一下
  useLayoutEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    const element = containerRef.current
    const slot = element?.parentElement ?? null
    const animate = transitionRef.current === 'enter'
    transitionRef.current = null
    root.setAttribute(FOCUS_ROOT_ATTRIBUTE, 'true')

    const backdrop = createFocusBackdrop(useEditorFocusStore.getState().blurLevel)
    document.body.appendChild(backdrop)
    backdropRef.current = backdrop

    let cancelled = false
    if (animate && element && slot) {
      element.setAttribute('data-focus-phase', 'entering')
      pinBox(element, slotStyleOf(slot))
      void (async () => {
        const windowMs = motionMs(FOCUS_WINDOW_MS)
        // ① 視窗放大、背景模糊淡入；筆記釘在欄位裡跟著長大
        await Promise.all([
          enterFocusWindow(windowMs),
          followEachFrame(windowMs + 80, () => { if (!cancelled) pinBox(element, slotStyleOf(slot)) }),
          fadeBackdrop(backdrop, true, windowMs),
        ])
        if (cancelled) return
        // ② 筆記從欄位移到正中間的卡片
        const from = slotStyleOf(slot)
        unpinBox(element)
        const to = cardStyleOf(element)
        pinBox(element, from)
        await animateBox(element, from, to, motionMs(FOCUS_CARD_MS))
        if (cancelled) return
        unpinBox(element)
        element.removeAttribute('data-focus-phase')
      })()
    } else {
      backdrop.style.opacity = '1'
      void enterFocusWindow(0)
    }

    let lastKeyAt = -Infinity
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && !isOverlayOpen()) {
        setFocusMode(false)
        return
      }
      if (event.key !== 'Shift' && event.key !== 'Meta' && event.key !== 'Control' && event.key !== 'Alt') {
        lastKeyAt = performance.now()
      }
    }

    let frame = 0
    const handleSelectionChange = () => {
      if (frame || performance.now() - lastKeyAt > KEYBOARD_WINDOW_MS) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const container = containerRef.current
        if (container) keepCaretInBand(container)
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      cancelled = true
      root.removeAttribute(FOCUS_ROOT_ATTRIBUTE)
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('selectionchange', handleSelectionChange)
      if (frame) window.cancelAnimationFrame(frame)
      backdropRef.current = null
      if (element) {
        element.removeAttribute('data-focus-phase')
        unpinBox(element)
      }

      const exiting = transitionRef.current === 'exit'
      const cardStyle = cardStyleRef.current
      transitionRef.current = null
      cardStyleRef.current = null
      // 專注模式還開著：只是這個編輯器卸載（換篇筆記），視窗延後再退，新的編輯器接手就取消
      if (useEditorFocusStore.getState().focusMode || !exiting || !element || !slot || !cardStyle) {
        backdrop.remove()
        void exitFocusWindow(motionMs(FOCUS_WINDOW_MS), { deferred: useEditorFocusStore.getState().focusMode })
        return
      }
      // 倒著播：① 卡片飛回欄位、模糊淡出 ② 視窗縮回原本大小
      pinBox(element, cardStyle, 41)
      void (async () => {
        const cardMs = motionMs(FOCUS_CARD_MS)
        await Promise.all([
          animateBox(element, cardStyle, slotStyleOf(slot), cardMs),
          fadeBackdrop(backdrop, false, cardMs),
        ])
        backdrop.remove()
        unpinBox(element)
        await exitFocusWindow(motionMs(FOCUS_WINDOW_MS))
      })()
    }
  }, [containerRef, enabled, setFocusMode])

  return enabled
}

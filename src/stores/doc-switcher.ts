import { create } from 'zustand'

import useArticleStore from '@/stores/article'
import { reconcileRecency, touchRecency } from '@/app/core/main/editor/doc-switcher/recency'
import { prefersReducedMotion, SWITCH_MS } from '@/app/core/main/editor/doc-switcher/motion'

// Fork（almanac ALMNC-97.1）：V3 文件切換的最近使用順序。
// 跟 openTabs 一樣是這台電腦的狀態，存在 localStorage、不同步到其他裝置（讀寫失敗就只在這次啟動有效）。
// 切換樣式也是這台電腦的偏好（螢幕大小不同，適合的樣式不同），一樣存 localStorage。
// 跟著 article store 的 activeTabId／openTabs 自動更新，呼叫端不用自己記。
/** 文件切換樣式（ALMNC-97.2）：stack＝A 上方疊列、folder＝B 資料夾標籤（預設）、fan＝C 斜向錯開。 */
export const DOC_SWITCHER_STYLES = ['folder', 'stack', 'fan'] as const
export type DocSwitcherStyle = typeof DOC_SWITCHER_STYLES[number]
export const DEFAULT_DOC_SWITCHER_STYLE: DocSwitcherStyle = 'folder'

interface DocSwitcherState {
  recency: readonly string[]
  touch: (id: string) => void
  style: DocSwitcherStyle
  setStyle: (style: DocSwitcherStyle) => void
  /** 樣式 A、C 的疊卡是否展開（ALMNC-97.4）。只在這次啟動有效，不存檔。 */
  expanded: boolean
  setExpanded: (expanded: boolean) => void
  /** 按住 ⌃ 選卡時目前選到的分頁（ALMNC-97.5），沒有在選卡時是 null。 */
  cycleTargetId: string | null
  /**
   * 切換或展開疊卡的動畫進行中（ALMNC-97.6）。瀏覽器分頁的原生 webview 疊在畫面最上層、不能跟著動畫，
   * 這段時間先藏起來，結束後重新量大小再顯示。
   */
  animating: boolean
  /** 開始一段切換動畫；減少動態效果時不做事。 */
  beginAnimation: () => void
}

/** 動畫結束後多等一點再讓 webview 回來，避免量到動畫最後一格的位置。 */
const WEBVIEW_SETTLE_MS = 60
let animationTimer: ReturnType<typeof setTimeout> | undefined

const RECENCY_KEY = 'almanac:doc-switcher-recency'
const STYLE_KEY = 'almanac:doc-switcher-style'

function readStyle(): DocSwitcherStyle {
  try {
    const value = globalThis.localStorage?.getItem(STYLE_KEY)
    return DOC_SWITCHER_STYLES.includes(value as DocSwitcherStyle) ? value as DocSwitcherStyle : DEFAULT_DOC_SWITCHER_STYLE
  } catch {
    return DEFAULT_DOC_SWITCHER_STYLE
  }
}

function readRecency(): string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(RECENCY_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function write(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // 私密模式或被擋：只在這次啟動有效
  }
}

export const useDocSwitcherStore = create<DocSwitcherState>(set => ({
  recency: readRecency(),
  touch: (id) => set(state => ({ recency: touchRecency(state.recency, id) })),
  style: readStyle(),
  setStyle: (style) => set({ style, expanded: false }),
  expanded: false,
  setExpanded: (expanded) => set({ expanded }),
  cycleTargetId: null,
  animating: false,
  beginAnimation: () => {
    if (prefersReducedMotion()) return
    clearTimeout(animationTimer)
    set({ animating: true })
    animationTimer = setTimeout(() => set({ animating: false }), SWITCH_MS + WEBVIEW_SETTLE_MS)
  },
}))

useDocSwitcherStore.subscribe((state, prev) => {
  if (state.recency !== prev.recency) write(RECENCY_KEY, JSON.stringify(state.recency))
  if (state.style !== prev.style) write(STYLE_KEY, state.style)
})

function syncFromArticleStore() {
  const { openTabs, activeTabId } = useArticleStore.getState()
  // 開檔流程還沒載入分頁時（openTabs 為空）不清掉舊紀錄，等分頁回來再對齊。
  if (openTabs.length === 0) return
  const current = useDocSwitcherStore.getState().recency
  const next = reconcileRecency(current, openTabs.map(tab => tab.id), activeTabId)
  if (next !== current) useDocSwitcherStore.setState({ recency: next })
}

useArticleStore.subscribe((state, prev) => {
  if (state.activeTabId !== prev.activeTabId || state.openTabs !== prev.openTabs) syncFromArticleStore()
})
syncFromArticleStore()

import { create } from 'zustand'

import useArticleStore from '@/stores/article'
import { reconcileRecency, touchRecency } from '@/app/core/main/editor/doc-switcher/recency'

// Fork（almanac ALMNC-97.1）：V3 文件切換的最近使用順序。
// 跟 openTabs 一樣是這台電腦的狀態，存在 localStorage、不同步到其他裝置（讀寫失敗就只在這次啟動有效）。
// 跟著 article store 的 activeTabId／openTabs 自動更新，呼叫端不用自己記。
interface DocSwitcherState {
  recency: readonly string[]
  touch: (id: string) => void
}

const RECENCY_KEY = 'almanac:doc-switcher-recency'

function readRecency(): string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(RECENCY_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeRecency(recency: readonly string[]) {
  try {
    globalThis.localStorage?.setItem(RECENCY_KEY, JSON.stringify(recency))
  } catch {
    // 私密模式或被擋：只在這次啟動有效
  }
}

export const useDocSwitcherStore = create<DocSwitcherState>(set => ({
  recency: readRecency(),
  touch: (id) => set(state => ({ recency: touchRecency(state.recency, id) })),
}))

useDocSwitcherStore.subscribe((state, prev) => {
  if (state.recency !== prev.recency) writeRecency(state.recency)
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

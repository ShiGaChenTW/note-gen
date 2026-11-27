'use client'

// Fork（almanac ALMNC-97.2）：V3 的文件切換器。三種樣式（設定 › 外觀 › 文件切換樣式）只差在畫法，
// 資料（最近使用順序）和動作（切換、關閉、固定）都一樣。
// 注意：包住編輯內容的容器不能有 transform 或 contain，否則 TipTap 的浮動選單、/ 選單、wikilink 建議框會定位錯誤。
import { useLayoutEffect, useMemo, useRef, type ReactNode, type WheelEvent } from 'react'
import { useDocSwitcherStore } from '@/stores/doc-switcher'
import type { TabInfo } from '../tab-bar'
import { orderTabsByRecency } from './recency'
import { FolderTabsSwitcher } from './folder-tabs'
import { StackSwitcher } from './stack-switcher'
import { useSwitchInput } from './use-switch-input'

export interface DocSwitcherActions {
  onSwitch: (tabId: string) => void
  onClose: (tabId: string) => void
  onPin: (tabId: string) => void
  onUnpin: (tabId: string) => void
  /** 右鍵選單（ALMNC-97.7）：關閉其他／全部都不會關掉固定的分頁。 */
  onCloseOthers: (tabId: string) => void
  onCloseAll: () => void
  onMoveToNewWindow: (tabId: string) => void
}

export interface DocSwitcherViewProps extends DocSwitcherActions {
  /** 依顯示順序排好的分頁（固定的在前，其餘依最近使用）。 */
  tabs: TabInfo[]
  activeTabId: string
  children: ReactNode
  /** 按住 ⌃ 選卡時選到的分頁，要標出來（看不到時要換進來）。 */
  cycleTargetId: string | null
  /** 觸控板左右滑切換，掛在標題區。 */
  onWheel: (event: WheelEvent) => void
}

export interface DocSwitcherProps extends DocSwitcherActions {
  tabs: TabInfo[]
  activeTabId: string
  children: ReactNode
}

export function DocSwitcher({ tabs, activeTabId, children, ...actions }: DocSwitcherProps) {
  const style = useDocSwitcherStore(state => state.style)
  const recency = useDocSwitcherStore(state => state.recency)
  const cycleTargetId = useDocSwitcherStore(state => state.cycleTargetId)
  const ordered = useMemo(() => orderTabsByRecency(tabs, recency), [recency, tabs])
  const { onWheel } = useSwitchInput({ tabs, activeTabId, onSwitch: actions.onSwitch })
  const expanded = useDocSwitcherStore(state => state.expanded)

  // 換篇或展開／收合疊卡時標記動畫中，讓瀏覽器分頁的原生 webview 先藏起來（ALMNC-97.6）。
  const previous = useRef({ activeTabId, expanded })
  useLayoutEffect(() => {
    const changed = previous.current.activeTabId !== activeTabId || previous.current.expanded !== expanded
    previous.current = { activeTabId, expanded }
    if (changed) useDocSwitcherStore.getState().beginAnimation()
  }, [activeTabId, expanded])

  if (ordered.length === 0) return <>{children}</>
  const view = { tabs: ordered, activeTabId, cycleTargetId, onWheel, ...actions }
  if (style === 'folder') return <FolderTabsSwitcher {...view}>{children}</FolderTabsSwitcher>
  return <StackSwitcher variant={style} {...view}>{children}</StackSwitcher>
}

'use client'

// Fork（almanac ALMNC-97.2）：V3 的文件切換器。三種樣式（設定 › 外觀 › 文件切換樣式）只差在畫法，
// 資料（最近使用順序）和動作（切換、關閉、固定）都一樣。
// 注意：包住編輯內容的容器不能有 transform 或 contain，否則 TipTap 的浮動選單、/ 選單、wikilink 建議框會定位錯誤。
import { useMemo, type ReactNode } from 'react'
import { useDocSwitcherStore } from '@/stores/doc-switcher'
import type { TabInfo } from '../tab-bar'
import { orderTabsByRecency } from './recency'
import { FolderTabsSwitcher } from './folder-tabs'
import { StackSwitcher } from './stack-switcher'

export interface DocSwitcherActions {
  onSwitch: (tabId: string) => void
  onClose: (tabId: string) => void
  onPin: (tabId: string) => void
  onUnpin: (tabId: string) => void
}

export interface DocSwitcherViewProps extends DocSwitcherActions {
  /** 依顯示順序排好的分頁（固定的在前，其餘依最近使用）。 */
  tabs: TabInfo[]
  activeTabId: string
  children: ReactNode
}

export interface DocSwitcherProps extends DocSwitcherActions {
  tabs: TabInfo[]
  activeTabId: string
  children: ReactNode
}

export function DocSwitcher({ tabs, activeTabId, children, ...actions }: DocSwitcherProps) {
  const style = useDocSwitcherStore(state => state.style)
  const recency = useDocSwitcherStore(state => state.recency)
  const ordered = useMemo(() => orderTabsByRecency(tabs, recency), [recency, tabs])

  if (ordered.length === 0) return <>{children}</>
  if (style === 'folder') {
    return <FolderTabsSwitcher tabs={ordered} activeTabId={activeTabId} {...actions}>{children}</FolderTabsSwitcher>
  }
  return <StackSwitcher variant={style} tabs={ordered} activeTabId={activeTabId} {...actions}>{children}</StackSwitcher>
}

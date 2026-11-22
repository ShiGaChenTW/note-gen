'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChatFooter } from './chat/chat-footer'
import { FileFooter } from './file/file-footer'
import { PluginStatusBarCenter } from '@/components/plugins/plugin-status-bar-center'
import { UnifiedSyncStatus } from './unified-sync-status'
import { StatusBarItem, StatusBarSpacer, useStatusBarOrder } from './status-bar-order'
import { TodayStatusItem } from './today/today-status-item'
import { DailyNavStatusItem } from './daily/daily-calendar'
import { useUiV3 } from '@/lib/fork-ui'

const EDITOR_STATUS_SLOT_ID = 'main-editor-status-slot'

export const WorkspaceCoveredContext = createContext(false)

export function MainStatusBar({ workspaceCovered = false }: { workspaceCovered?: boolean }) {
  const loadOrder = useStatusBarOrder(state => state.load)
  // Fork（almanac ALMNC-56.7，P05）：V3 的狀態列不放「需處理」，不掛元件也就不掃整個筆記庫。
  const isV3 = useUiV3()
  useEffect(() => { void loadOrder() }, [loadOrder])
  return (
    <footer className="scrollbar-hide flex h-7 min-h-7 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-t border-line-soft bg-statusbar px-2 text-xs text-muted-foreground v3:text-muted-ink">
      <StatusBarItem id="system:sync" rank={0}><UnifiedSyncStatus /></StatusBarItem>
      <StatusBarItem id="system:workspace" rank={10}>
        <FileFooter />
      </StatusBarItem>
      <StatusBarSpacer id="spacer:before-plugins" rank={15} />
      <div
        id={EDITOR_STATUS_SLOT_ID}
        className="contents"
      />
      <PluginStatusBarCenter workspaceCovered={workspaceCovered} />
      <StatusBarSpacer id="spacer:after-plugins" rank={85} />
      <StatusBarItem id="fork:daily-nav" rank={86}><DailyNavStatusItem /></StatusBarItem>
      {!isV3 && <TodayStatusItem />}
      <ChatFooter embedded />
    </footer>
  )
}

export function MainStatusBarPortal({
  active = true,
  inline = false,
  children,
}: {
  active?: boolean
  inline?: boolean
  children: ReactNode
}) {
  const workspaceCovered = useContext(WorkspaceCoveredContext)
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setTarget(document.getElementById(EDITOR_STATUS_SLOT_ID))
  }, [])

  if (inline) return children
  if (workspaceCovered || !active || !target) return null
  return createPortal(children, target)
}

'use client'

import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'

import { usePluginLocalization } from '@/lib/plugins/localization'
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { CalendarCheck, ChevronDown, ChevronRight, Files, Hash, History, Inbox, LayoutDashboard, Palette } from "lucide-react"
import { FileSidebar } from "./file"
import { FileActions } from "./file/file-actions"
import { useLocale, useTranslations } from "next-intl"
import { isBuiltInLeftSidebarTab, useSidebarStore } from "@/stores/sidebar"
import { cn } from "@/lib/utils"
import { CanvasActions, CanvasSidebar } from './canvas/canvas-sidebar'
import NoteTagsSidebar from './note-tags/note-tags-sidebar'
import { TimelineSidebar } from './timeline/timeline-sidebar'
import { SidebarSearch } from './sidebar-search'
import { getPluginIcon } from '@/components/plugins/plugin-icon'
import { PluginViewSurface, PluginViewToolbar } from '@/components/plugins/plugin-view-surface'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { usePluginStore } from '@/stores/plugins'
import { resolvePluginViewTitle } from '@/app/core/setting/plugins/plugin-display'
import useHomeStore from '@/stores/home'
import useInboxStore from '@/stores/inbox'
import { openDailyNoteFromSidebar, SidebarCalendar } from './daily/sidebar-calendar'
import { SIDEBAR_ROW, SIDEBAR_ROW_ACTIVE, SIDEBAR_ROW_ACTIVE_SECONDARY } from './sidebar-row'
import { Count } from './page-ui'
import { useInboxPendingCount } from '@/lib/inbox/use-inbox-pending'

// Fork（#45）：功能入口的標籤六種語言都用英文。記錄不再放在下半部，改由 Inbox 頁（#46）處理。
const SIDEBAR_TABS = [
  { id: "files", title: "Notes", icon: Files },
  { id: "timeline", title: "Timeline", icon: History },
  { id: "canvases", title: "Canvas", icon: Palette },
  { id: "noteTags", title: "Tags", icon: Hash },
] as const

/** 外掛入口超過這個數量時，其餘收進 More。 */
const VISIBLE_PLUGIN_TABS = 3
const TOP_HEIGHT_KEY = 'leftSidebarTopHeight'
/** 上半部最少留月曆標題列＋週列＋一列入口。 */
const MIN_TOP_HEIGHT = 112
const MIN_BOTTOM_HEIGHT = 120
/** 用鍵盤調整分隔條時每次移動的高度。 */
const KEYBOARD_STEP = 16

type LauncherTab = { id: string, title: string, icon: ComponentType<{ className?: string }> }

function readTopHeight(): number | null {
  try {
    const value = Number(localStorage.getItem(TOP_HEIGHT_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function writeTopHeight(value: number | null) {
  try {
    if (value === null) localStorage.removeItem(TOP_HEIGHT_KEY)
    else localStorage.setItem(TOP_HEIGHT_KEY, String(Math.round(value)))
  } catch {
    // 存不了就只在這次啟動有效
  }
}

function LauncherButton({ icon: Icon, title, active, secondary, badge, badgeLabel, onClick, expanded }: {
  icon: ComponentType<{ className?: string }>
  title: string
  active?: boolean
  /** 首頁或 Inbox 頁開著時，下半部的選中改成次要樣式，免得跟目前頁面搶。 */
  secondary?: boolean
  /** 右側的待處理數；0 或沒給就不顯示。 */
  badge?: number
  badgeLabel?: string
  expanded?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-expanded={expanded}
      className={cn(
        "flex h-7 w-full items-center gap-2 px-2 text-left text-sm text-muted-foreground",
        SIDEBAR_ROW,
        active && (secondary ? SIDEBAR_ROW_ACTIVE_SECONDARY : SIDEBAR_ROW_ACTIVE),
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && !secondary && "text-sidebar-primary")} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {badge ? <Count value={badge} label={badgeLabel} className={active && !secondary ? 'bg-sidebar' : 'bg-sidebar-accent'} /> : null}
    </button>
  )
}

/** 上下半部之間的分隔條：拖拉調整上半部高度，雙擊恢復預設。 */
function useTopHeight(containerRef: React.RefObject<HTMLDivElement | null>, topRef: React.RefObject<HTMLDivElement | null>) {
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => setHeight(readTopHeight()), [])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    const top = topRef.current
    if (!container || !top || event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const startY = event.clientY
    const startHeight = top.getBoundingClientRect().height
    const max = Math.max(MIN_TOP_HEIGHT, container.getBoundingClientRect().height - MIN_BOTTOM_HEIGHT)
    let next = startHeight
    const move = (e: PointerEvent) => {
      next = Math.min(max, Math.max(MIN_TOP_HEIGHT, startHeight + e.clientY - startY))
      setHeight(next)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      writeTopHeight(next)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  const reset = () => {
    setHeight(null)
    writeTopHeight(null)
  }

  // 拖拉的替代操作：上下鍵每次 16px，Home／End 到最矮／最高，Enter 恢復預設。
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const container = containerRef.current
    const top = topRef.current
    if (!container || !top) return
    const max = Math.max(MIN_TOP_HEIGHT, container.getBoundingClientRect().height - MIN_BOTTOM_HEIGHT)
    const current = top.getBoundingClientRect().height
    const target = event.key === 'ArrowUp' ? current - KEYBOARD_STEP
      : event.key === 'ArrowDown' ? current + KEYBOARD_STEP
        : event.key === 'Home' ? MIN_TOP_HEIGHT
          : event.key === 'End' ? max
            : null
    if (event.key === 'Enter') {
      event.preventDefault()
      reset()
      return
    }
    if (target === null) return
    event.preventDefault()
    const next = Math.min(max, Math.max(MIN_TOP_HEIGHT, target))
    setHeight(next)
    writeTopHeight(next)
  }

  return { height, onPointerDown, onKeyDown, reset }
}

export function LeftSidebar() {
  const { leftSidebarTab, setLeftSidebarTab } = useSidebarStore()
  const t = useTranslations()
  const locale = useLocale()
  const homeVisible = useHomeStore(state => state.visible)
  const showHome = useHomeStore(state => state.show)
  const inboxVisible = useInboxStore(state => state.visible)
  const showInbox = useInboxStore(state => state.show)
  const inboxCount = useInboxPendingCount()
  const pluginsInitialized = usePluginStore((state) => state.initialized)
  const displaySettings = usePluginStore(state => state.deviceSettings)
  const installed = usePluginStore((state) => state.installed)
  usePluginLocalization(installed, locale)
  const workspaceId = usePluginStore((state) => state.currentWorkspaceId)
  const workspaceStates = usePluginStore((state) => state.workspaceStates)
  const pluginTabs: LauncherTab[] = installed.flatMap((plugin) => {
    const state = workspaceId ? workspaceStates[workspaceId]?.[plugin.manifest.id] : undefined
    const enabled = isPluginEnabledInWorkspace(plugin, state)
    return enabled ? (plugin.manifest.contributes.views ?? [])
      .filter((view) => view.location === 'left-sidebar' && isPluginDisplayVisible(displaySettings, plugin.manifest.id, view.location))
      .map((view) => ({ title: resolvePluginViewTitle(plugin, view, locale, state?.settings), icon: getPluginIcon(view.icon), id: `${plugin.manifest.id}:${view.id}` })) : []
  })
  const allTabs: LauncherTab[] = [...SIDEBAR_TABS, ...pluginTabs]
  const activeTabAvailable = allTabs.some((tab) => tab.id === leftSidebarTab)
  const activeTab = allTabs.find((tab) => tab.id === leftSidebarTab)
  const [moreOpen, setMoreOpen] = useState(false)
  const visiblePluginTabs = pluginTabs.slice(0, VISIBLE_PLUGIN_TABS)
  const morePluginTabs = pluginTabs.slice(VISIBLE_PLUGIN_TABS)
  const activeInMore = morePluginTabs.some((tab) => tab.id === leftSidebarTab)

  const containerRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const split = useTopHeight(containerRef, topRef)

  useEffect(() => {
    if (!pluginsInitialized || activeTabAvailable) return
    void setLeftSidebarTab('files')
  }, [activeTabAvailable, pluginsInitialized, setLeftSidebarTab])

  const activePluginTab = pluginTabs.find((tab) => tab.id === leftSidebarTab)
  // 筆記標籤與時間軸不進 SidebarSearch 的範圍（它只認筆記、記錄、畫布）。
  const searchTab = isBuiltInLeftSidebarTab(leftSidebarTab) && leftSidebarTab !== 'noteTags' && leftSidebarTab !== 'timeline' ? leftSidebarTab : 'files'
  const renderTab = (tab: LauncherTab) => (
    <LauncherButton key={tab.id} icon={tab.icon} title={tab.title} active={tab.id === leftSidebarTab} secondary={homeVisible || inboxVisible} onClick={() => void setLeftSidebarTab(tab.id)} />
  )

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col" data-left-sidebar>
      <div
        ref={topRef}
        className="shrink-0 overflow-y-auto"
        style={{ height: split.height ?? undefined, minHeight: MIN_TOP_HEIGHT, maxHeight: `calc(100% - ${MIN_BOTTOM_HEIGHT}px)` }}
      >
        <SidebarCalendar />
        <nav className="flex flex-col gap-px px-2 pt-1 pb-2" aria-label="Launcher">
          <LauncherButton icon={LayoutDashboard} title="Overview" active={homeVisible} onClick={showHome} />
          <LauncherButton icon={CalendarCheck} title="Today" onClick={() => openDailyNoteFromSidebar(new Date(), t('today.calendarNav.openFailed'))} />
          <LauncherButton icon={Inbox} title="Inbox" active={inboxVisible} badge={inboxCount} badgeLabel={t('inbox.pending', { count: inboxCount })} onClick={() => showInbox()} />
          <div className="mx-2 my-1.5 border-t border-sidebar-border" role="separator" />
          {SIDEBAR_TABS.map(renderTab)}
          {visiblePluginTabs.map(renderTab)}
          {morePluginTabs.length > 0 && (
            <>
              <LauncherButton icon={moreOpen ? ChevronDown : ChevronRight} title="More" active={!moreOpen && activeInMore} secondary={homeVisible || inboxVisible} expanded={moreOpen} onClick={() => setMoreOpen(open => !open)} />
              {moreOpen && <div className="flex flex-col gap-px pl-3">{morePluginTabs.map(renderTab)}</div>}
            </>
          )}
        </nav>
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label={t('leftSidebar.resize')}
        aria-valuenow={split.height === null ? undefined : Math.round(split.height)}
        aria-valuemin={MIN_TOP_HEIGHT}
        title={t('leftSidebar.resizeHint')}
        className="relative z-10 h-px shrink-0 cursor-row-resize bg-sidebar-border outline-none transition-colors duration-150 before:absolute before:inset-x-0 before:-top-1.5 before:-bottom-1.5 before:content-[''] hover:bg-sidebar-primary/60 focus-visible:bg-sidebar-ring active:bg-sidebar-primary"
        onPointerDown={split.onPointerDown}
        onKeyDown={split.onKeyDown}
        onDoubleClick={split.reset}
      />
      <Tabs value={leftSidebarTab} className="min-h-0 w-full flex-1 gap-0 overflow-hidden">
        <div className="flex h-10 w-full shrink-0 items-center justify-between gap-2 border-b px-3">
          <span className="min-w-0 truncate text-sm font-medium">{activeTab?.title ?? 'Notes'}</span>
          {activePluginTab ? (
            <div className="shrink-0">
              <PluginViewToolbar viewKey={activePluginTab.id} />
            </div>
          ) : null}
          <div className={cn("shrink-0", activePluginTab && "hidden")}>
            <div className={cn(leftSidebarTab !== "files" && "hidden")}><FileActions /></div>
            <div className={cn(leftSidebarTab !== "canvases" && "hidden")}><CanvasActions /></div>
          </div>
        </div>
        {activePluginTab ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PluginViewSurface key={activePluginTab.id} viewKey={activePluginTab.id} toolbarInHeader />
          </div>
        ) : <SidebarSearch activeTab={searchTab}>
          <div className="relative min-h-0 flex-1">
            <TabsContent
              forceMount
              value="files"
              className="absolute inset-0 m-0 overflow-hidden data-[state=inactive]:hidden"
            >
              <FileSidebar />
            </TabsContent>
            <TabsContent
              forceMount
              value="canvases"
              className="absolute inset-0 m-0 overflow-hidden data-[state=inactive]:hidden"
            >
              <CanvasSidebar />
            </TabsContent>
            <TabsContent
              forceMount
              value="timeline"
              className="absolute inset-0 m-0 overflow-hidden data-[state=inactive]:hidden"
            >
              <TimelineSidebar />
            </TabsContent>
            <TabsContent
              forceMount
              value="noteTags"
              className="absolute inset-0 m-0 overflow-hidden data-[state=inactive]:hidden"
            >
              <NoteTagsSidebar />
            </TabsContent>
          </div>
        </SidebarSearch>}
      </Tabs>
    </div>
  )
}

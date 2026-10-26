'use client'

import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'

import { usePluginLocalization } from '@/lib/plugins/localization'
import { useEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from 'react'
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { CalendarCheck, ChevronDown, ChevronRight, Files, Hash, Inbox, LayoutDashboard, Palette } from "lucide-react"
import { FileSidebar } from "./file"
import { FileActions } from "./file/file-actions"
import { useLocale, useTranslations } from "next-intl"
import { isBuiltInLeftSidebarTab, useSidebarStore } from "@/stores/sidebar"
import { cn } from "@/lib/utils"
import { CanvasActions, CanvasSidebar } from './canvas/canvas-sidebar'
import NoteTagsSidebar from './note-tags/note-tags-sidebar'
import { SidebarSearch } from './sidebar-search'
import { getPluginIcon } from '@/components/plugins/plugin-icon'
import { PluginViewSurface, PluginViewToolbar } from '@/components/plugins/plugin-view-surface'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { usePluginStore } from '@/stores/plugins'
import { resolvePluginViewTitle } from '@/app/core/setting/plugins/plugin-display'
import useHomeStore from '@/stores/home'
import useInboxStore from '@/stores/inbox'
import { openDailyNoteFromSidebar, SidebarCalendar } from './daily/sidebar-calendar'

// Fork（#45）：功能入口的標籤六種語言都用英文。記錄不再放在下半部，改由 Inbox 頁（#46）處理。
const SIDEBAR_TABS = [
  { id: "files", title: "Notes", icon: Files },
  { id: "canvases", title: "Canvas", icon: Palette },
  { id: "noteTags", title: "Tags", icon: Hash },
] as const

/** 外掛入口超過這個數量時，其餘收進 More。 */
const VISIBLE_PLUGIN_TABS = 3
const TOP_HEIGHT_KEY = 'leftSidebarTopHeight'
/** 上半部最少留月曆標題列＋週列＋一列入口。 */
const MIN_TOP_HEIGHT = 112
const MIN_BOTTOM_HEIGHT = 120

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

function LauncherButton({ icon: Icon, title, active, onClick }: {
  icon: ComponentType<{ className?: string }>
  title: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-muted font-medium text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{title}</span>
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

  return { height, onPointerDown, reset }
}

export function LeftSidebar() {
  const { leftSidebarTab, setLeftSidebarTab } = useSidebarStore()
  const t = useTranslations()
  const locale = useLocale()
  const homeVisible = useHomeStore(state => state.visible)
  const showHome = useHomeStore(state => state.show)
  const inboxVisible = useInboxStore(state => state.visible)
  const showInbox = useInboxStore(state => state.show)
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
  // 筆記標籤不進 SidebarSearch 的範圍（它只認筆記、記錄、畫布）。
  const searchTab = isBuiltInLeftSidebarTab(leftSidebarTab) && leftSidebarTab !== 'noteTags' ? leftSidebarTab : 'files'
  const renderTab = (tab: LauncherTab) => (
    <LauncherButton key={tab.id} icon={tab.icon} title={tab.title} active={tab.id === leftSidebarTab} onClick={() => void setLeftSidebarTab(tab.id)} />
  )

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col" data-left-sidebar>
      <div
        ref={topRef}
        className="shrink-0 overflow-y-auto"
        style={{ height: split.height ?? undefined, minHeight: MIN_TOP_HEIGHT, maxHeight: `calc(100% - ${MIN_BOTTOM_HEIGHT}px)` }}
      >
        <SidebarCalendar />
        <nav className="flex flex-col gap-px px-2 pb-2" aria-label="Launcher">
          <LauncherButton icon={LayoutDashboard} title="Overview" active={homeVisible} onClick={showHome} />
          <LauncherButton icon={CalendarCheck} title="Today" onClick={() => openDailyNoteFromSidebar(new Date(), t('today.calendarNav.openFailed'))} />
          <LauncherButton icon={Inbox} title="Inbox" active={inboxVisible} onClick={() => showInbox()} />
          <div className="mx-2 my-1 border-t" role="separator" />
          {SIDEBAR_TABS.map(renderTab)}
          {visiblePluginTabs.map(renderTab)}
          {morePluginTabs.length > 0 && (
            <>
              <LauncherButton icon={moreOpen ? ChevronDown : ChevronRight} title="More" active={!moreOpen && activeInMore} onClick={() => setMoreOpen(open => !open)} />
              {moreOpen && <div className="flex flex-col gap-px pl-3">{morePluginTabs.map(renderTab)}</div>}
            </>
          )}
        </nav>
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        className="group relative h-px shrink-0 cursor-row-resize bg-border before:absolute before:inset-x-0 before:-top-1 before:-bottom-1 before:content-[''] hover:bg-primary/50"
        onPointerDown={split.onPointerDown}
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

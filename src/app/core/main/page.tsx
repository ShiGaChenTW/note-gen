'use client'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { readStoredWidth, storeWidth } from "@/hooks/use-drag-width"
import { useUiV3 } from "@/lib/fork-ui"
import { useWorkspaceCovered } from "@/lib/fork-overlays/use-page-visibility"
import { LeftSidebar } from "./left-sidebar"
import { EditorLayout } from './editor/editor-layout'
import { NoteListColumn } from './note-list/note-list-column'
import { PluginRightSidebar } from '@/components/plugins/plugin-right-sidebar'
import dynamic from 'next/dynamic'
import { useSidebarStore } from "@/stores/sidebar"
import { useShallow } from "zustand/react/shallow"
import useThreadsStore from "@/stores/threads"
import { memo, useEffect, useState, useRef } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { Layout, PanelImperativeHandle } from 'react-resizable-panels'
import { restoreEditorWindows } from '@/lib/editor-windows'
import { MainStatusBar, WorkspaceCoveredContext } from './main-status-bar'
import { RightSidebarCollapsedContext } from './right-sidebar-visibility'
import { ForkServices } from './fork-services'
import { measurePageBox, pageBoxStyle, samePageBox, type PageBox } from './page-box'

// Fork（almanac ALMNC-56.3 P02）：拖分隔線、縮放視窗時 ResizableWrapper 會更新尺寸 state；
// 各面板內容不吃 props，用 memo 擋住，外層重繪時不連帶重繪整個 app。
const LeftSidebarPanel = memo(LeftSidebar)
const NoteListPanel = memo(NoteListColumn)
const RightSidebarPanel = memo(PluginRightSidebar)
const StatusBar = memo(MainStatusBar)
const Services = memo(ForkServices)

function getDefaultLayout(layoutKey: string) {
  const storageKey = `react-resizable-panels:main-layout:${layoutKey}`
  const layout = localStorage.getItem(storageKey);
  
  if (layout) {
    try {
      const parsed = JSON.parse(layout);
      // 验证总和是否为 100
      const sum = parsed.reduce((a: number, b: number) => a + b, 0);
      if (Math.abs(sum - 100) < 0.1) {
        return parsed;
      }
      // 如果总和不是 100，清除这个无效的值
      console.warn(`Invalid layout sum ${sum} for ${layoutKey}, using defaults`);
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error('Failed to parse layout:', e);
    }
  }
  
  // 根据布局组合返回默认值，但始终返回3个面板的尺寸
  switch (layoutKey) {
    case 'left-center-right':
      return [16, 54, 30] // Fork：原本 20，左側欄太寬
    case 'left-center':
      return [20, 80, 0] // 右侧折叠（Fork：原本 30）
    case 'center-right':
      return [0, 60, 40] // 左侧折叠
    case 'left-right':
      return [50, 0, 50] // 中间折叠
    case 'left':
      return [100, 0, 0] // 只有左侧
    case 'center':
      return [0, 100, 0] // 只有中间
    case 'right':
      return [0, 0, 100] // 只有右侧
    default:
      return [30, 40, 30] // 默认三等分
  }
}

const V3_LEFT_WIDTH_KEY = 'almanac:left-sidebar-width'
const V3_LEFT_MIN_PX = 200
const V3_LEFT_MAX_PX = 400

function ResizableWrapper() {
  // Fork（almanac ALMNC-56.3 P02）：只取用到的欄位；取整個 store 時，側欄任何欄位一變（分頁、搜尋字…）整個 app 都重繪。
  const {
    leftSidebarVisible,
    centerPanelVisible: preferredCenterPanelVisible,
    rightSidebarVisible,
    initSidebarState,
    toggleLeftSidebar,
    toggleRightSidebar,
  } = useSidebarStore(useShallow(state => ({
    leftSidebarVisible: state.leftSidebarVisible,
    centerPanelVisible: state.centerPanelVisible,
    rightSidebarVisible: state.rightSidebarVisible,
    initSidebarState: state.initSidebarState,
    toggleLeftSidebar: state.toggleLeftSidebar,
    toggleRightSidebar: state.toggleRightSidebar,
  })))
  
  const leftPanelRef = useRef<PanelImperativeHandle>(null)
  const centerPanelRef = useRef<PanelImperativeHandle>(null)
  const rightPanelRef = useRef<PanelImperativeHandle>(null)
  
  const isV3 = useUiV3() // Fork（almanac ALMNC-20）：v3 左欄固定 240px
  const threadsVisible = useThreadsStore(state => state.visible)
  // The threads overlay needs a center panel to occupy when the right panel collapses.
  const temporaryCenterPanel = isV3 && threadsVisible && !preferredCenterPanelVisible
  const centerPanelVisible = preferredCenterPanelVisible || temporaryCenterPanel
  const workspaceCovered = useWorkspaceCovered()
  const MIN_LEFT_SIDEBAR_WIDTH_PX = 240 // Fork：原本 320；almanac v5 規格 240px
  // Fork（almanac ALMNC-62）：v3 左欄改成可拖曳（200–400 px），寬度記在 localStorage
  const [v3LeftWidth] = useState(() => readStoredWidth(V3_LEFT_WIDTH_KEY, MIN_LEFT_SIDEBAR_WIDTH_PX, V3_LEFT_MIN_PX, V3_LEFT_MAX_PX))
  const MIN_RIGHT_SIDEBAR_WIDTH_PX = 280
  const MIN_EDITOR_WIDTH_PX = 400
  const [minLeftSidebarSize, setMinLeftSidebarSize] = useState(24)
  const [minRightSidebarSize, setMinRightSidebarSize] = useState(20)
  const [minEditorSize, setMinEditorSize] = useState(30)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(!leftSidebarVisible)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(!rightSidebarVisible)
  const [leftPanelWidth, setLeftPanelWidth] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pageBox, setPageBox] = useState<PageBox | null>(null)
  const pageBoxRef = useRef<PageBox | null>(null)

  // Fork（UI 一致性）：首頁與 Inbox 頁蓋在工作區面板上，位置與圓角跟工作區面板一致。
  // 直接量元素：面板是平貼（預設）還是卡片（自訂 CSS 的內距與圓角）都對得上。
  useEffect(() => {
    const container = containerRef.current
    const group = container?.querySelector<HTMLElement>(':scope > [data-slot="resizable-panel-group"]')
    if (!container || !group) return
    const panels = [...group.querySelectorAll<HTMLElement>(':scope > [data-slot="resizable-panel"]')]
    const measure = () => {
      const measured = measurePageBox(container, group, panels, isV3)
      // 尺寸沒變就不呼叫 setState（連一次「算完才發現一樣」的重繪都不要）
      if (samePageBox(pageBoxRef.current, measured)) return
      pageBoxRef.current = measured
      setPageBox(measured)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(group)
    panels.forEach(panel => observer.observe(panel))
    return () => observer.disconnect()
  }, [isV3, leftPanelWidth, leftSidebarVisible, centerPanelVisible, rightSidebarVisible, leftPanelCollapsed, rightPanelCollapsed])

  useEffect(() => {
    void restoreEditorWindows()
  }, [])
  
  // 使用稳定的 layoutKey 用于存储，但不作为 React key
  const visiblePanels = [
    leftSidebarVisible && 'left',
    centerPanelVisible && 'center',
    rightSidebarVisible && 'right'
  ].filter(Boolean)
  const layoutKey = visiblePanels.join('-')
  
  const calculateMinSizes = () => {
    const windowWidth = window.innerWidth
    const preferredSizes = {
      left: Math.min(Math.max(12, (MIN_LEFT_SIDEBAR_WIDTH_PX / windowWidth) * 100), 40),
      center: Math.min(Math.max(25, (MIN_EDITOR_WIDTH_PX / windowWidth) * 100), 50),
      right: Math.min(Math.max(15, (MIN_RIGHT_SIDEBAR_WIDTH_PX / windowWidth) * 100), 40),
    }
    const visibleMinimumTotal = (
      (leftSidebarVisible ? preferredSizes.left : 0)
      + (centerPanelVisible ? preferredSizes.center : 0)
      + (rightSidebarVisible ? preferredSizes.right : 0)
    )
    const scale = visibleMinimumTotal > 99 ? 99 / visibleMinimumTotal : 1

    setMinLeftSidebarSize(preferredSizes.left * (leftSidebarVisible ? scale : 1))
    setMinEditorSize(preferredSizes.center * (centerPanelVisible ? scale : 1))
    setMinRightSidebarSize(preferredSizes.right * (rightSidebarVisible ? scale : 1))
  }

  // 初始化侧边栏状态
  useEffect(() => {
    initSidebarState()
  }, [initSidebarState])

  // 窗口或可见面板变化时，重新平衡各面板的最小宽度
  useEffect(() => {
    calculateMinSizes()

    window.addEventListener('resize', calculateMinSizes)
    return () => window.removeEventListener('resize', calculateMinSizes)
  }, [centerPanelVisible, leftSidebarVisible, rightSidebarVisible])

  // 当面板可见性变化时，控制面板的折叠和展开
  useEffect(() => {
    const expandPanel = (panel: PanelImperativeHandle, fallbackSize: number) => {
      panel.expand()
      if (panel.getSize().asPercentage < 1) {
        panel.resize(`${fallbackSize}%`)
      }
    }

    const timer = setTimeout(() => {
      // 左侧面板
      if (leftPanelRef.current) {
        if (leftSidebarVisible) {
          expandPanel(leftPanelRef.current, minLeftSidebarSize)
        } else {
          leftPanelRef.current.collapse()
        }
      }
      
      // 中间面板
      if (centerPanelRef.current) {
        if (centerPanelVisible) {
          expandPanel(centerPanelRef.current, minEditorSize)
        } else {
          centerPanelRef.current.collapse()
        }
      }
      
      // 右侧面板
      if (rightPanelRef.current) {
        if (rightSidebarVisible) {
          expandPanel(rightPanelRef.current, minRightSidebarSize)
        } else {
          rightPanelRef.current.collapse()
        }
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [leftSidebarVisible, centerPanelVisible, rightSidebarVisible, minEditorSize, minLeftSidebarSize, minRightSidebarSize])

  // 根据面板可见性渲染布局
  // 注意：左侧面板始终渲染，所以 layoutKey 用于存储，但实际布局计算需要考虑左侧始终存在
  
  // 计算实际需要的默认尺寸（所有面板始终存在）
  const getActualLayout = () => {
    const savedLayout = getDefaultLayout(layoutKey)
    
    // 所有面板都始终渲染，直接返回保存的布局或默认布局
    if (savedLayout.length === 3) {
      return savedLayout
    }
    
    // 如果保存的布局不是3个值，使用默认布局
    return [30, 40, 30] // 左侧30%，中间40%，右侧30%
  }
  
  const actualLayout = getActualLayout()

  const revealLeftPanel = () => {
    if (!leftSidebarVisible) {
      void toggleLeftSidebar()
      return
    }
    leftPanelRef.current?.expand()
  }

  const revealRightPanel = () => {
    if (!rightSidebarVisible) {
      void toggleRightSidebar()
      return
    }
    rightPanelRef.current?.expand()
  }
  
  const onLayout = (layout: Layout) => {
    // 對話頁暫時借用中間面板時，版面不是使用者選的，不存；其他時候（含對話頁期間拖曳分隔線）照常存
    if (temporaryCenterPanel) return
    // 保存当前面板布局
    const storageKey = `react-resizable-panels:main-layout:${layoutKey}`
    const sizes = ['left', 'center', 'right'].map((id) => layout[id] ?? 0)
    localStorage.setItem(storageKey, JSON.stringify(sizes));
  };

  // 根据可见面板数量动态构建布局
  const renderLayout = () => {
    const panels = []
    let index = 0

    // 左侧面板
    const leftLayoutSize = actualLayout[index++]
    panels.push(
      <ResizablePanel
        key="left"
        id="left"
        panelRef={leftPanelRef}
        defaultSize={isV3 ? `${v3LeftWidth}px` : `${leftLayoutSize}%`}
        minSize={isV3 ? `${V3_LEFT_MIN_PX}px` : `${minLeftSidebarSize}%`}
        maxSize={isV3 ? `${V3_LEFT_MAX_PX}px` : undefined}
        collapsible={true}
        collapsedSize="0%"
        onResize={(size) => {
          setLeftPanelCollapsed(size.asPercentage < 0.1)
          setLeftPanelWidth(Math.round(size.inPixels))
          if (isV3 && size.inPixels >= V3_LEFT_MIN_PX - 1) storeWidth(V3_LEFT_WIDTH_KEY, size.inPixels)
        }}
      >
        <LeftSidebarPanel />
      </ResizablePanel>
    )

    // 左侧和中间之间的分隔条
    // 当中间面板可见时显示；当中间面板不可见但左右都可见时也显示（作为左右分隔条）
    const shouldShowLeftHandle = centerPanelVisible || rightSidebarVisible
    const isLeftHandleCollapsed = leftPanelCollapsed || !leftSidebarVisible
    panels.push(
      <ResizableHandle
        key="handle-left-center"
        withHandle
        collapsed={isLeftHandleCollapsed}
        expandDirection="right"
        className={shouldShowLeftHandle ? undefined : 'hidden'}
        onClick={isLeftHandleCollapsed ? revealLeftPanel : undefined}
      />
    )

    // 中间面板
    panels.push(
      <ResizablePanel
        key="center"
        id="center"
        inert={workspaceCovered}
        panelRef={centerPanelRef}
        defaultSize={`${actualLayout[index++]}%`}
        minSize={`${minEditorSize}%`}
        collapsible={true}
        collapsedSize="0%"
      >
        <WorkspaceCoveredContext.Provider value={workspaceCovered}>
          {/* Fork（almanac ALMNC-54.17）：V3「我的筆記」三欄——筆記清單在編輯器左邊；沒開清單（與 classic）時只有編輯器。
              外框兩種介面都套，切換介面時 EditorLayout 不會被重新掛載。 */}
          <div className="flex h-full w-full min-h-0 min-w-0 flex-1">
            <NoteListPanel />
            <div className="flex h-full min-h-0 min-w-0 flex-1">
              <EditorLayout />
            </div>
          </div>
        </WorkspaceCoveredContext.Provider>
      </ResizablePanel>
    )

    // 中间和右侧之间的分隔条
    // 中间面板可见时作为右侧边界；仅左侧可见时保留右侧折叠句柄
    const shouldShowRightHandle = centerPanelVisible
      || (!centerPanelVisible && leftSidebarVisible && !rightSidebarVisible)
    const isRightHandleCollapsed = rightPanelCollapsed || !rightSidebarVisible
    panels.push(
      <ResizableHandle
        key="handle-center-right"
        withHandle
        collapsed={isRightHandleCollapsed}
        expandDirection="left"
        collapsedTriggerClassName="top-12 bottom-0"
        className={shouldShowRightHandle ? undefined : 'hidden'}
        onClick={isRightHandleCollapsed ? revealRightPanel : undefined}
      />
    )

    // 右侧面板
    panels.push(
      <ResizablePanel
        key="right"
        id="right"
        // Fork（almanac ALMNC-24）：v3 全頁畫面只蓋中間，右側欄照常可用
        panelRef={rightPanelRef}
        defaultSize={`${actualLayout[index++]}%`}
        minSize={`${minRightSidebarSize}%`}
        collapsible={true}
        collapsedSize="0%"
        onResize={(size) => setRightPanelCollapsed(size.asPercentage < 0.1)}
      >
        <RightSidebarPanel />
      </ResizablePanel>
    )

    return panels
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full min-h-0 flex-col"
      // Fork #31: relative 讓首頁、Inbox 頁蓋住編輯器與右側欄；--page-* 由 measurePageBox 量出來
      style={pageBoxStyle(pageBox)}
    >
      <ResizablePanelGroup
        orientation="horizontal"
        onLayoutChanged={onLayout}
        className="min-h-0 flex-1"
      >
        {renderLayout()}
      </ResizablePanelGroup>
      <StatusBar workspaceCovered={workspaceCovered} />
      <RightSidebarCollapsedContext.Provider value={rightPanelCollapsed}>
        <Services />
      </RightSidebarCollapsedContext.Provider>
    </div>
  )
}

function Page() {
  useEffect(() => {
    // 保存当前页面路径
    async function saveCurrentPage() {
      const store = await Store.load('store.json')
      await store.set('currentPage', '/core/main')
      await store.save()
    }
    saveCurrentPage()
  }, [])

  return <ResizableWrapper />
}

export default dynamic(() => Promise.resolve(Page), { ssr: false })

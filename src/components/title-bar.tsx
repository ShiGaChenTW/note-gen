'use client'

import { useEffect, useState } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { isMobileDevice } from '@/lib/check'
import { Minus, Square, Copy, X, PanelRight, SquarePen, BookOpen } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useSidebarStore } from '@/stores/sidebar'
import { PluginTitleBar } from './plugins/plugin-title-bar'
import { PinToggle } from './pin-toggle'
import AppStatus from './app-status'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useToolbarShortcuts } from '@/hooks/use-toolbar-shortcuts'
import { LeftSidebarToggleButton, SettingsButton, usePanelVisibility, wouldCauseLeftOnly, type PanelKey } from './shell-buttons'
import { UnifiedRecordButton } from '@/app/core/main/mark/unified-record-dialog'
import { useUiV3 } from '@/lib/fork-ui'
import { useWikiNavigation } from '@/components/wiki/use-wiki-navigation'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

export function TitleBar() {
  const { openFolder: openWikiFolder } = useWikiNavigation()
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const [isMobile, setIsMobile] = useState(true)
  const [isMaximized, setIsMaximized] = useState(false)
  const { centerPanelVisible, rightSidebarVisible, leftSidebarVisible, toggleCenterPanel, toggleRightSidebar } = useSidebarStore()
  
  const visibility = usePanelVisibility()
  const blocked = (panel: PanelKey) => wouldCauseLeftOnly(visibility, panel)
  const t = useTranslations()
  const v3 = useUiV3()
  const centerLabel = t(centerPanelVisible ? 'navigation.hideCenterPanel' : 'navigation.showCenterPanel')
  const rightLabel = t(rightSidebarVisible ? 'navigation.hideRightSidebar' : 'navigation.showRightSidebar')
  // Fork（almanac ALMNC-62）：V3 側欄展開時，左側欄開關與設定移到側欄頂端，標題列就不再重複顯示。
  const shellButtonsInSidebar = v3 && leftSidebarVisible
  useToolbarShortcuts()

  useEffect(() => {
    // 检查是否为移动设备
    setIsMobile(isMobileDevice())
    
    try {
      const p = platform()
      if (p === 'macos') {
        setCurrentPlatform('macos')
      } else if (p === 'windows') {
        setCurrentPlatform('windows')
      } else if (p === 'linux') {
        setCurrentPlatform('linux')
      }
    } catch (error) {
      console.error('Error detecting platform:', error)
    }
  }, [])



  useEffect(() => {
    if (isMobile || (currentPlatform !== 'windows' && currentPlatform !== 'linux')) return

    const window = getCurrentWindow()
    let disposed = false
    let unlisten: UnlistenFn | undefined
    let requestId = 0

    const syncMaximized = async () => {
      const currentRequest = ++requestId
      try {
        const maximized = await window.isMaximized()
        if (!disposed && currentRequest === requestId) setIsMaximized(maximized)
      } catch (error) {
        console.error('Error reading maximized window state:', error)
      }
    }

    const initialize = async () => {
      try {
        const stopListening = await window.onResized(syncMaximized)
        if (disposed) {
          stopListening()
          return
        }
        unlisten = stopListening
      } catch (error) {
        console.error('Error listening for window resize:', error)
      }
      await syncMaximized()
    }

    void initialize()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [currentPlatform, isMobile])

  const handleMinimize = async () => {
    try {
      const window = getCurrentWindow()
      await window.minimize()
    } catch (error) {
      console.error('Error minimizing window:', error)
    }
  }

  const handleMaximize = async () => {
    try {
      const window = getCurrentWindow()
      await window.toggleMaximize()
      setIsMaximized(await window.isMaximized())
    } catch (error) {
      console.error('Error maximizing window:', error)
    }
  }

  const handleClose = async () => {
    try {
      const window = getCurrentWindow()
      await window.close()
    } catch (error) {
      console.error('Error closing window:', error)
    }
  }

  // 移动端不显示标题栏
  if (isMobile) {
    return null
  }

  // 平台未知时不显示
  if (currentPlatform === 'unknown') {
    return null
  }

  // macOS: 红绿灯按钮在左侧，拖拽区域需要避开
  // Windows/Linux: 控制按钮在右侧，拖拽区域需要避开
  const isMacOS = currentPlatform === 'macos'

  return (
    <TooltipProvider>
      <div
        className="fixed top-0 right-0 left-0 z-40 flex h-[36px] w-full shrink-0 flex-nowrap items-center border-b bg-background select-none"
        style={{
          // macOS 红绿灯按钮在左侧，需要留出空间（约 70px）
          paddingLeft: isMacOS ? '70px' : '0',
        }}
        data-tauri-drag-region
      >
        <div id="onboarding-target-record-toolbar" className="flex items-center gap-0.5 px-2 shrink-0" data-tauri-drag-region="false">
          {/* Fork（almanac ALMNC-54.18）：V3 左上＋改開新增資料源；classic 照舊開記錄對話框 */}
          <UnifiedRecordButton compact target={v3 ? 'source' : undefined} />
        </div>

        <PluginTitleBar location="title-bar-left" />

        <div className="flex min-w-[120px] flex-1 items-center justify-center self-stretch px-[60px]" data-tauri-drag-region>
          <PluginTitleBar location="title-bar-center" />
        </div>

        {/* 右侧按钮 */}
        <div className="flex items-center gap-0.5 px-2 shrink-0" data-tauri-drag-region="false">
          <PluginTitleBar location="title-bar-right" />
          <Tooltip>
            <TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label={t('wiki.open')} onClick={() => void openWikiFolder()}><BookOpen /></Button></TooltipTrigger>
            <TooltipContent side="bottom">{t('wiki.title')}</TooltipContent>
          </Tooltip>
          {!shellButtonsInSidebar && <LeftSidebarToggleButton />}

          {/* 中间面板切换按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${blocked('center') ? 'cursor-not-allowed opacity-50' : ''}`}
                aria-label={v3 ? centerLabel : undefined}
                aria-disabled={v3 && blocked('center') ? true : undefined}
                onClick={() => {
                  if (!blocked('center')) {
                    toggleCenterPanel()
                  }
                }}
              >
                <SquarePen className={`h-4 w-4 ${!centerPanelVisible ? 'opacity-30' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{centerLabel}</p>
            </TooltipContent>
          </Tooltip>

          {/* 右侧边栏切换按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${blocked('right') ? 'cursor-not-allowed opacity-50' : ''}`}
                aria-label={v3 ? rightLabel : undefined}
                aria-disabled={v3 && blocked('right') ? true : undefined}
                onClick={() => {
                  if (!blocked('right')) {
                    toggleRightSidebar()
                  }
                }}
              >
                <PanelRight className={`h-4 w-4 ${!rightSidebarVisible ? 'opacity-30' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{rightLabel}</p>
            </TooltipContent>
          </Tooltip>
          
          <PinToggle withTooltip={v3} />
          
          {!shellButtonsInSidebar && <SettingsButton />}
          
          <AppStatus />
        </div>

        {/* Windows 控制按钮 */}
        {!isMacOS && (
          <div className="flex items-center shrink-0 relative z-10">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-accent"
              onClick={handleMinimize}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-accent"
              onClick={handleMaximize}
              title={isMaximized ? t('common.restoreWindow') : t('common.maximizeWindow')}
              aria-label={isMaximized ? t('common.restoreWindow') : t('common.maximizeWindow')}
            >
              {isMaximized ? <Copy data-icon="inline-start" /> : <Square data-icon="inline-start" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-destructive hover:text-destructive-foreground"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

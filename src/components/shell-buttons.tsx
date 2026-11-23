'use client'

// Fork（almanac ALMNC-62）：左側欄開關與設定按鈕。V3 側欄展開時放在側欄頂端標誌旁，
// 側欄收起（或 classic 介面）時回到標題列右側，所以兩處共用同一份元件與「不能只剩左欄」的判斷。
import { Settings, Cog, PanelLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useShallow } from 'zustand/react/shallow'
import { useSidebarStore } from '@/stores/sidebar'
import useUpdateStore from '@/stores/update'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useUiV3 } from '@/lib/fork-ui'
import { cn } from '@/lib/utils'

export type PanelKey = 'left' | 'center' | 'right'
export interface PanelVisibility { left: boolean; center: boolean; right: boolean }

/** 關掉這個面板會不會變成「只剩左欄」或一個都不剩（這兩種都不允許）。打開面板一律允許。 */
export function wouldCauseLeftOnly(v: PanelVisibility, panel: PanelKey): boolean {
  if (!v[panel]) return false
  const visibleCount = [v.left, v.center, v.right].filter(Boolean).length
  if (visibleCount === 1) return true
  if (visibleCount === 2) {
    if (panel === 'center' && v.left && !v.right) return true
    if (panel === 'right' && v.left && !v.center) return true
  }
  return false
}

export function usePanelVisibility(): PanelVisibility {
  return useSidebarStore(useShallow(s => ({ left: s.leftSidebarVisible, center: s.centerPanelVisible, right: s.rightSidebarVisible })))
}

export function LeftSidebarToggleButton({ side = 'bottom', className }: { side?: 'bottom' | 'right'; className?: string }) {
  const t = useTranslations()
  const v3 = useUiV3()
  const visibility = usePanelVisibility()
  const toggleLeftSidebar = useSidebarStore(s => s.toggleLeftSidebar)
  const blocked = wouldCauseLeftOnly(visibility, 'left')
  const label = t(visibility.left ? 'navigation.hideLeftSidebar' : 'navigation.showLeftSidebar')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', blocked && 'cursor-not-allowed opacity-50', className)}
          aria-label={v3 ? label : undefined}
          aria-disabled={v3 && blocked ? true : undefined}
          onClick={() => { if (!blocked) toggleLeftSidebar() }}
        >
          <PanelLeft className={cn('h-4 w-4', !visibility.left && 'opacity-30')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}><p>{label}</p></TooltipContent>
    </Tooltip>
  )
}

export function SettingsButton({ side = 'bottom', className }: { side?: 'bottom' | 'right'; className?: string }) {
  const t = useTranslations()
  const v3 = useUiV3()
  const { open: settingsOpen, openSettings, closeSettings } = useSettingsDialogStore()
  const { hasUpdate } = useUpdateStore()
  const label = t(settingsOpen ? 'common.back' : 'common.settings')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative h-8 w-8', settingsOpen && 'bg-active hover:bg-active', className)}
          aria-label={v3 ? label : undefined}
          onClick={() => settingsOpen ? closeSettings() : openSettings()}
        >
          {settingsOpen ? <Cog className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
          {hasUpdate && !settingsOpen && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}><p>{label}</p></TooltipContent>
    </Tooltip>
  )
}

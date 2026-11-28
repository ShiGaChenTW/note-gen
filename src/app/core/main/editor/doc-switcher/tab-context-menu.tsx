'use client'

// Fork（almanac ALMNC-97.7）：文件切換器上每張分頁（B 的標籤、A/C 的前面那張標題列與後面的卡）的右鍵選單。
// 舊分頁列的功能裡只保留跟堆疊相容的：關閉、關閉其他、關閉全部、固定／取消固定、移到新視窗。
// 分割畫面與拖曳排序跟最近使用的順序規則衝突，不提供（decision-1）。「關閉其他／全部」不會關掉固定的分頁。
import type { ReactNode } from 'react'
import { ExternalLink, Pin, PinOff, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { canOpenInEditorWindow } from '@/lib/editor-windows'
import type { TabInfo } from '../tab-bar'
import type { DocSwitcherActions } from './doc-switcher'

export function TabContextMenu({ tab, actions, children }: { tab: TabInfo, actions: DocSwitcherActions, children: ReactNode }) {
  const t = useTranslations('tabContext')
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {!tab.pinned && <ContextMenuItem onSelect={() => actions.onClose(tab.id)}><X />{t('close')}</ContextMenuItem>}
        <ContextMenuItem onSelect={() => actions.onCloseOthers(tab.id)}>{t('closeOthers')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.onCloseAll()}>{t('closeAll')}</ContextMenuItem>
        <ContextMenuSeparator />
        {tab.pinned
          ? <ContextMenuItem onSelect={() => actions.onUnpin(tab.id)}><PinOff />{t('unpinTab')}</ContextMenuItem>
          : <ContextMenuItem onSelect={() => actions.onPin(tab.id)}><Pin />{t('pinTab')}</ContextMenuItem>}
        {canOpenInEditorWindow(tab) && (
          <ContextMenuItem onSelect={() => actions.onMoveToNewWindow(tab.id)}><ExternalLink />{t('moveToNewWindow')}</ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

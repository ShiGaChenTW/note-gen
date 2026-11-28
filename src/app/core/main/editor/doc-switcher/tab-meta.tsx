// Fork（almanac ALMNC-97.2）：文件切換器上每張分頁的圖示與標題。
import { FileText, Folder, Globe2, MessageSquareText, PackageOpen, Palette, type LucideIcon } from 'lucide-react'
import type { TabInfo } from '../tab-bar'

export function tabIcon(tab: TabInfo): LucideIcon {
  if (tab.isFolder) return Folder
  switch (tab.kind) {
    case 'canvas': return Palette
    case 'browser': return Globe2
    case 'record': return MessageSquareText
    case 'plugin': return PackageOpen
    default: return FileText
  }
}

/** 顯示用標題：檔案去掉副檔名，其餘用分頁名稱。 */
export function tabTitle(tab: TabInfo): string {
  if ((tab.kind === undefined || tab.kind === 'file') && !tab.isFolder) return tab.name.replace(/\.(md|markdown|txt)$/i, '')
  return tab.name
}

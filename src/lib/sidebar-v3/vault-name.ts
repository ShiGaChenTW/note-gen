// Fork（almanac ALMNC-43.12）：V3 側欄檔案樹標題、中間欄根目錄標題、整理頁副標共用的筆記庫名稱。
// 沿用工作區切換器的規則（getWorkspaceDisplayName）：雲端同步給過名稱就用它，否則取資料夾名；
// 預設工作區（workspacePath 為空）或取不到名稱時用備用文字（語系檔的 sidebarV3.vault）。
import { getWorkspaceDisplayName, getWorkspaceFolderName } from '@/lib/workspace-name'

export function vaultDisplayName(workspacePath: string, fallback: string, names: Record<string, string> = {}): string {
  const path = workspacePath.trim()
  if (!path) return fallback
  return getWorkspaceDisplayName(path, fallback, names).trim()
    || getWorkspaceFolderName(path, fallback).trim()
    || fallback
}

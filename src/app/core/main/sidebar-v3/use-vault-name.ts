'use client'

// Fork（almanac ALMNC-43.12）：目前筆記庫的顯示名稱；切換筆記庫（workspacePath 改變）時跟著變。
import { useTranslations } from 'next-intl'
import { useWorkspaceDisplayName } from '@/hooks/use-workspace-display-name'
import { vaultDisplayName } from '@/lib/sidebar-v3/vault-name'
import useSettingStore from '@/stores/setting'
import { useWorkspaceNamesStore } from '@/stores/workspace-names'

export function useVaultName(): string {
  const t = useTranslations('sidebarV3')
  const workspacePath = useSettingStore(state => state.workspacePath)
  // 掛上這個 hook 才會讀回雲端同步給工作區取的名稱。
  useWorkspaceDisplayName()
  const names = useWorkspaceNamesStore(state => state.names)
  return vaultDisplayName(workspacePath, t('vault'), names)
}

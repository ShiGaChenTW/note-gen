'use client'

import { useCallback, useEffect, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { GitBranch } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { toast } from '@/hooks/use-toast'
import useSettingStore from '@/stores/setting'
import { getWorkspaceAbsolutePath } from '@/lib/workspace'
import {
  detectGitVersionRepo,
  enableGitVersionControl,
  getGitVersionStatus,
} from '@/lib/git-versions/commands'
import {
  getGitVersionWorkspaceSettings,
  setGitVersionWorkspaceSettings,
  type GitVersionWorkspaceSettings,
} from '@/lib/git-versions/workspace-settings'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'

export function SettingVersionControl() {
  const t = useTranslations('settings.file.versionControl')
  const { workspacePath } = useSettingStore()
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [settings, setSettings] = useState<GitVersionWorkspaceSettings | null>(null)
  const [isRepo, setIsRepo] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const root = await getWorkspaceAbsolutePath()
    setWorkspaceRoot(root)
    const [workspaceSettings, status] = await Promise.all([
      getGitVersionWorkspaceSettings(root),
      getGitVersionStatus(root).catch(() => ({ isRepo: false, hasCommits: false })),
    ])
    setSettings(workspaceSettings)
    setIsRepo(status.isRepo)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, workspacePath])

  async function handleEnableChange(checked: boolean) {
    if (!workspaceRoot || busy) return
    setBusy(true)
    try {
      if (checked) {
        const detected = await detectGitVersionRepo(workspaceRoot)
        const accepted = await confirm(
          detected.hasExistingRepo ? t('confirmDescExisting') : t('confirmDescNew'),
          { title: t('confirmTitle'), kind: 'info' },
        )
        if (!accepted) return

        const result = await enableGitVersionControl(workspaceRoot)
        const next = await setGitVersionWorkspaceSettings(workspaceRoot, { enabled: true })
        setSettings(next)
        setIsRepo(true)
        toast({
          title: t('toastEnabled'),
          description: result.reusedExisting ? t('toastReused') : t('toastEnabledDesc'),
        })
      } else {
        const next = await setGitVersionWorkspaceSettings(workspaceRoot, { enabled: false })
        setSettings(next)
      }
    } catch (error) {
      console.error('切換版本管理失敗:', error)
      toast({
        title: t('toastError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleAutoSnapshotChange(checked: boolean) {
    if (!workspaceRoot || busy) return
    setBusy(true)
    try {
      const next = await setGitVersionWorkspaceSettings(workspaceRoot, { autoSnapshotEnabled: checked })
      setSettings(next)
    } catch (error) {
      console.error('切換自動快照失敗:', error)
      toast({
        title: t('toastError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const enabled = settings?.enabled ?? false
  const autoSnapshotEnabled = settings?.autoSnapshotEnabled ?? true

  return (
    <ItemGroup className="gap-3">
      <Item variant="outline">
        <ItemMedia variant="icon"><GitBranch /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('enable')}</ItemTitle>
          <ItemDescription>
            {enabled ? (isRepo ? t('statusRepo') : t('statusNotRepo')) : t('desc')}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto mobile-setting-inline-action">
          <Switch
            checked={enabled}
            disabled={busy || settings === null}
            aria-label={t('enable')}
            onCheckedChange={(checked) => void handleEnableChange(checked)}
          />
        </ItemActions>
      </Item>

      <Item variant="outline" aria-disabled={!enabled}>
        <ItemMedia variant="icon"><GitBranch /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('autoSnapshotLabel')}</ItemTitle>
          <ItemDescription>{t('autoSnapshotDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto mobile-setting-inline-action">
          <Switch
            checked={autoSnapshotEnabled}
            disabled={busy || !enabled}
            aria-label={t('autoSnapshotLabel')}
            onCheckedChange={(checked) => void handleAutoSnapshotChange(checked)}
          />
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}

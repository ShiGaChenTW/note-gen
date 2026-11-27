'use client'

// Fork（almanac ALMNC-85.2 骨架）：設定頁同步區塊的 V3 同步開關與主力裝置（設計 1.8、M10，最小 UI）。
import { useCallback, useEffect, useState } from 'react'
import { Layers } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import emitter from '@/lib/emitter'
import type { AlmanacSyncStatus } from '@/lib/almanac-sync/runtime'

interface AlmanacV3SyncPanelProps {
  status: AlmanacSyncStatus | null
  busy: boolean
  error: string | null
  onToggle: (checked: boolean) => void
  onMakePrimary: () => void
}

export function AlmanacV3SyncPanel({ status, busy, error, onToggle, onMakePrimary }: AlmanacV3SyncPanelProps) {
  const t = useTranslations('settings.sync.almanacV3')
  const enabled = Boolean(status?.enabled)
  const primaryId = status?.devices?.primaryDeviceId ?? null
  const primaryName = primaryId ? status?.devices?.devices[primaryId]?.name ?? primaryId : null
  const primaryLabel = !primaryName
    ? t('primaryUnknown')
    : primaryId === status?.deviceId
      ? t('primarySelf', { name: primaryName })
      : t('primary', { name: primaryName })

  return (
    <Item variant="outline" size="sm" className="mobile-setting-inline-item flex-wrap">
      <ItemMedia variant="icon"><Layers /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription>{t('desc')}</ItemDescription>
        {enabled && (
          <div className="mt-2 flex flex-col gap-1 text-sm">
            {!status?.firstCompletedAt && <p className="text-muted-foreground">{t('firstSyncPending')}</p>}
            <p>{primaryLabel}</p>
            <p className="text-muted-foreground">{t('primaryDesc')}</p>
            {status?.primaryStale && <p className="text-amber-600 dark:text-amber-400">{t('primaryStale')}</p>}
            {!status?.isPrimary && (
              <div>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onMakePrimary}>
                  {t('makePrimary')}
                </Button>
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      </ItemContent>
      <ItemActions className="mobile-setting-inline-action">
        <Switch checked={enabled} disabled={busy} onCheckedChange={onToggle} aria-label={t('title')} />
      </ItemActions>
    </Item>
  )
}

/** 接上 runtime 的版本：讀狀態、開關、指定主力裝置。 */
export function AlmanacV3SyncSection() {
  const [status, setStatus] = useState<AlmanacSyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { getAlmanacSyncStatus } = await import('@/lib/almanac-sync/runtime')
      setStatus(await getAlmanacSyncStatus())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const listener = () => { void refresh() }
    emitter.on('almanac-sync-state-changed', listener)
    return () => emitter.off('almanac-sync-state-changed', listener)
  }, [refresh])

  const handleToggle = async (checked: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const runtime = await import('@/lib/almanac-sync/runtime')
      if (checked) {
        const result = await runtime.enableAlmanacV3Sync()
        if (!result.ok) setError(result.error ?? null)
      } else {
        await runtime.disableAlmanacV3Sync()
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const handleMakePrimary = async () => {
    setBusy(true)
    try {
      const { requestAlmanacPrimaryDevice } = await import('@/lib/almanac-sync/runtime')
      await requestAlmanacPrimaryDevice()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  return <AlmanacV3SyncPanel status={status} busy={busy} error={error} onToggle={handleToggle} onMakePrimary={handleMakePrimary} />
}

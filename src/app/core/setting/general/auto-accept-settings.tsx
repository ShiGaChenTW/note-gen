'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { useUiV3 } from '@/lib/fork-ui'
import { useAutoAcceptSettings } from '@/lib/workbench/auto-accept-settings'

export function AutoAcceptSettings() {
  const v3 = useUiV3()
  const t = useTranslations('autoAcceptLinks')
  const { ready, enabled, load, setEnabled } = useAutoAcceptSettings()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (v3) void load().catch(error => console.debug('[workbench] auto-accept settings unavailable:', error))
  }, [v3, load])

  if (!v3) return null
  async function toggle(next: boolean) {
    setBusy(true)
    try { await setEnabled(next) }
    catch { toast.error(t('settingsError')) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-md border p-4">
      <div>
        <label htmlFor="auto-accept-links" className="text-sm font-medium">{t('title')}</label>
        <p id="auto-accept-links-desc" className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <Switch id="auto-accept-links" aria-describedby="auto-accept-links-desc" checked={enabled} disabled={!ready || busy}
        onCheckedChange={next => void toggle(next)} />
    </div>
  )
}

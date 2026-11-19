'use client'

import type { ReactElement } from 'react'
import { useTranslations } from 'next-intl'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function StatusBarSettingsTooltip({ reason, children }: { reason: string; children: ReactElement }) {
  const t = useTranslations('statusBar')
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{t('settingsErrorHint', { reason })}</TooltipContent>
    </Tooltip>
  )
}

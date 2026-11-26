'use client'

import { Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SettingType } from '@/app/core/setting/components/setting-base'
import { RecentlyDeletedView } from '@/components/trash/recently-deleted-view'

export default function TrashSettingPage() {
  const t = useTranslations('settings.trash')

  return (
    <SettingType id="trash" title={t('title')} desc={t('desc')} icon={<Trash2 className="size-5" />}>
      <RecentlyDeletedView />
    </SettingType>
  )
}

'use client'

import { useTranslations } from 'next-intl'
import { SettingType } from '../components/setting-base'
import { Settings } from 'lucide-react'
import { InterfaceSettings } from './interface-settings'
import { AdvancedSettings } from './advanced-settings'
import { SystemBehaviorSettings } from './system-behavior-settings'

export default function GeneralSettingsPage() {
  const t = useTranslations('settings.general')

  return (
    <SettingType
      id="general"
      title={t('title')}
      desc={t('desc')}
      icon={<Settings className="size-4 lg:size-6" />}
    >
      <SystemBehaviorSettings />
      <InterfaceSettings />
      {/* Fork（almanac ALMNC-83.5）：夥伴、Agent 設定區、調研與回顧、自動整理、自動接受搬到夥伴分頁，RSS 搬到電子紙頁。 */}
      <AdvancedSettings />
    </SettingType>
  )
}

'use client'

import { useTranslations } from 'next-intl'
import { SettingType } from '../components/setting-base'
import { Settings } from 'lucide-react'
import { InterfaceSettings } from './interface-settings'
import { AdvancedSettings } from './advanced-settings'
import { SystemBehaviorSettings } from './system-behavior-settings'
import { OrganizeSettings } from '../../main/organize/organize-settings'
import { AgentSettings } from '../agents/agent-settings'
import { RssSettings } from '../rss/rss-settings'

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
      <AgentSettings />
      <OrganizeSettings />
      {/* Fork（almanac ALMNC-57.2）：RSS 訂閱（只在 V3），接在其他 V3 設定後面。 */}
      <RssSettings />
      <AdvancedSettings />
    </SettingType>
  )
}

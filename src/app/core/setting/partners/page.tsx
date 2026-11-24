'use client'

// Fork（almanac ALMNC-83.5）：設定 > 夥伴。只在新介面（V3）出現；classic 不列在選單、也不顯示內容。
// 從常規設定搬來：夥伴名單、Agent 設定區（含對話記憶，ALMNC-83.2）、調研與回顧、自動整理、自動接受。
import { useTranslations } from 'next-intl'
import { Users } from 'lucide-react'
import { useUiV3 } from '@/lib/fork-ui'
import { SettingType } from '../components/setting-base'
import { AgentSettings } from '../agents/agent-settings'
import { OrganizeSettings } from '../../main/organize/organize-settings'
import { AutoAcceptSettings } from '../general/auto-accept-settings'

export default function PartnersSettingPage() {
  const v3 = useUiV3()
  return v3 ? <PartnersSettings /> : null
}

function PartnersSettings() {
  const t = useTranslations('settings.partners')
  return (
    <SettingType id="partners" title={t('title')} desc={t('desc')} icon={<Users className="size-4 lg:size-6" />}>
      <AgentSettings />
      <OrganizeSettings />
      <AutoAcceptSettings />
    </SettingType>
  )
}

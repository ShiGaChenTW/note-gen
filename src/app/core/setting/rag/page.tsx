'use client'

import { useTranslations } from 'next-intl'
import { BookOpen, Layers } from 'lucide-react'
import { toast } from 'sonner'
import { SettingType } from '../components/setting-base'
import { ModelSetting } from './model-setting'
import { Settings } from './settings'
import { WikiSettingsPanel } from '@/components/wiki/wiki-settings-panel'
import { WikiKnowledgePreferences } from '@/components/wiki/wiki-knowledge-preferences'
import { KnowledgeSettingCard } from '@/components/wiki/knowledge-setting-card'
import { useWikiData } from '@/components/wiki/use-wiki-data'
import { useWikiErrorMessage } from '@/components/wiki/use-wiki-error-message'
import { updateWikiSettings } from '@/lib/wiki/settings'
import { Switch } from '@/components/ui/switch'
import { assertWikiContextCurrent } from '@/lib/wiki/context'
import { useWikiActionScope } from '@/components/wiki/use-wiki-action-scope'
import { useUiV3 } from '@/lib/fork-ui'

export default function KnowledgeSetting() {
  const t = useTranslations('settings.rag')
  const wiki = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()
  const { data, refresh } = useWikiData()
  const { busy, beginAction } = useWikiActionScope(data?.context.id ?? 'loading')
  const semanticEnabled = data?.settings.semanticSearchEnabled ?? false
  // Fork（almanac ALMNC-83.1）：V3 下只留語意檢索；LLM Wiki 直接寫 Markdown、不經提案，入口隱藏（wiki 資料與設定保留）。
  const v3 = useUiV3()

  async function toggleSemantic(semanticSearchEnabled: boolean) {
    if (!data) return
    const operation = beginAction()
    try {
      await assertWikiContextCurrent(data.context.id)
      if (!operation.isCurrent()) return
      await updateWikiSettings({ semanticSearchEnabled }, data.context.id)
      if (operation.isCurrent()) await refresh()
    } catch (error) {
      if (operation.isCurrent()) toast.error(wiki('failed'), { description: errorMessage(error) })
    } finally { operation.finish() }
  }

  return <SettingType id="rag" title={v3 ? t('semanticTitle') : wiki('title')} desc={v3 ? t('semanticDesc') : wiki('description')} icon={<BookOpen />}>
    {v3 ? null : <WikiSettingsPanel />}
    <KnowledgeSettingCard title={t('ragTitle')} description={t(v3 ? 'semanticCardDescription' : 'ragDescription')} icon={Layers} label={wiki('optionalMode')} enabled={semanticEnabled} actions={<Switch aria-label={t('ragTitle')} checked={semanticEnabled} disabled={busy || !data} onCheckedChange={enabled => void toggleSemantic(enabled)} />}>
      {semanticEnabled ? <>
        <ModelSetting kind="embedding" />
        <Settings />
      </> : null}
    </KnowledgeSettingCard>
    <WikiKnowledgePreferences />
  </SettingType>
}

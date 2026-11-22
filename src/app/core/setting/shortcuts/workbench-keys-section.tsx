'use client'

// Fork（almanac ALMNC-56.4，RPT-2026-009 A02）：V3 工作台的單鍵 N（新增資料源）、T（新增對話）可以關掉（WCAG 2.1.4）。
// 只在新介面出現；classic 沒有這組單鍵。
import { useTranslations } from 'next-intl'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { useUiV3 } from '@/lib/fork-ui'
import useSettingStore from '@/stores/setting'
import { SettingSection } from '../components/setting-base'

export function WorkbenchKeysSection() {
  const t = useTranslations('settings.shortcuts.workbenchKeys')
  const isV3 = useUiV3()
  const enabled = useSettingStore(state => state.workbenchSingleKeys)
  const setEnabled = useSettingStore(state => state.setWorkbenchSingleKeys)
  if (!isV3) return null
  return (
    <SettingSection title={t('title')} desc={t('desc')}>
      <ItemGroup className="gap-4">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t('singleKeys.title')}</ItemTitle>
            <ItemDescription>{t('singleKeys.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={enabled !== false}
              onCheckedChange={value => void setEnabled(value)}
              aria-label={t('singleKeys.title')}
              data-testid="workbench-single-keys"
            />
          </ItemActions>
        </Item>
      </ItemGroup>
    </SettingSection>
  )
}

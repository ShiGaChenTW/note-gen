'use client'

// Fork（almanac ALMNC-97.2）：設定 › 外觀 › 文件切換樣式（只在 V3 顯示）。
import { useTranslations } from 'next-intl'
import { Layers } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DOC_SWITCHER_STYLES, useDocSwitcherStore, type DocSwitcherStyle } from '@/stores/doc-switcher'

export function DocSwitcherStyleSettings() {
  const t = useTranslations('settings.general.interface.docSwitcher')
  const style = useDocSwitcherStore(state => state.style)
  const setStyle = useDocSwitcherStore(state => state.setStyle)

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><Layers /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription>{t('desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
        <ToggleGroup
          type="single"
          variant="outline"
          value={style}
          onValueChange={(value) => { if (value) setStyle(value as DocSwitcherStyle) }}
          aria-label={t('title')}
          className="w-full sm:w-auto"
        >
          {DOC_SWITCHER_STYLES.map(option => (
            <ToggleGroupItem key={option} value={option} className="flex-1 sm:flex-none">
              {t(`options.${option}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </ItemActions>
    </Item>
  )
}

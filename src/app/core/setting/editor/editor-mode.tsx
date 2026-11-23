'use client'

import { Code2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  CLASSIC_EDITOR_VIEW_PRESENTATIONS,
  EDITOR_VIEW_PRESENTATIONS,
  isEditorViewPresentation,
} from '@/lib/editor-layout-styles'
import { isMobileDevice } from '@/lib/check'
import { useUiV3 } from '@/lib/fork-ui'
import useSettingStore from '@/stores/setting'

export default function EditorMode() {
  const t = useTranslations('settings.editor.mode')
  const tViews = useTranslations('editor.viewModes')
  const { editorViewPresentation, setEditorViewPresentation } = useSettingStore()
  // Fork（almanac ALMNC-63）：V3 桌面版有五種檢視；classic 與手機維持原本兩種
  const isV3 = useUiV3()
  const options = isV3 && !isMobileDevice() ? EDITOR_VIEW_PRESENTATIONS : CLASSIC_EDITOR_VIEW_PRESENTATIONS
  const value = options.includes(editorViewPresentation)
    ? editorViewPresentation
    : editorViewPresentation === 'reading' ? 'wysiwyg' : 'markup'

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Code2 />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription>{t('desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
        <ToggleGroup
          type="single"
          variant="outline"
          value={value}
          className="w-full flex-wrap sm:w-auto"
          aria-label={t('title')}
          onValueChange={(next) => {
            if (isEditorViewPresentation(next)) void setEditorViewPresentation(next)
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem
              key={option}
              value={option}
              className="flex-1 sm:flex-none"
              aria-label={tViews(option)}
              title={tViews(`desc.${option}`)}
            >
              {tViews(option)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </ItemActions>
    </Item>
  )
}

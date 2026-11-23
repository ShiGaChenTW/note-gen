'use client'

// Fork（almanac ALMNC-63）：狀態列的檢視選單——五種檢視加上可疊加的專注模式。
import { BookOpen, Code2, Columns2, Eye, Focus, PenLine, type LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isEditorViewPresentation, type EditorViewPresentation } from '@/lib/editor-layout-styles'
import { useEditorFocusStore } from '@/stores/editor-focus'

export const VIEW_PRESENTATION_ICONS: Record<EditorViewPresentation, LucideIcon> = {
  markup: Code2,
  live: PenLine,
  split: Columns2,
  reading: BookOpen,
  wysiwyg: Eye,
}

interface ViewModeMenuProps {
  value: EditorViewPresentation
  options: readonly EditorViewPresentation[]
  onSelect: (presentation: EditorViewPresentation) => void
  showFocusToggle?: boolean
}

export function ViewModeMenu({ value, options, onSelect, showFocusToggle = true }: ViewModeMenuProps) {
  const t = useTranslations('editor.viewModes')
  const focusMode = useEditorFocusStore(state => state.focusMode)
  const setFocusMode = useEditorFocusStore(state => state.setFocusMode)
  const Icon = VIEW_PRESENTATION_ICONS[value]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          title={t('menuTitle')}
          aria-label={`${t('menuTitle')}：${t(value)}`}
          data-editor-view-mode={value}
        >
          <Icon />
          <span>{t(value)}</span>
          {focusMode ? <Focus aria-label={t('focus')} /> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-60">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (isEditorViewPresentation(next) && next !== value) onSelect(next)
          }}
        >
          {options.map((option) => {
            const OptionIcon = VIEW_PRESENTATION_ICONS[option]
            return (
              <DropdownMenuRadioItem key={option} value={option} className="items-start">
                <OptionIcon className="mt-0.5" />
                <span className="flex min-w-0 flex-col">
                  <span>{t(option)}</span>
                  <span className="text-xs text-muted-foreground">{t(`desc.${option}`)}</span>
                </span>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        {showFocusToggle ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={focusMode} onCheckedChange={(checked) => setFocusMode(checked === true)}>
              <Focus />
              <span>{t('focus')}</span>
            </DropdownMenuCheckboxItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

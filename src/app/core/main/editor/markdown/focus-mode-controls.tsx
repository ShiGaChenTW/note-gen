'use client'

// Fork（almanac ALMNC-63）：專注模式閱讀卡片右上角的控制列：卡片寬度（窄／較寬／最寬）、背景模糊（輕／中／重）、退出。
import { Minimize2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { FOCUS_BLUR_LEVELS, FOCUS_CARD_WIDTHS, type FocusBlurLevel, type FocusCardWidth } from '@/lib/focus-transition'
import { cn } from '@/lib/utils'
import { useEditorFocusStore } from '@/stores/editor-focus'
import { focusModeShortcutLabel } from './editor-focus-mode'

const WIDTH_KEYS: Record<FocusCardWidth, 'focusWidthNarrow' | 'focusWidthWide' | 'focusWidthFull'> = {
  narrow: 'focusWidthNarrow',
  wide: 'focusWidthWide',
  full: 'focusWidthFull',
}
const BLUR_KEYS: Record<FocusBlurLevel, 'focusBlurLight' | 'focusBlurMedium' | 'focusBlurStrong'> = {
  light: 'focusBlurLight',
  medium: 'focusBlurMedium',
  strong: 'focusBlurStrong',
}

function Segmented<T extends string>({ label, value, options, labelOf, onChange }: {
  label: string
  value: T
  options: readonly T[]
  labelOf: (option: T) => string
  onChange: (option: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      <span className="px-1 text-xs text-faint">{label}</span>
      <div className="flex rounded-md bg-hover p-0.5">
        {options.map(option => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            onClick={() => onChange(option)}
            className={cn(
              'cursor-pointer rounded-[5px] px-2 py-0.5 text-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ink/60',
              option === value ? 'bg-bg text-ink shadow-sm' : 'text-muted-ink hover:text-ink',
            )}
          >
            {labelOf(option)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function FocusModeControls() {
  const t = useTranslations('editor.viewModes')
  const blurLevel = useEditorFocusStore(state => state.blurLevel)
  const cardWidth = useEditorFocusStore(state => state.cardWidth)
  const { setBlurLevel, setCardWidth, setFocusMode } = useEditorFocusStore.getState()

  return (
    <div className="editor-focus-exit absolute right-3 top-2 z-40 flex items-center gap-3" data-testid="editor-focus-controls">
      <Segmented
        label={t('focusWidth')}
        value={cardWidth}
        options={FOCUS_CARD_WIDTHS}
        labelOf={option => t(WIDTH_KEYS[option])}
        onChange={setCardWidth}
      />
      <Segmented
        label={t('focusBlur')}
        value={blurLevel}
        options={FOCUS_BLUR_LEVELS}
        labelOf={option => t(BLUR_KEYS[option])}
        onChange={setBlurLevel}
      />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-muted-ink"
        title={t('focusHint', { shortcut: focusModeShortcutLabel() })}
        onClick={() => setFocusMode(false)}
      >
        <Minimize2 />
        <span>{t('focusExit')}</span>
        <kbd className="font-sans text-xs text-faint">Esc</kbd>
      </Button>
    </div>
  )
}

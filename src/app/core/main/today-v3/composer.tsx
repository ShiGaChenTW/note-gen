'use client'

// Fork（almanac ALMNC-16.2）：v5 底部「記／問」輸入列。Tab 從記切到問，下一次 Tab 繼續前進。
//   記 → 新增資料源，由 stores/collect 拆成提案並顯示在工作台。
//   問 → 走隨處對話（打開 AnywhereChatPanel，送出沿用 'quick-prompt-send'，由右側欄的 ChatInput 帶上下文送出）
import { KbdHint } from '@/components/v3/kbd-hint'
import { Segmented } from '@/components/v3/segmented'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { COMPOSER_FIELD, COMPOSER_FRAME } from '@/components/v3/composer-styles'
import { Button } from '@/components/ui/button'
import emitter from '@/lib/emitter'
import { useUiV3 } from '@/lib/fork-ui'
import { useRightSidebarChatVisible } from '../right-sidebar-visibility'
import { useAnywhereStore } from '@/lib/anywhere/store'
import { extractSchedule } from '@/lib/collect/split'
import { classifyUnifiedRecordInput } from '@/lib/unified-record-input'
import { cn } from '@/lib/utils'
import useCollectStore from '@/stores/collect'
import useSettingStore from '@/stores/setting'

type Mode = 'note' | 'ask'

/** 記模式輸入的辨識：連結、帶日期或時間的短句（任務）、其餘當筆記。 */
export function detectNote(text: string, now: Date): 'task' | 'link' | 'text' | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const kind = classifyUnifiedRecordInput(trimmed)
  if (kind === 'link') return 'link'
  if (kind !== 'text' || trimmed.includes('\n') || Array.from(trimmed).length > 40) return 'text'
  const schedule = extractSchedule(trimmed, now)
  return schedule && (schedule.due || schedule.time) ? 'task' : 'text'
}

/** viewingLabel：主畫面正在看別天時的日期（例如 11/20）；記一筆永遠記到今天，要在輸入列說清楚。 */
export function TodayComposer({ viewingLabel = null }: { viewingLabel?: string | null }) {
  const t = useTranslations('todayV3.composer')
  const isV3 = useUiV3()
  const rightSidebarChatVisible = useRightSidebarChatVisible()
  const noteOnly = isV3 && rightSidebarChatVisible
  const [selectedMode, setMode] = useState<Mode>('note')
  const mode = noteOnly ? 'note' : selectedMode
  useEffect(() => {
    if (noteOnly) setMode('note')
  }, [noteOnly])
  const [value, setValue] = useState('')
  const chatOpen = useAnywhereStore(state => state.chatOpen)
  const hasModel = useSettingStore(state => Boolean(state.primaryModel))
  const detected = mode === 'note' ? detectNote(value, new Date()) : null
  const placeholder = mode === 'ask' ? t('askPlaceholder')
    : viewingLabel ? t('notePlaceholderToday', { date: viewingLabel })
      : t(noteOnly ? 'noteOnlyPlaceholder' : 'notePlaceholder')

  function submit() {
    const text = value.trim()
    if (!text) return
    if (mode === 'note') {
      void useCollectStore.getState().submit({ kind: classifyUnifiedRecordInput(text) === 'link' ? 'link' : 'text', text })
      toast(t('captured'))
      setValue('')
      return
    }
    const anywhere = useAnywhereStore.getState()
    anywhere.setChatOpen(true)
    if (!hasModel) {
      toast.error(t('noModel'))
      return
    }
    // 等面板掛上、對話串就位後再送（和命令面板「問」的做法一致：事件由右側欄的 ChatInput 處理）
    window.setTimeout(() => emitter.emit('quick-prompt-send', text), 50)
    setValue('')
  }

  return (
    <div
      className={cn(
        'absolute bottom-4 z-10 flex items-center gap-2',
        COMPOSER_FRAME,
        isV3 && '@container',
        // 隨處對話面板（右下 400px）開著時，輸入列讓到它左邊，免得送出鈕被蓋住
        chatOpen ? 'left-6 w-[min(640px,calc(100%-456px))]' : 'left-1/2 w-[min(640px,calc(100%-48px))] -translate-x-1/2',
      )}
      data-testid="today-v3-composer"
    >
      <Segmented
        label={t('modeLabel')}
        value={mode}
        onChange={setMode}
        items={(['note', 'ask'] as const).filter(key => !noteOnly || key === 'note').map(key => ({ value: key, label: t(key) }))}
      />
      <input
        value={value}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (!noteOnly && event.key === 'Tab' && mode === 'note' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault()
            setMode('ask')
          } else if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
        className={cn(COMPOSER_FIELD, "outline-none")}
      />
      {mode === 'note' && viewingLabel && <span className="shrink-0 rounded-md bg-hover px-[7px] py-px text-xs font-semibold text-ink" data-testid="today-v3-composer-today">{t('toToday')}</span>}
      <span className={cn('shrink-0 rounded-md bg-hover px-[7px] py-px text-xs font-semibold text-muted-ink transition-opacity duration-100', detected ? 'opacity-100' : 'opacity-0')} aria-hidden={!detected}>
        {detected ? t(`detect.${detected}`) : ''}
      </span>
      {!noteOnly && mode === 'note' && (isV3
        ? <KbdHint description={t('tabHint')} />
        : <kbd className="inline-flex shrink-0 rounded-[4px] bg-sunken px-[5px] text-xs leading-[18px] text-muted-ink">Tab</kbd>
      )}
      <Button type="button" size="sm" className="h-8 rounded-(--r)" onClick={submit} aria-disabled={!value.trim()}>{t(mode === 'note' ? 'submitNote' : 'submitAsk')}</Button>
    </div>
  )
}

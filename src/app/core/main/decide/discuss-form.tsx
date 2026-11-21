'use client'

// Fork（almanac ALMNC-54.5）：「再次討論」要附說明——按下後展開這個小輸入框，說明不能空白。
// 工作台詳情與對話裡的提案卡共用。
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MAX_DISCUSSION_NOTE, normalizeDiscussionNote } from '@/lib/proposals/trail'
import { cn } from '@/lib/utils'

export function DiscussForm({ onSubmit, onCancel, busy, className }: {
  onSubmit: (note: string) => void
  onCancel: () => void
  busy?: boolean
  className?: string
}) {
  const t = useTranslations('decide.discuss')
  const [note, setNote] = useState('')
  const ready = normalizeDiscussionNote(note).length > 0
  return (
    <form
      data-slot="discuss-form"
      className={cn('flex flex-col gap-2', className)}
      onSubmit={event => {
        event.preventDefault()
        if (ready && !busy) onSubmit(note)
      }}
    >
      <Textarea
        autoFocus
        value={note}
        maxLength={MAX_DISCUSSION_NOTE}
        placeholder={t('placeholder')}
        aria-label={t('label')}
        className="min-h-16 text-ui-compact"
        onChange={event => setNote(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing && ready && !busy) onSubmit(note)
        }}
      />
      <div className="flex items-center gap-1.5">
        <Button type="submit" size="sm" disabled={!ready || busy}>{t('send')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
        <span className="ml-auto text-ui-compact text-muted-ink">{t('hint')}</span>
      </div>
    </form>
  )
}

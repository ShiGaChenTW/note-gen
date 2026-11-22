'use client'

// Fork（almanac ALMNC-54.5）：「再次討論」要附說明——按下後展開這個小輸入框，說明不能空白。
// 工作台詳情與對話裡的提案卡共用。
// Fork（almanac ALMNC-56 重跑稽核）：送出時表單保持開著、顯示「送出中」；失敗時文字留著並顯示錯誤，成功才由外層關掉。
import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MAX_DISCUSSION_NOTE, normalizeDiscussionNote } from '@/lib/proposals/trail'
import { cn } from '@/lib/utils'

/**
 * onSubmit 回傳 false（或丟錯）代表沒送出：表單留著、文字不清掉、顯示錯誤。
 * 回傳其他值代表送出了，由外層決定關掉表單。
 */
export type DiscussSubmit = (note: string) => unknown

export function DiscussForm({ onSubmit, onCancel, busy, className }: {
  onSubmit: DiscussSubmit
  onCancel: () => void
  busy?: boolean
  className?: string
}) {
  const t = useTranslations('decide.discuss')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const errorId = useId()
  const pending = Boolean(busy) || sending
  const ready = normalizeDiscussionNote(note).length > 0

  async function send() {
    if (!ready || pending) return
    setFailed(false)
    setSending(true)
    let ok = true
    try {
      ok = (await onSubmit(note)) !== false
    } catch {
      ok = false
    }
    // 成功時外層通常已經把表單拿掉；元件還在才更新狀態
    if (!inputRef.current) return
    setSending(false)
    if (!ok) {
      setFailed(true)
      inputRef.current.focus()
    }
  }

  return (
    <form
      data-slot="discuss-form"
      aria-busy={pending || undefined}
      className={cn('flex flex-col gap-2', className)}
      onSubmit={event => {
        event.preventDefault()
        void send()
      }}
    >
      <Textarea
        ref={inputRef}
        autoFocus
        value={note}
        maxLength={MAX_DISCUSSION_NOTE}
        placeholder={t('placeholder')}
        aria-label={t('label')}
        aria-invalid={failed || undefined}
        aria-describedby={failed ? errorId : undefined}
        className="min-h-16 text-ui-compact"
        onChange={event => setNote(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) void send()
        }}
      />
      {failed && (
        <p id={errorId} role="alert" data-testid="discuss-form-error" className="text-ui-compact text-danger">{t('failed')}</p>
      )}
      <div className="flex items-center gap-1.5">
        <Button type="submit" size="sm" disabled={!ready || pending}>{pending ? t('sending') : t('send')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
        <span className="ml-auto text-ui-compact text-muted-ink">{t('hint')}</span>
      </div>
    </form>
  )
}

'use client'

// Fork（#33）：對話摘要預覽。內容與路徑都可以改，按「存檔」才寫進 vault。掛在 fork-services.tsx。
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, NotebookPen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { SummaryError, generateSummary, saveSummary, useConversationSummaryStore } from '@/lib/conversation-summary'

export function ConversationSummaryDialog() {
  const t = useTranslations('conversationSummary')
  const { conversationId, phase, draft, error, close, setPhase, setDraft } = useConversationSummaryStore()

  useEffect(() => {
    if (conversationId === null || phase !== 'loading') return
    let cancelled = false
    void generateSummary(conversationId, {
      headings: {
        myQuestions: t('headings.myQuestions'),
        myViews: t('headings.myViews'),
        aiPoints: t('headings.aiPoints'),
        decisions: t('headings.decisions'),
        openQuestions: t('headings.openQuestions'),
        related: t('headings.related'),
        none: t('headings.none'),
      },
      labels: { me: t('labels.me'), ai: t('labels.ai') },
      language: t('language'),
    }).then(next => {
      if (!cancelled) setPhase('ready', { draft: next })
    }).catch(caught => {
      if (cancelled) return
      const message = caught instanceof SummaryError ? t(`errors.${caught.code}`) + (caught.detail ? `\n${caught.detail}` : '') : caught instanceof Error ? caught.message : String(caught)
      setPhase('error', { error: message })
    })
    return () => { cancelled = true }
  }, [conversationId, phase, setPhase, t])

  async function save() {
    if (!draft) return
    setPhase('saving')
    try {
      await saveSummary(draft)
      toast({ title: draft.existingPath ? t('updated') : t('saved'), description: draft.path })
      close()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setPhase('ready', { error: message.startsWith('EXISTS:') ? t('errors.exists', { path: message.slice(7) }) : message })
    }
  }

  return (
    <Dialog open={conversationId !== null} onOpenChange={open => { if (!open && phase !== 'saving') close() }}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{draft?.existingPath ? t('descriptionUpdate') : t('description')}</DialogDescription>
        </DialogHeader>

        {phase === 'loading' && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t('loading')}</div>
        )}
        {phase === 'error' && <p className="whitespace-pre-wrap py-4 text-sm text-destructive">{error}</p>}

        {draft && (phase === 'ready' || phase === 'saving') && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t('path')}
              <Input value={draft.path} onChange={event => setDraft({ path: event.target.value })} className="font-mono text-xs" />
            </label>
            <label className="flex min-h-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
              {t('content')}
              <Textarea value={draft.content} onChange={event => setDraft({ content: event.target.value })} className="min-h-[320px] flex-1 font-mono text-xs" />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter className="shrink-0">
          <Button variant="ghost" disabled={phase === 'saving'} onClick={close}>{t('cancel')}</Button>
          {phase === 'error' && <Button variant="secondary" onClick={() => setPhase('loading', { error: null })}>{t('retry')}</Button>}
          <Button disabled={!draft || phase !== 'ready' || !draft.path.trim()} onClick={() => void save()}>
            {phase === 'saving' && <Loader2 className="size-4 animate-spin" />}
            {draft?.existingPath ? t('update') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 對話標題列的按鈕；chat-header.tsx 只掛一行。 */
export function ConversationSummaryButton({ conversationId, disabled }: { conversationId: number | null; disabled?: boolean }) {
  const t = useTranslations('conversationSummary')
  const open = useConversationSummaryStore(state => state.open)
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      disabled={disabled || conversationId === null}
      title={t('button')}
      aria-label={t('button')}
      onClick={() => conversationId !== null && open(conversationId)}
    >
      <NotebookPen className="size-4" />
    </Button>
  )
}

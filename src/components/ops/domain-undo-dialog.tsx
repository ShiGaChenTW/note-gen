'use client'

// Fork（almanac ALMNC-72）：撤回「成立領域」提案時的詢問——只撤回 MOC（專家與記憶留著）或一起撤回這次新建的專家。
// 活動紀錄的復原／撤回這次整理、工作台的立即復原 Z 都經 lib/ops/domain-undo-ask 問；這個 host 掛在 app/layout，全 App 一個。
import { useTranslations } from 'next-intl'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { answerDomainUndo, useDomainUndoAsk } from '@/lib/ops/domain-undo-ask'

export function DomainUndoAskHost() {
  const t = useTranslations('ops.domainUndo')
  const expert = useDomainUndoAsk(state => state.pending)
  return (
    <AlertDialog open={expert !== null} onOpenChange={open => { if (!open) answerDomainUndo(null) }}>
      {expert && (
        <AlertDialogContent data-testid="domain-undo-ask">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('title', { domain: expert.domain })}</AlertDialogTitle>
            <AlertDialogDescription>{t('description', { name: expert.name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li><span className="font-medium text-ink">{t('mocOnly')}</span>：{t('mocOnlyHint')}</li>
            <li><span className="font-medium text-ink">{t('withExpert')}</span>：{t('withExpertHint', { name: expert.name })}</li>
          </ul>
          <AlertDialogFooter>
            <Button type="button" variant="ghost" data-choice="cancel" onClick={() => answerDomainUndo(null)}>{t('cancel')}</Button>
            <Button type="button" variant="outline" data-choice="moc-only" onClick={() => answerDomainUndo('moc-only')}>{t('mocOnly')}</Button>
            <Button type="button" variant="destructive" data-choice="with-expert" onClick={() => answerDomainUndo('with-expert')}>{t('withExpert')}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  )
}

'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import type { ExplorationChange } from '@/lib/commander/blueprint-moc'

export function ExplorationActions({ moc, onWithdraw }: { moc: { id: string, path: string }, onWithdraw: () => void }) {
  const t = useTranslations('sidebarV3.domains')
  const [confirmation, setConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)
  async function apply(change: ExplorationChange) {
    setBusy(true)
    try {
      const { updateExploration } = await import('@/lib/commander/blueprint-runtime')
      await updateExploration(moc, change)
      toast.success(t(change === 'promote' ? 'promoted' : 'withdrawn'))
      if (change === 'withdraw') onWithdraw()
    } catch (error) {
      console.warn('[explore] transition failed', error)
      toast.error(t('explorationChangeFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-1 flex gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void apply('promote')}>{t('promote')}</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmation(true)}>{t('withdraw')}</Button>
      <AlertDialog open={confirmation} onOpenChange={setConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('withdraw')}</AlertDialogTitle>
            <AlertDialogDescription>{t('withdrawDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancelWithdrawal')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void apply('withdraw')}>{t('withdraw')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

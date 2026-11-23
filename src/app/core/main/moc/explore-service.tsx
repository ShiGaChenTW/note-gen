'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUiV3 } from '@/lib/fork-ui'
import { requestExplore, setExploreHandler, type ExploreRequest } from '@/lib/domain-page/explore'
import { openWorkbench } from '@/lib/workbench/open'
import useWorkbenchStore from '@/stores/workbench'

export function ExploreService() {
  const enabled = useUiV3()
  const t = useTranslations('workbench.blueprint')
  const [dialog, setDialog] = useState<ExploreRequest | null>(null)
  const [topic, setTopic] = useState('')

  useEffect(() => {
    if (!enabled) return
    return setExploreHandler(async request => {
      if ((request.origin === 'new-domain' || request.origin === 'adjacent') && !request.topic) {
        setTopic(request.origin === 'adjacent' ? request.topics[0] ?? '' : '')
        setDialog(request)
        return
      }
      const id = toast.loading(t('generating'))
      try {
        const { draftExploration } = await import('@/lib/commander/blueprint-runtime')
        const proposal = await draftExploration(request)
        const show = () => {
          openWorkbench()
          const store = useWorkbenchStore.getState()
          store.setFilter('all')
          store.setCursor(proposal.id)
          store.setExpanded(proposal.id)
        }
        toast.success(t('ready'), { id, action: { label: t('open'), onClick: show } })
        if (request.origin !== 'conversation') show()
      } catch (error) {
        toast.error(t('failed'), { id })
        throw error
      }
    })
  }, [enabled, t])

  if (!enabled) return null
  return (
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null) }}>
      <DialogContent>
        <form onSubmit={event => {
          event.preventDefault()
          const text = topic.trim()
          if (!dialog || !text) return
          setDialog(null)
          requestExplore(dialog.origin === 'adjacent' ? { ...dialog, topic: text } : { origin: 'new-domain', topic: text })
        }}>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>
          <label className="my-4 block space-y-1 text-sm">
            <span>{t('topic')}</span>
            <Input value={topic} onChange={event => setTopic(event.target.value)} maxLength={250} required />
          </label>
          <DialogFooter><Button type="submit" disabled={!topic.trim()}>{t('draft')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

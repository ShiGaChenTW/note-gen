'use client'

// Fork（almanac ALMNC-54.8）：審核分頁的就地決定——按下去卡片先收起（動畫），動作做完從清單消失；
// toast 帶「復原 Z」，Z 從復原堆疊拿最後一步。能不能復原看來源（lib/workbench/actions.ts）。
import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { DraftNotApplied } from '@/lib/decide/actions'
import { OrganizeConflict } from '@/lib/organize/transaction'
import { SlotUnavailable } from '@/lib/timeslots/apply'
import { useAgentTaskStore } from '@/lib/agent-tasks'
import { discussProposal, openConversation } from '@/lib/proposals/actions'
import { dateKey } from '@/lib/today/today-model'
import type { CardAction, WorkbenchCard } from '@/lib/workbench/cards'
import { nextCursor } from '@/lib/workbench/cards'
import {
  acceptCard, completeTask, confirmStillValid, confirmToCommander, deleteFailedSource, dropCard, processSource, rejectSource, retryCapture,
  scheduleCardTask, type Undo,
} from '@/lib/workbench/actions'
import type { DeskMaterial } from '@/lib/workbench/desk'
import useWorkbenchStore from '@/stores/workbench'

const LEAVE_MS = 200

export function deskMaterialsOf(card: WorkbenchCard): DeskMaterial[] {
  if (card.notePaths?.length) {
    return card.notePaths.map(path => ({ id: path, kind: 'note' as const, path, title: (path.split('/').pop() ?? path).replace(/\.md$/i, ''), text: '' }))
  }
  if (card.sourceId) return [{ id: `src:${card.sourceId}`, kind: 'source', sourceId: card.sourceId, title: card.title, text: card.summary }]
  if (card.notePath) return [{ id: card.notePath, kind: 'note', path: card.notePath, title: card.title, text: '' }]
  return [{ id: card.key, kind: 'note', title: card.title, text: card.summary }]
}

/** 執行一次復原（Z 或 toast 上的按鈕）。 */
export function useUndo() {
  const t = useTranslations('workbench.toast')
  return useCallback(async () => {
    const store = useWorkbenchStore.getState()
    const entry = store.popUndo()
    if (!entry) {
      toast(t('nothing'))
      return
    }
    if (!entry.undo) {
      toast(t('cannotUndo'))
      return
    }
    try {
      await entry.undo()
      if (entry.cardKey) {
        if (store.filter !== 'all') store.setFilter('all')
        useWorkbenchStore.getState().setCursor(entry.cardKey)
      }
      toast(t('undone'))
    } catch (error) {
      console.error('[workbench] undo failed:', error)
      toast.error(t('cannotUndo'))
    }
  }, [t])
}

export function useCardActions({ visible, commanderName }: { visible: readonly WorkbenchCard[], commanderName: string }) {
  const t = useTranslations('workbench')
  const decideT = useTranslations('decide')
  const week = useTranslations('week')
  const organize = useTranslations('organize')
  const undo = useUndo()

  const record = useCallback((message: string, undoFn: Undo, cardKey: string) => {
    useWorkbenchStore.getState().pushUndo({ message, undo: undoFn, cardKey })
    toast(message, { action: { label: `${t('toast.undo')} Z`, onClick: () => void undo() } })
  }, [t, undo])

  const fail = useCallback((error: unknown) => {
    if (error instanceof DraftNotApplied) {
      const taskId = error.taskId
      toast.error(error.conflict ? decideT('conflict') : decideT('failed'), { action: { label: decideT('openReview'), onClick: () => useAgentTaskStore.getState().openSheet(taskId) } })
    } else if (error instanceof OrganizeConflict) {
      toast.error(organize('conflict'))
    } else if (error instanceof SlotUnavailable) {
      toast.error(week('slotUnavailable'))
    } else {
      console.error('[workbench] action failed:', error)
      toast.error(t('toast.failed'))
    }
  }, [decideT, organize, t, week])

  /** 收起、做動作、記復原。失敗就把卡片放回來。 */
  const settle = useCallback(async (card: WorkbenchCard, run: () => Promise<Undo>, message: string) => {
    const store = useWorkbenchStore.getState()
    const next = nextCursor(visible, card.key)
    store.setLeaving(card.key, true)
    try {
      await new Promise(resolve => setTimeout(resolve, LEAVE_MS))
      const undoFn = await run()
      const state = useWorkbenchStore.getState()
      if (state.cursor === card.key || state.cursor === null) state.setCursor(next)
      if (state.expanded === card.key) state.setExpanded(next && state.expanded ? next : null)
      record(message, undoFn, card.key)
    } catch (error) {
      fail(error)
    } finally {
      useWorkbenchStore.getState().setLeaving(card.key, false)
    }
  }, [fail, record, visible])

  const putAside = useCallback((card: WorkbenchCard, until?: string) => {
    const store = useWorkbenchStore.getState()
    const next = nextCursor(visible, card.key)
    store.putAside(card, until)
    if (store.cursor === card.key) store.setCursor(next)
    if (store.expanded === card.key) store.setExpanded(null)
    record(until ? t('toast.asidedUntil', { title: card.title, date: until }) : t('toast.asided', { title: card.title }), async () => {
      useWorkbenchStore.getState().takeBack(card.key)
    }, card.key)
  }, [record, t, visible])

  const openDesk = useCallback((card: WorkbenchCard, materials = deskMaterialsOf(card)) => {
    useWorkbenchStore.getState().openDesk(materials, card.key)
  }, [])

  const run = useCallback(async (card: WorkbenchCard, action: CardAction, payload?: { note?: string, time?: string, choice?: string }) => {
    const title = card.title
    switch (action) {
      case 'accept':
        return settle(card, () => acceptCard(card), t('toast.accepted', { title }))
      case 'drop':
        return settle(card, () => dropCard(card), t('toast.dropped', { title }))
      case 'discuss': {
        const note = payload?.note ?? ''
        const key = card.decide?.key ?? card.key
        try {
          const id = await discussProposal({ key, conversationId: card.conversationId }, note, text => decideT('discuss.message', { title, note: text }))
          if (id !== null) toast(decideT('discuss.done', { title }))
        } catch (error) {
          fail(error)
        }
        return
      }
      case 'done':
        if (!card.task) return
        return settle(card, () => completeTask(card.task!), t('toast.done', { title }))
      case 'schedule':
        if (!card.task || !payload?.time) return
        return settle(card, () => scheduleCardTask(card.task!, payload.time!), t('toast.scheduled', { title, time: payload.time }))
      case 'stillValid':
        if (!card.notePath) return
        return settle(card, () => confirmStillValid(card.notePath!, dateKey(new Date())), t('toast.stillValid', { title }))
      case 'toCommander':
        if (!card.notePath) return
        return settle(card, () => confirmToCommander(card.notePath!), t('toast.toCommander', { title, name: commanderName }))
      // Fork（almanac ALMNC-54.10）：照建議處理帶著初步判斷交給指揮官；處理不帶建議。兩者都交給指揮官、無法復原。
      case 'process':
      case 'handle':
        if (!card.sourceId) return
        return settle(card, async () => {
          await processSource(card.sourceId!, { followSuggestion: action === 'process' && Boolean(card.hasSuggestion) })
          return undefined
        }, t('toast.processed', { title, name: commanderName }))
      case 'retry':
        if (!card.sourceId) return
        try {
          const judgement = await retryCapture(card.sourceId)
          toast(judgement?.status === 'capture_failed' ? t('toast.retryFailed', { title }) : t('toast.retried', { title }))
        } catch (error) {
          fail(error)
        }
        return
      case 'delete':
        if (!card.sourceId) return
        return settle(card, async () => { await deleteFailedSource(card.sourceId!); return undefined }, t('toast.deleted', { title }))
      case 'reject':
        if (!card.sourceId) return
        return settle(card, () => rejectSource(card.sourceId!), t('toast.rejected', { title }))
      case 'selfProcess':
      case 'desk':
        openDesk(card)
        return
      case 'answer':
      case 'pick':
        if (card.conversationId !== undefined) await openConversation(card.conversationId)
        return
    }
  }, [commanderName, decideT, fail, openDesk, settle, t])

  return { run, putAside, undo, openDesk }
}

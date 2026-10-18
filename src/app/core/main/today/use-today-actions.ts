'use client'

// Fork (D2–D8): the Today page's write-backs. Every write shows a toast with Undo;
// `busy` holds the keys of the writes in flight so their controls can be disabled;
// writes to different tasks can overlap without clearing each other's state.
import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import type { StampKind } from '@/lib/daily/daily-note'
import type { TaskRef } from '@/lib/vault-index/index-core'
import {
  carryYesterdayTasks,
  quickAddTask,
  scheduleTask,
  setTaskChecked,
  stampToday,
  StaleTaskError,
  undoWrites,
  type WriteRecord,
} from '@/lib/today/today-actions'
import useArticleStore from '@/stores/article'
import { taskDragKey } from './time-blocks'

export function sourceName(path: string): string {
  return path.split('/').pop()?.replace(/\.md$/i, '') ?? path
}

export function useTodayActions({ now, tasks }: { now: Date, tasks: readonly TaskRef[] }) {
  const t = useTranslations('today')
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  // 同步的紀錄：同一個 key 的寫回還沒結束時，再按一次直接略過
  const inFlight = useRef(new Set<string>())

  /** 執行寫回並提示；有寫入時回傳 true。 */
  const runWrite = useCallback(async <T extends WriteRecord>(key: string, action: () => Promise<T>, success: (record: T) => string): Promise<boolean> => {
    if (inFlight.current.has(key)) return false
    inFlight.current.add(key)
    setBusy(new Set(inFlight.current))
    try {
      const record = await action()
      if (record.writes.length === 0) return false
      toast(success(record), {
        action: {
          label: t('undo'),
          onClick: () => {
            void undoWrites(record).then(ok => { if (!ok) toast.error(t('undoStale')) })
          },
        },
      })
      return true
    } catch (error) {
      if (error instanceof StaleTaskError) toast.error(t('taskStale', { name: sourceName(error.path) }))
      else {
        console.error('[today] write failed:', error)
        toast.error(t('writeFailed'))
      }
      return false
    } finally {
      inFlight.current.delete(key)
      setBusy(new Set(inFlight.current))
    }
  }, [t])

  const toggleTask = useCallback((task: TaskRef, checked: boolean) => {
    void runWrite(`${task.path}:${task.line}`, () => setTaskChecked(task, checked), record => (
      record.nextDue !== undefined
        ? t('taskDoneNext', { name: sourceName(task.path), date: record.nextDue || t('noDate') })
        : checked ? t('taskDone', { name: sourceName(task.path) }) : t('taskUndone', { name: sourceName(task.path) })
    ))
  }, [runWrite, t])

  const schedule = useCallback((task: TaskRef, time: string) => {
    void runWrite(`${task.path}:${task.line}`, () => scheduleTask(task, time), () => (
      time ? t('timeBlocks.scheduled', { time }) : t('timeBlocks.cleared')
    ))
  }, [runWrite, t])

  const dropTask = useCallback((dragKey: string, time: string) => {
    const task = tasks.find(candidate => taskDragKey(candidate) === dragKey)
    if (task) schedule(task, time)
  }, [tasks, schedule])

  const addTask = useCallback((input: string) => runWrite('quick-add', () => quickAddTask(input, new Date()), record => (
    t('quickAdd.added', { name: record.task.title })
  )), [runWrite, t])

  const stamp = useCallback((kind: StampKind) => {
    void runWrite(kind, () => stampToday(kind, now), () => t(`stamped.${kind}`))
  }, [runWrite, now, t])

  const carry = useCallback(() => {
    void runWrite('carry', () => carryYesterdayTasks(now), record => t('carry.done', { count: record.moved }))
  }, [runWrite, now, t])

  const openNote = useCallback((path: string) => {
    void useArticleStore.getState().setActiveFilePath(path)
  }, [])

  return { busy, toggleTask, schedule, dropTask, addTask, stamp, carry, openNote }
}

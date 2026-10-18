'use client'

// Fork (D2): everything the Today page reads — index, settings, today's note,
// calendar — shaped by the pure today-model functions.
import { useEffect, useMemo, useState } from 'react'
import { parseDailyNote, type DailyNote } from '@/lib/daily/daily-note'
import { dailyNotePath } from '@/lib/daily/format'
import { readNote } from '@/lib/daily/note-io'
import { useCalendarEvents } from '@/lib/calendar/calendar'
import { buildAgenda, buildWeek, groupTasks, staleInboxNotes } from '@/lib/today/today-model'
import { countCarryable } from '@/lib/today/today-actions'
import useDailySettingsStore from '@/stores/daily-settings'
import useVaultIndexStore, { selectAllTasks } from '@/stores/vault-index'

/** 分鐘級的「現在」，讓進程與「現在」線每分鐘前進。 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const align = window.setTimeout(() => {
      tick()
      timer = window.setInterval(tick, 60_000)
    }, 60_000 - (Date.now() % 60_000))
    let timer: number | undefined
    return () => {
      window.clearTimeout(align)
      if (timer) window.clearInterval(timer)
    }
  }, [])
  return now
}

/** 今日筆記的解析結果；檔案變動（mtime）時重讀。 */
function useDailyNote(path: string, mtime: number): DailyNote | null {
  const [dailyNote, setDailyNote] = useState<DailyNote | null>(null)
  useEffect(() => {
    let cancelled = false
    void readNote(path).then(content => {
      if (!cancelled) setDailyNote(content === null ? null : parseDailyNote(content))
    }).catch(() => { if (!cancelled) setDailyNote(null) })
    return () => { cancelled = true }
  }, [path, mtime])
  return dailyNote
}

/** 昨天日記裡可帶入今天的未完成任務數（D6）。 */
function useCarryable(now: Date, revision: number): number {
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const [carryable, setCarryable] = useState(0)
  useEffect(() => {
    let cancelled = false
    void countCarryable(now).then(count => { if (!cancelled) setCarryable(count) }).catch(() => undefined)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey, revision])
  return carryable
}

export function useTodayData() {
  const now = useNow()

  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const indexStatus = useVaultIndexStore(state => state.status)
  const tasks = useMemo(() => selectAllTasks({ notes, revision }), [notes, revision])

  const settings = useDailySettingsStore()
  const initDailySettings = useDailySettingsStore(state => state.initSettings)
  useEffect(() => { void initDailySettings() }, [initDailySettings])
  const todayPath = dailyNotePath(now, settings.dailyFolder, settings.dailyPattern)

  const dailyNote = useDailyNote(todayPath, notes.get(todayPath)?.mtime ?? 0)
  const carryable = useCarryable(now, revision)
  const calendar = useCalendarEvents(now)

  const groups = useMemo(() => groupTasks(tasks, now), [tasks, now])
  const agenda = useMemo(
    () => buildAgenda({ now, dailyNote, tasks, events: calendar.events }),
    [now, dailyNote, tasks, calendar.events],
  )
  const week = useMemo(() => buildWeek({
    now,
    tasks,
    dailyNotePathFor: day => dailyNotePath(day, settings.dailyFolder, settings.dailyPattern),
    hasNote: path => notes.has(path),
  }), [now, tasks, notes, settings.dailyFolder, settings.dailyPattern])
  const staleInbox = useMemo(
    () => staleInboxNotes(notes.values(), settings.inboxFolder, settings.staleDays, now),
    [notes, settings.inboxFolder, settings.staleDays, now],
  )

  return {
    now,
    tasks,
    indexStatus,
    staleDays: settings.staleDays,
    dailyNote,
    carryable,
    calendar,
    groups,
    agenda,
    week,
    staleInbox,
  }
}

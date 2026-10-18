'use client'

// Fork (D7): every minute, notify tasks whose `⏰ HH:mm` has come; on launch, catch up
// on the ones missed while the app was closed (up to 24 hours).
import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import {
  checkWindowStart,
  dueReminders,
  recordNotified,
  type Reminder,
  type ReminderState,
} from '@/lib/reminders/reminders'
import { ensureNotificationPermission, loadReminderState, notify, saveReminderState } from '@/lib/reminders/service'
import useDailySettingsStore from '@/stores/daily-settings'
import useVaultIndexStore, { selectAllTasks } from '@/stores/vault-index'

/** 一次超過這麼多個就合併成一則，避免開 App 時被洗版。 */
const MAX_SEPARATE = 3

function noteName(path: string): string {
  return path.split('/').pop()?.replace(/\.md$/i, '') ?? path
}

export function ReminderService() {
  const t = useTranslations('today.reminders')
  const enabled = useDailySettingsStore(state => state.remindersEnabled)
  const initialized = useDailySettingsStore(state => state.initialized)
  const initSettings = useDailySettingsStore(state => state.initSettings)
  const indexReady = useVaultIndexStore(state => state.status === 'ready')
  const stateRef = useRef<ReminderState | null>(null)
  const runningRef = useRef(false)

  useEffect(() => { void initSettings() }, [initSettings])

  useEffect(() => {
    if (!initialized || !indexReady) return
    let disposed = false

    const send = (reminders: Reminder[]) => {
      if (reminders.length > MAX_SEPARATE) {
        notify(t('summaryTitle', { count: reminders.length }), reminders.slice(0, MAX_SEPARATE).map(r => `${r.time} ${r.title}`).join('\n'))
        return
      }
      for (const reminder of reminders) {
        notify(t('title', { time: reminder.time }), `${reminder.title}\n${noteName(reminder.path)}`)
      }
    }

    const tick = async () => {
      if (runningRef.current) return
      runningRef.current = true
      try {
        const state = stateRef.current ?? await loadReminderState()
        const now = Date.now()
        // 關閉提醒期間只更新檢查時間，重新打開時不回補
        const reminders = enabled
          ? dueReminders(selectAllTasks(useVaultIndexStore.getState()), { now, since: checkWindowStart(state, now), notified: state.notified })
          : []
        if (reminders.length > 0 && await ensureNotificationPermission()) send(reminders)
        const next = recordNotified(state, reminders, now)
        stateRef.current = next
        if (!disposed) await saveReminderState(next)
      } catch (error) {
        console.error('[reminders] check failed:', error)
      } finally {
        runningRef.current = false
      }
    }

    void tick()
    let timer: number | undefined
    const align = window.setTimeout(() => {
      void tick()
      timer = window.setInterval(() => void tick(), 60_000)
    }, 60_000 - (Date.now() % 60_000) + 500)
    return () => {
      disposed = true
      window.clearTimeout(align)
      if (timer) window.clearInterval(timer)
    }
  }, [initialized, indexReady, enabled, t])

  return null
}

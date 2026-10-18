/**
 * D7 提醒：找出 ⏰ 時間已到、還沒通知過的任務。純函式、無 I/O；now 由參數注入。
 * 「已通知紀錄」只存在 app 端（store.json），不寫進 vault。
 */

import type { TaskRef } from '@/lib/vault-index/index-core'

/** App 關掉期間錯過的提醒，最多回補這麼久。 */
export const MISSED_WINDOW_MS = 24 * 60 * 60_000
/** 已通知紀錄保留天數，過期的自動清掉。 */
export const NOTIFIED_KEEP_MS = 7 * 24 * 60 * 60_000

export interface ReminderState {
  /** 上次檢查的時間（毫秒）；沒有代表第一次使用 */
  lastCheck: number | null
  /** 提醒鍵 → 通知時間（毫秒） */
  notified: Record<string, number>
}

export interface Reminder {
  key: string
  title: string
  path: string
  /** 提醒時間（毫秒） */
  at: number
  due: string
  time: string
}

/** 不用行號：檔案上方插入內容後行號會變，同一個提醒不該再發一次。 */
export function reminderKey(task: Pick<TaskRef, 'path' | 'due' | 'time' | 'title'>): string {
  return `${task.path}\n${task.due} ${task.time}\n${task.title}`
}

export function reminderTime(due: string, time: string): number {
  const [y, mo, d] = due.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  return new Date(y, mo - 1, d, h, mi).getTime()
}

/**
 * 時間落在 (since, now] 之間、未完成、還沒通知過的任務，依時間排序。
 * since 由呼叫端決定：上次檢查時間，最多往回 MISSED_WINDOW_MS；第一次使用時為 now（不回補）。
 */
export function dueReminders(tasks: readonly TaskRef[], input: { now: number, since: number, notified: Readonly<Record<string, number>> }): Reminder[] {
  const out: Reminder[] = []
  const seen = new Set<string>()
  for (const task of tasks) {
    if (task.done || !task.due || !task.time) continue
    const at = reminderTime(task.due, task.time)
    if (!(at > input.since && at <= input.now)) continue
    const key = reminderKey(task)
    if (input.notified[key] !== undefined || seen.has(key)) continue
    seen.add(key)
    out.push({ key, title: task.title, path: task.path, at, due: task.due, time: task.time })
  }
  return out.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
}

export function checkWindowStart(state: ReminderState, now: number): number {
  if (state.lastCheck === null) return now
  return Math.max(Math.min(state.lastCheck, now), now - MISSED_WINDOW_MS)
}

/** 記下這次通知過的提醒，並清掉過期紀錄。 */
export function recordNotified(state: ReminderState, reminders: readonly Reminder[], now: number): ReminderState {
  const notified: Record<string, number> = {}
  for (const [key, at] of Object.entries(state.notified)) {
    if (now - at < NOTIFIED_KEEP_MS) notified[key] = at
  }
  for (const reminder of reminders) notified[reminder.key] = now
  return { lastCheck: now, notified }
}

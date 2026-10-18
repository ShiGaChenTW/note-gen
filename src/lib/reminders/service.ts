/**
 * D7 提醒的 I/O：已通知紀錄存在 app 端的 reminders.json（不進 vault），通知走 tauri-plugin-notification。
 */

import { Store } from '@tauri-apps/plugin-store'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import type { ReminderState } from './reminders'

const STORE_FILE = 'reminders.json'
const STORE_KEY = 'state'

export async function loadReminderState(): Promise<ReminderState> {
  try {
    const store = await Store.load(STORE_FILE)
    const saved = await store.get<ReminderState>(STORE_KEY)
    if (saved && typeof saved.notified === 'object' && saved.notified !== null) {
      return { lastCheck: typeof saved.lastCheck === 'number' ? saved.lastCheck : null, notified: saved.notified }
    }
  } catch (error) {
    console.warn('[reminders] failed to load state:', error)
  }
  return { lastCheck: null, notified: {} }
}

export async function saveReminderState(state: ReminderState): Promise<void> {
  const store = await Store.load(STORE_FILE)
  await store.set(STORE_KEY, state)
  await store.save()
}

/** 還沒決定過時會跳出 macOS 的通知權限詢問。 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true
  return (await requestPermission()) === 'granted'
}

export function notify(title: string, body: string) {
  sendNotification({ title, body })
}

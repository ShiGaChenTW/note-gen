import { describe, expect, it } from 'vitest'
import { collectTasks } from '@/lib/vault-index/index-core'
import { indexNote } from '@/lib/vault-index/index-note'
import {
  checkWindowStart,
  dueReminders,
  MISSED_WINDOW_MS,
  NOTIFIED_KEEP_MS,
  recordNotified,
  reminderKey,
} from './reminders'

const NOW = new Date(2026, 9, 18, 14, 20).getTime()
const tasks = collectTasks([
  indexNote('Work.md', [
    '- [ ] 站會 📅 2026-10-18 ⏰ 09:30',
    '- [ ] 回信 📅 2026-10-18 ⏰ 14:00',
    '- [ ] 寫週報 📅 2026-10-18 ⏰ 14:20',
    '- [ ] 開會 📅 2026-10-18 ⏰ 15:00',
    '- [x] 已完成 📅 2026-10-18 ⏰ 14:10 ✅ 2026-10-18',
    '- [ ] 沒時間 📅 2026-10-18',
    '- [ ] 昨晚 📅 2026-10-17 ⏰ 22:00',
  ].join('\n'), 0),
])

describe('dueReminders', () => {
  it('只列 (since, now] 之間、未完成、有時間的任務，依時間排序', () => {
    const since = NOW - 60 * 60_000
    expect(dueReminders(tasks, { now: NOW, since, notified: {} }).map(r => r.title)).toEqual(['回信', '寫週報'])
  })

  it('通知過的不再列', () => {
    const since = NOW - 60 * 60_000
    const notified = { [reminderKey({ path: 'Work.md', due: '2026-10-18', time: '14:00', title: '回信' })]: NOW - 1000 }
    expect(dueReminders(tasks, { now: NOW, since, notified }).map(r => r.title)).toEqual(['寫週報'])
  })

  it('App 關掉期間錯過的會補上（從上次檢查起算）', () => {
    const since = new Date(2026, 9, 17, 21, 0).getTime()
    expect(dueReminders(tasks, { now: NOW, since, notified: {} }).map(r => r.title)).toEqual(['昨晚', '站會', '回信', '寫週報'])
  })
})

describe('checkWindowStart', () => {
  it('第一次使用不回補', () => {
    expect(checkWindowStart({ lastCheck: null, notified: {} }, NOW)).toBe(NOW)
  })
  it('最多回補 24 小時', () => {
    expect(checkWindowStart({ lastCheck: NOW - 3 * MISSED_WINDOW_MS, notified: {} }, NOW)).toBe(NOW - MISSED_WINDOW_MS)
    expect(checkWindowStart({ lastCheck: NOW - 5000, notified: {} }, NOW)).toBe(NOW - 5000)
  })
})

describe('recordNotified', () => {
  it('記下新通知、清掉過期紀錄、更新 lastCheck', () => {
    const state = { lastCheck: NOW - 60_000, notified: { old: NOW - NOTIFIED_KEEP_MS - 1, recent: NOW - 1000 } }
    const reminders = dueReminders(tasks, { now: NOW, since: NOW - 60 * 60_000, notified: {} })
    const next = recordNotified(state, reminders, NOW)
    expect(next.lastCheck).toBe(NOW)
    expect(Object.keys(next.notified).sort()).toEqual([reminders[0].key, reminders[1].key, 'recent'].sort())
  })
})

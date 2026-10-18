import { describe, expect, it } from 'vitest'
import { minutesToSlot, setTaskSchedule, slotToMinutes } from './schedule'

describe('minutesToSlot', () => {
  it('對齊 15 分鐘並限制範圍', () => {
    expect(minutesToSlot(9 * 60 + 7)).toBe('09:00')
    expect(minutesToSlot(9 * 60 + 8)).toBe('09:15')
    expect(minutesToSlot(-30)).toBe('00:00')
    expect(minutesToSlot(24 * 60 + 5)).toBe('23:45')
    expect(slotToMinutes('13:45')).toBe(825)
  })
})

describe('setTaskSchedule', () => {
  const schedule = { due: '2026-10-18', time: '14:30' }

  it('沒有日期與時間時加在行尾', () => {
    expect(setTaskSchedule('- [ ] 寫週報 ⏫', schedule)).toBe('- [ ] 寫週報 ⏫ 📅 2026-10-18 ⏰ 14:30')
  })

  it('已有的 📅 與 ⏰ 就地取代', () => {
    expect(setTaskSchedule('- [ ] 寫週報 📅 2026-10-15 ⏰ 9:00 #work', schedule))
      .toBe('- [ ] 寫週報 📅 2026-10-18 ⏰ 14:30 #work')
  })

  it('支援 due:: 欄位與 ^block-id，保留 \\r', () => {
    expect(setTaskSchedule('  - [ ] 回信 [due:: 2026-10-01] ^abc\r', schedule))
      .toBe('  - [ ] 回信 [due:: 2026-10-18] ⏰ 14:30 ^abc\r')
  })

  it('time 為空時移除 ⏰', () => {
    expect(setTaskSchedule('- [ ] 寫週報 📅 2026-10-18 ⏰ 09:00 🔁 every day', { due: '2026-10-18', time: '' }))
      .toBe('- [ ] 寫週報 📅 2026-10-18 🔁 every day')
  })

  it('不是任務行回傳 null', () => {
    expect(setTaskSchedule('普通段落', schedule)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { completeTaskInContent, completeTaskLine, nextOccurrence, parseRecurrence, recurrenceOf } from './recurrence'

// 2026-10-17 是週六
const TODAY = new Date(2026, 9, 17, 22, 0)
const rule = (text: string) => parseRecurrence(text)!

describe('parseRecurrence', () => {
  it('支援的規則', () => {
    expect(parseRecurrence('every day')).toEqual({ interval: 1, unit: 'day', whenDone: false, text: 'every day' })
    expect(parseRecurrence('every 3 days')).toMatchObject({ interval: 3, unit: 'day' })
    expect(parseRecurrence('every week')).toMatchObject({ interval: 1, unit: 'week' })
    expect(parseRecurrence('Every 2 Weeks When Done')).toMatchObject({ interval: 2, unit: 'week', whenDone: true })
    expect(parseRecurrence('every month')).toMatchObject({ unit: 'month' })
    expect(parseRecurrence('every year')).toMatchObject({ unit: 'year' })
    expect(parseRecurrence('every weekday')).toMatchObject({ unit: 'weekday', interval: 1 })
    expect(parseRecurrence('  every  day  when  done ')).toMatchObject({ unit: 'day', whenDone: true })
  })

  it('不支援的規則回傳 null', () => {
    expect(parseRecurrence('every 0 days')).toBeNull()
    expect(parseRecurrence('every 2 weekdays')).toBeNull()
    expect(parseRecurrence('every week on Monday')).toBeNull()
    expect(parseRecurrence('every month on the 1st')).toBeNull()
    expect(parseRecurrence('daily')).toBeNull()
  })

  it('從任務行取出規則，遇到 emoji / 標籤 / block id 為止', () => {
    expect(recurrenceOf('- [ ] A 🔁 every week 📅 2026-10-17')?.text).toBe('every week')
    expect(recurrenceOf('- [ ] A 🔁 every day when done #家 ^id')?.whenDone).toBe(true)
    expect(recurrenceOf('- [ ] A 📅 2026-10-17')).toBeNull()
  })
})

describe('nextOccurrence', () => {
  it('每天、每 N 天、跨月跨年', () => {
    expect(nextOccurrence(rule('every day'), '2026-10-31')).toBe('2026-11-01')
    expect(nextOccurrence(rule('every day'), '2026-12-31')).toBe('2027-01-01')
    expect(nextOccurrence(rule('every 3 days'), '2028-02-27')).toBe('2028-03-01')
    expect(nextOccurrence(rule('every day'), '2028-02-28')).toBe('2028-02-29')
  })

  it('每週跨年', () => {
    expect(nextOccurrence(rule('every week'), '2026-12-28')).toBe('2027-01-04')
    expect(nextOccurrence(rule('every 2 weeks'), '2026-10-17')).toBe('2026-10-31')
  })

  it('每個工作日：週五 → 週一，週末 → 週一', () => {
    expect(nextOccurrence(rule('every weekday'), '2026-10-15')).toBe('2026-10-16')
    expect(nextOccurrence(rule('every weekday'), '2026-10-16')).toBe('2026-10-19')
    expect(nextOccurrence(rule('every weekday'), '2026-10-17')).toBe('2026-10-19')
    expect(nextOccurrence(rule('every weekday'), '2026-10-18')).toBe('2026-10-19')
    // 2027-01-01 是週五
    expect(nextOccurrence(rule('every weekday'), '2027-01-01')).toBe('2027-01-04')
  })

  it('每月：月底取該月最後一天，不跳月', () => {
    expect(nextOccurrence(rule('every month'), '2026-10-17')).toBe('2026-11-17')
    expect(nextOccurrence(rule('every month'), '2026-10-31')).toBe('2026-11-30')
    expect(nextOccurrence(rule('every month'), '2027-01-31')).toBe('2027-02-28')
    expect(nextOccurrence(rule('every month'), '2028-01-31')).toBe('2028-02-29')
    expect(nextOccurrence(rule('every month'), '2026-12-15')).toBe('2027-01-15')
    expect(nextOccurrence(rule('every 3 months'), '2026-11-30')).toBe('2027-02-28')
    expect(nextOccurrence(rule('every 12 months'), '2026-03-01')).toBe('2027-03-01')
  })

  it('每年：閏日落到 2/28', () => {
    expect(nextOccurrence(rule('every year'), '2028-02-29')).toBe('2029-02-28')
    expect(nextOccurrence(rule('every 4 years'), '2028-02-29')).toBe('2032-02-29')
    expect(nextOccurrence(rule('every year'), '2026-10-17')).toBe('2027-10-17')
  })
})

describe('completeTaskLine', () => {
  it('依到期日產生下一次，新行在下一行', () => {
    const r = completeTaskLine('- [ ] 倒垃圾 🔁 every day 📅 2026-10-17', TODAY)!
    expect(r.completed).toBe('- [x] 倒垃圾 🔁 every day 📅 2026-10-17 ✅ 2026-10-17')
    expect(r.next).toBe('- [ ] 倒垃圾 🔁 every day 📅 2026-10-18')
    expect(r.lines).toEqual([r.completed, r.next])
  })

  it('逾期任務仍從原到期日往後算（非 when done）', () => {
    const r = completeTaskLine('- [ ] 週報 🔁 every week 📅 2026-10-02', TODAY)!
    expect(r.next).toBe('- [ ] 週報 🔁 every week 📅 2026-10-09')
  })

  it('when done 以完成日為基準', () => {
    const r = completeTaskLine('- [ ] 澆花 🔁 every 3 days when done 📅 2026-10-02', TODAY)!
    expect(r.next).toBe('- [ ] 澆花 🔁 every 3 days when done 📅 2026-10-20')
    // 週六完成的 weekday when done → 週一
    expect(completeTaskLine('- [ ] 打卡 🔁 every weekday when done 📅 2026-10-16', TODAY)!.next)
      .toBe('- [ ] 打卡 🔁 every weekday when done 📅 2026-10-19')
  })

  it('沒有 due 時依 scheduled、再依 start；其他日期維持天數差', () => {
    const r = completeTaskLine('- [ ] A 🔁 every month 🛫 2026-10-29 ⏳ 2026-10-31', TODAY)!
    // 基準是 ⏳ 10/31 → 11/30；🛫 原本早 2 天 → 11/28
    expect(r.next).toBe('- [ ] A 🔁 every month 🛫 2026-11-28 ⏳ 2026-11-30')
    const s = completeTaskLine('- [ ] B 🔁 every week 🛫 2026-12-30', TODAY)!
    expect(s.next).toBe('- [ ] B 🔁 every week 🛫 2027-01-06')
  })

  it('due 為基準時 scheduled / start 一起平移', () => {
    const r = completeTaskLine('- [ ] 繳費 🔁 every month 🛫 2027-01-25 ⏳ 2027-01-28 📅 2027-01-31', TODAY)!
    expect(r.next).toBe('- [ ] 繳費 🔁 every month 🛫 2027-02-22 ⏳ 2027-02-25 📅 2027-02-28')
  })

  it('when done 的其他日期也維持與基準日的天數差', () => {
    const r = completeTaskLine('- [ ] A 🔁 every week when done ⏳ 2026-10-01 📅 2026-10-03', TODAY)!
    expect(r.next).toBe('- [ ] A 🔁 every week when done ⏳ 2026-10-22 📅 2026-10-24')
  })

  it('dataview 欄位日期', () => {
    const r = completeTaskLine('- [ ] A 🔁 every day [due:: 2026-10-17]', TODAY)!
    expect(r.next).toBe('- [ ] A 🔁 every day [due:: 2026-10-18]')
  })

  it('保留縮排、優先序、⏰、標籤、block id；➕ 改成今天，舊 ✅ 移除', () => {
    const line = '\t- [/] 健身 ⏫ 🔁 every weekday ➕ 2026-09-01 📅 2026-10-16 ⏰ 07:00 #健康 ^gym'
    const r = completeTaskLine(line, TODAY)!
    expect(r.completed).toBe('\t- [x] 健身 ⏫ 🔁 every weekday ➕ 2026-09-01 📅 2026-10-16 ⏰ 07:00 #健康 ✅ 2026-10-17 ^gym')
    expect(r.next).toBe('\t- [ ] 健身 ⏫ 🔁 every weekday ➕ 2026-10-17 📅 2026-10-19 ⏰ 07:00 #健康 ^gym')
  })

  it('沒有任何日期：產生不帶日期的新行', () => {
    const r = completeTaskLine('- [ ] 冥想 🔁 every day', TODAY)!
    expect(r.next).toBe('- [ ] 冥想 🔁 every day')
    expect(completeTaskLine('- [ ] 冥想 🔁 every day when done', TODAY)!.next).toBe('- [ ] 冥想 🔁 every day when done')
  })

  it('沒有 🔁 或規則不支援：只完成原行', () => {
    expect(completeTaskLine('- [ ] A 📅 2026-10-17', TODAY)).toEqual({ completed: '- [x] A 📅 2026-10-17 ✅ 2026-10-17', next: null, lines: ['- [x] A 📅 2026-10-17 ✅ 2026-10-17'] })
    expect(completeTaskLine('- [ ] A 🔁 every week on Monday 📅 2026-10-17', TODAY)!.next).toBeNull()
  })

  it('已完成或非任務回傳 null', () => {
    expect(completeTaskLine('- [x] A 🔁 every day', TODAY)).toBeNull()
    expect(completeTaskLine('- A 🔁 every day', TODAY)).toBeNull()
  })

  it('CRLF：兩行都保留 \\r', () => {
    const r = completeTaskLine('- [ ] A 🔁 every day 📅 2026-10-17\r', TODAY)!
    expect(r.lines).toEqual(['- [x] A 🔁 every day 📅 2026-10-17 ✅ 2026-10-17\r', '- [ ] A 🔁 every day 📅 2026-10-18\r'])
  })

  it('完成日用本地日期（深夜不跨日）', () => {
    const late = new Date(2026, 11, 31, 23, 59)
    const r = completeTaskLine('- [ ] A 🔁 every day when done', late)!
    expect(r.completed).toBe('- [x] A 🔁 every day when done ✅ 2026-12-31')
    expect(completeTaskLine('- [ ] A 🔁 every day when done 📅 2026-12-01', late)!.next).toBe('- [ ] A 🔁 every day when done 📅 2027-01-01')
  })
})

describe('completeTaskInContent', () => {
  it('在原行下插入新行，其他行逐字不變', () => {
    const md = '# 今天\r\n- [ ] A 🔁 every week 📅 2026-10-17\r\n- [ ] B\r\n'
    expect(completeTaskInContent(md, 1, TODAY)).toBe(
      '# 今天\r\n- [x] A 🔁 every week 📅 2026-10-17 ✅ 2026-10-17\r\n- [ ] A 🔁 every week 📅 2026-10-24\r\n- [ ] B\r\n',
    )
  })

  it('非重複任務只改該行', () => {
    expect(completeTaskInContent('a\n- [ ] B\nc', 1, TODAY)).toBe('a\n- [x] B ✅ 2026-10-17\nc')
  })

  it('非任務、已完成、越界回傳 null', () => {
    expect(completeTaskInContent('a\n- [x] B', 1, TODAY)).toBeNull()
    expect(completeTaskInContent('a', 0, TODAY)).toBeNull()
    expect(completeTaskInContent('a', 3, TODAY)).toBeNull()
  })
})

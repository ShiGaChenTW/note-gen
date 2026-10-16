import { describe, expect, it } from 'vitest'
import { parseNaturalTask, parseTime, resolveDate } from './nl-task'

// 2026-10-17 是週六
const SAT = new Date(2026, 9, 17, 8, 0)

describe('parseNaturalTask', () => {
  it('規格範例', () => {
    const t = parseNaturalTask('買菜 @明天 9am !high #家', SAT)
    expect(t.line).toBe('- [ ] 買菜 📅 2026-10-18 ⏰ 09:00 ⏫ #家')
    expect(t).toMatchObject({ title: '買菜', due: '2026-10-18', time: '09:00', priority: 'high', tags: ['#家'] })
  })

  it('欄位順序固定，與輸入順序無關；多標籤保留順序', () => {
    expect(parseNaturalTask('#家 !low 買 菜 #採買 @後天', SAT).line).toBe('- [ ] 買 菜 📅 2026-10-19 🔽 #家 #採買')
  })

  it('只有標題', () => {
    expect(parseNaturalTask('  寫週報  ', SAT).line).toBe('- [ ] 寫週報')
  })

  it('只有時間時日期用今天', () => {
    expect(parseNaturalTask('開會 下午3點', SAT).line).toBe('- [ ] 開會 📅 2026-10-17 ⏰ 15:00')
    expect(parseNaturalTask('開會 @21:30', SAT).line).toBe('- [ ] 開會 📅 2026-10-17 ⏰ 21:30')
  })

  it('優先序別名', () => {
    expect(parseNaturalTask('a !highest', SAT).line).toBe('- [ ] a 🔺')
    expect(parseNaturalTask('a !MID', SAT).line).toBe('- [ ] a 🔼')
    expect(parseNaturalTask('a !最低', SAT).line).toBe('- [ ] a ⏬')
  })

  it('認不得的 @ 與 ! 留在標題，重複的日期只取第一個', () => {
    expect(parseNaturalTask('寄信給 @alice !urgent', SAT).line).toBe('- [ ] 寄信給 @alice !urgent')
    expect(parseNaturalTask('a @明天 @後天', SAT).line).toBe('- [ ] a @後天 📅 2026-10-18')
  })

  it('# 開頭但不是標籤（純數字）留在標題', () => {
    expect(parseNaturalTask('修 #123 @today', SAT).line).toBe('- [ ] 修 #123 📅 2026-10-17')
  })

  it('產生的行可被 parseTaskLine 讀回到期日（⏰ 不在 entry.js 的剝除清單，會留在標題）', async () => {
    const { parseTaskLine } = await import('./tasks')
    const t = parseTaskLine(parseNaturalTask('買菜 @明天 9am !high #家', SAT).line)
    expect(t).toMatchObject({ done: false, title: '買菜 ⏰ 09:00', due: '2026-10-18' })
  })
})

describe('resolveDate', () => {
  it('今天、明天、後天、大後天與英文', () => {
    expect(resolveDate('今天', SAT)).toBe('2026-10-17')
    expect(resolveDate('today', SAT)).toBe('2026-10-17')
    expect(resolveDate('Tomorrow', SAT)).toBe('2026-10-18')
    expect(resolveDate('明天', SAT)).toBe('2026-10-18')
    expect(resolveDate('后天', SAT)).toBe('2026-10-19')
    expect(resolveDate('大後天', SAT)).toBe('2026-10-20')
  })

  it('跨月、跨年、閏年', () => {
    expect(resolveDate('明天', new Date(2026, 9, 31))).toBe('2026-11-01')
    expect(resolveDate('明天', new Date(2026, 11, 31, 23, 59))).toBe('2027-01-01')
    expect(resolveDate('明天', new Date(2028, 1, 28))).toBe('2028-02-29')
    expect(resolveDate('明天', new Date(2027, 1, 28))).toBe('2027-03-01')
    expect(resolveDate('後天', new Date(2028, 1, 28))).toBe('2028-03-01')
  })

  it('週X：本週剩下的那天，今天算數', () => {
    // 週六 → 週六是今天、週日是明天、週一是後天
    expect(resolveDate('週六', SAT)).toBe('2026-10-17')
    expect(resolveDate('週日', SAT)).toBe('2026-10-18')
    expect(resolveDate('周天', SAT)).toBe('2026-10-18')
    expect(resolveDate('星期一', SAT)).toBe('2026-10-19')
    expect(resolveDate('禮拜五', SAT)).toBe('2026-10-23')
  })

  it('下週X：下一個日曆週（週一起算）', () => {
    expect(resolveDate('下週一', SAT)).toBe('2026-10-19')
    expect(resolveDate('下週日', SAT)).toBe('2026-10-25')
    expect(resolveDate('下下週三', SAT)).toBe('2026-10-28')
    // 從週一看：下週一是 7 天後，不是今天
    const mon = new Date(2026, 9, 19)
    expect(resolveDate('週一', mon)).toBe('2026-10-19')
    expect(resolveDate('下週一', mon)).toBe('2026-10-26')
    expect(resolveDate('下周五', mon)).toBe('2026-10-30')
    // 從週日看：下週一是明天
    expect(resolveDate('下週一', new Date(2026, 9, 18))).toBe('2026-10-19')
  })

  it('跨年的下週', () => {
    // 2026-12-31 是週四
    expect(resolveDate('下週一', new Date(2026, 11, 31))).toBe('2027-01-04')
    expect(resolveDate('週日', new Date(2026, 11, 31))).toBe('2027-01-03')
  })

  it('英文星期', () => {
    expect(resolveDate('mon', SAT)).toBe('2026-10-19')
    expect(resolveDate('Saturday', SAT)).toBe('2026-10-17')
    expect(resolveDate('next-sat', SAT)).toBe('2026-10-24')
    expect(resolveDate('nextfri', SAT)).toBe('2026-10-23')
  })

  it('X號：本月未過用本月，否則下月；大小月', () => {
    expect(resolveDate('17號', SAT)).toBe('2026-10-17')
    expect(resolveDate('20号', SAT)).toBe('2026-10-20')
    expect(resolveDate('5號', SAT)).toBe('2026-11-05')
    expect(resolveDate('31號', SAT)).toBe('2026-10-31')
    // 11 月沒有 31 號 → 12/31
    expect(resolveDate('31號', new Date(2026, 10, 1))).toBe('2026-12-31')
    // 1/31 之後找 30 號：2 月沒有 → 3/30
    expect(resolveDate('30日', new Date(2027, 0, 31))).toBe('2027-03-30')
    // 跨年
    expect(resolveDate('1號', new Date(2026, 11, 15))).toBe('2027-01-01')
    // 閏年 2 月 29 號
    expect(resolveDate('29號', new Date(2028, 1, 10))).toBe('2028-02-29')
    expect(resolveDate('29號', new Date(2027, 1, 10))).toBe('2027-03-29')
    expect(resolveDate('0號', SAT)).toBeNull()
    expect(resolveDate('32號', SAT)).toBeNull()
  })

  it('M月D號、M/D、ISO', () => {
    expect(resolveDate('12月25號', SAT)).toBe('2026-12-25')
    expect(resolveDate('1月1日', SAT)).toBe('2027-01-01')
    expect(resolveDate('10/17', SAT)).toBe('2026-10-17')
    expect(resolveDate('10/16', SAT)).toBe('2027-10-16')
    expect(resolveDate('2月29號', SAT)).toBe('2028-02-29')
    expect(resolveDate('2月30號', SAT)).toBeNull()
    expect(resolveDate('2026-02-28', SAT)).toBe('2026-02-28')
    expect(resolveDate('2026-02-29', SAT)).toBeNull()
  })

  it('認不得', () => {
    expect(resolveDate('someday', SAT)).toBeNull()
    expect(resolveDate('週八', SAT)).toBeNull()
  })
})

describe('parseTime', () => {
  it('am/pm', () => {
    expect(parseTime('9am')).toBe('09:00')
    expect(parseTime('9:30PM')).toBe('21:30')
    expect(parseTime('12am')).toBe('00:00')
    expect(parseTime('12pm')).toBe('12:00')
    expect(parseTime('13pm')).toBeNull()
    expect(parseTime('0am')).toBeNull()
  })

  it('24 小時制', () => {
    expect(parseTime('9:05')).toBe('09:05')
    expect(parseTime('23:59')).toBe('23:59')
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('9:60')).toBeNull()
  })

  it('中文', () => {
    expect(parseTime('9點')).toBe('09:00')
    expect(parseTime('9点半')).toBe('09:30')
    expect(parseTime('下午3點15分')).toBe('15:15')
    expect(parseTime('晚上8點')).toBe('20:00')
    expect(parseTime('中午12點')).toBe('12:00')
    expect(parseTime('中午1點')).toBe('13:00')
    expect(parseTime('凌晨12點')).toBe('00:00')
    expect(parseTime('下午13點')).toBeNull()
    expect(parseTime('20點')).toBe('20:00')
    expect(parseTime('點心')).toBeNull()
  })
})

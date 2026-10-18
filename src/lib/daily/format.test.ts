import { describe, expect, it } from 'vitest'
import {
  DAILY_DEFAULTS,
  dailyNotePath,
  formatDate,
  isValidDailyPattern,
  parseDailyNotePath,
  parseDate,
  toDateKey,
} from './format'

// 2026-10-17 是星期六
const sat = new Date(2026, 9, 17)

describe('DAILY_DEFAULTS', () => {
  it('沿用外掛預設值', () => {
    expect(DAILY_DEFAULTS).toEqual({
      dailyFolder: '20 Journal/21 Daily',
      dailyPattern: 'YYYYMMDD',
      inboxFolder: '10 Inbox',
      staleDays: 3,
    })
  })
})

describe('formatDate', () => {
  it('支援所有 token', () => {
    expect(formatDate(sat, 'YYYYMMDD')).toBe('20261017')
    expect(formatDate(sat, 'YYYY-MM-DD ddd')).toBe('2026-10-17 Sat')
    expect(formatDate(sat, 'YYYY-MM-DD dddd')).toBe('2026-10-17 Saturday')
  })

  it('個位數月份與日期補零', () => {
    expect(formatDate(new Date(2026, 0, 5), 'YYYY-MM-DD')).toBe('2026-01-05')
  })

  it('/ 表示子資料夾', () => {
    expect(formatDate(sat, 'YYYY/MM/YYYYMMDD')).toBe('2026/10/20261017')
  })

  it('[...] 內為原樣文字', () => {
    expect(formatDate(sat, '[Daily DD] YYYY-MM-DD')).toBe('Daily DD 2026-10-17')
  })
})

describe('parseDate', () => {
  it('與 formatDate 互為反函數', () => {
    const patterns = ['YYYYMMDD', 'YYYY-MM-DD', 'YYYY-MM-DD ddd', 'YYYY-MM-DD dddd', 'YYYY/MM/YYYY-MM-DD', '[Log] YYYY.MM.DD']
    const dates = [sat, new Date(2024, 1, 29), new Date(2027, 0, 1), new Date(2026, 11, 31)]
    for (const pattern of patterns) {
      for (const date of dates) {
        expect(parseDate(formatDate(date, pattern), pattern)).toEqual(date)
      }
    }
  })

  it('回傳當地時間 00:00', () => {
    const date = parseDate('20261017', 'YYYYMMDD')!
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 17, 0])
  })

  it('不合法的檔名回傳 null', () => {
    expect(parseDate('2026101', 'YYYYMMDD')).toBeNull()
    expect(parseDate('202610170', 'YYYYMMDD')).toBeNull()
    expect(parseDate('2026-10-17', 'YYYYMMDD')).toBeNull()
    expect(parseDate('20261017 copy', 'YYYYMMDD')).toBeNull()
    expect(parseDate('abcdefgh', 'YYYYMMDD')).toBeNull()
    expect(parseDate('', 'YYYYMMDD')).toBeNull()
  })

  it('不存在的日期回傳 null', () => {
    expect(parseDate('20261301', 'YYYYMMDD')).toBeNull()
    expect(parseDate('20260230', 'YYYYMMDD')).toBeNull()
    expect(parseDate('20250229', 'YYYYMMDD')).toBeNull()
    expect(parseDate('20261000', 'YYYYMMDD')).toBeNull()
  })

  it('星期與日期不符回傳 null', () => {
    expect(parseDate('2026-10-17 Sat', 'YYYY-MM-DD ddd')).toEqual(sat)
    expect(parseDate('2026-10-17 Sun', 'YYYY-MM-DD ddd')).toBeNull()
    expect(parseDate('2026-10-17 Friday', 'YYYY-MM-DD dddd')).toBeNull()
  })

  it('星期名稱只認英文', () => {
    expect(parseDate('2026-10-17 週六', 'YYYY-MM-DD ddd')).toBeNull()
    expect(parseDate('2026-10-17 sat', 'YYYY-MM-DD ddd')).toBeNull()
  })

  it('重複 token 不一致回傳 null', () => {
    expect(parseDate('2026/20261017', 'YYYY/YYYYMMDD')).toEqual(sat)
    expect(parseDate('2025/20261017', 'YYYY/YYYYMMDD')).toBeNull()
  })

  it('格式缺少年月日時回傳 null', () => {
    expect(parseDate('2026-10', 'YYYY-MM')).toBeNull()
    expect(parseDate('Sat', 'ddd')).toBeNull()
  })
})

describe('isValidDailyPattern', () => {
  it('需含 YYYY、MM、DD', () => {
    expect(isValidDailyPattern('YYYYMMDD')).toBe(true)
    expect(isValidDailyPattern('YYYY/MM/YYYY-MM-DD dddd')).toBe(true)
    expect(isValidDailyPattern('YYYY-MM')).toBe(false)
    expect(isValidDailyPattern('dddd')).toBe(false)
    expect(isValidDailyPattern('')).toBe(false)
    expect(isValidDailyPattern('[YYYYMMDD]')).toBe(false)
  })

  it('不允許空的資料夾段落', () => {
    expect(isValidDailyPattern('/YYYYMMDD')).toBe(false)
    expect(isValidDailyPattern('YYYYMMDD/')).toBe(false)
    expect(isValidDailyPattern('YYYY//MMDD')).toBe(false)
  })
})

describe('dailyNotePath / parseDailyNotePath', () => {
  it('預設資料夾與格式', () => {
    expect(dailyNotePath(sat)).toBe('20 Journal/21 Daily/20261017.md')
    expect(parseDailyNotePath('20 Journal/21 Daily/20261017.md')).toEqual(sat)
  })

  it('支援子資料夾格式', () => {
    const path = dailyNotePath(sat, 'Journal', 'YYYY/MM/YYYY-MM-DD')
    expect(path).toBe('Journal/2026/10/2026-10-17.md')
    expect(parseDailyNotePath(path, 'Journal', 'YYYY/MM/YYYY-MM-DD')).toEqual(sat)
  })

  it('資料夾為空時放在 vault 根目錄', () => {
    expect(dailyNotePath(sat, '', 'YYYY-MM-DD')).toBe('2026-10-17.md')
    expect(parseDailyNotePath('2026-10-17.md', '', 'YYYY-MM-DD')).toEqual(sat)
  })

  it('容忍資料夾前後斜線與反斜線', () => {
    expect(dailyNotePath(sat, '/20 Journal/21 Daily/')).toBe('20 Journal/21 Daily/20261017.md')
    expect(parseDailyNotePath('20 Journal\\21 Daily\\20261017.md')).toEqual(sat)
  })

  it('.md 可有可無', () => {
    expect(parseDailyNotePath('20 Journal/21 Daily/20261017')).toEqual(sat)
  })

  it('不在日記資料夾或檔名不符時回傳 null', () => {
    expect(parseDailyNotePath('10 Inbox/20261017.md')).toBeNull()
    expect(parseDailyNotePath('20 Journal/21 Daily Extra/20261017.md')).toBeNull()
    expect(parseDailyNotePath('20 Journal/21 Daily/sub/20261017.md')).toBeNull()
    expect(parseDailyNotePath('20 Journal/21 Daily/Weekly review.md')).toBeNull()
  })
})

describe('toDateKey', () => {
  it('輸出 YYYY-MM-DD', () => {
    expect(toDateKey(sat)).toBe('2026-10-17')
  })
})

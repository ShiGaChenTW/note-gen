import { describe, expect, it } from 'vitest'
import { toDateKey } from './format'
import { dailyNoteDateKeys, stepDailyDate } from './daily-nav'

const TODAY = new Date(2026, 9, 18, 9, 0)
const existing = new Set(['2026-10-10', '2026-10-15', '2026-10-17', '2026-10-25'])
const step = (from: string, dir: -1 | 1) => {
  const [y, m, d] = from.split('-').map(Number)
  const result = stepDailyDate(new Date(y, m - 1, d), dir, existing, TODAY)
  return result ? toDateKey(result) : null
}

describe('dailyNoteDateKeys', () => {
  it('只收日記資料夾內符合格式的檔案', () => {
    const keys = dailyNoteDateKeys([
      '20 Journal/21 Daily/20261017.md',
      '20 Journal/21 Daily/20261018.md',
      '20 Journal/21 Daily/notes.md',
      'Other/20261016.md',
    ], '20 Journal/21 Daily', 'YYYYMMDD')
    expect([...keys].sort()).toEqual(['2026-10-17', '2026-10-18'])
  })
})

describe('stepDailyDate', () => {
  it('往前跳過沒有日記的日子', () => {
    expect(step('2026-10-17', -1)).toBe('2026-10-15')
    expect(step('2026-10-15', -1)).toBe('2026-10-10')
  })

  it('最早一篇再往前是 null', () => {
    expect(step('2026-10-10', -1)).toBeNull()
  })

  it('往今天走、中間沒有日記時停在今天（今天還沒有日記也一樣）', () => {
    expect(step('2026-10-17', 1)).toBe('2026-10-18')
    expect(step('2026-10-25', -1)).toBe('2026-10-18')
  })

  it('今天之後照樣找下一篇已存在的日記', () => {
    expect(step('2026-10-18', 1)).toBe('2026-10-25')
    expect(step('2026-10-25', 1)).toBeNull()
    expect(step('2026-10-18', -1)).toBe('2026-10-17')
  })
})

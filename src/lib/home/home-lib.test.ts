import { describe, expect, it } from 'vitest'
import { diffSnapshots, emptyLog, normalizeLog, pruneLog, recordActivity, weekCounts } from './activity'
import { captureContent, captureFileName, capturePath } from './capture'
import { DEFAULT_SIGNAL_RULES, evaluateSignals, isoWeekKey, normalizeSignalRules, type SignalInput } from './signals'

const at = (iso: string) => new Date(iso)

function input(partial: Partial<SignalInput>): SignalInput {
  return {
    now: at('2026-10-26T10:00:00'),
    overdueDues: [],
    hasDailyNote: () => true,
    inbox: [],
    inboxFolder: '10 Inbox',
    linklessCount: 0,
    weeklyReviewDone: true,
    ...partial,
  }
}

const ids = (i: SignalInput, rules = DEFAULT_SIGNAL_RULES) => evaluateSignals(i, rules).map(s => s.id)

describe('提醒規則', () => {
  it('沒事就不提醒', () => {
    expect(ids(input({}))).toEqual([])
  })

  it('逾期與逾期超過 N 天', () => {
    const signals = evaluateSignals(input({ overdueDues: ['2026-10-25', '2026-10-20', '2026-10-21'] }), DEFAULT_SIGNAL_RULES)
    expect(signals).toEqual([
      { id: 'overdue', values: { count: 3 } },
      { id: 'overdueLong', values: { count: 2, days: 3 } },
    ])
  })

  it('晚上還沒寫每日筆記、連續幾天沒寫', () => {
    expect(ids(input({ now: at('2026-10-26T17:59:00'), hasDailyNote: d => d !== 0 }))).toEqual([])
    expect(ids(input({ now: at('2026-10-26T18:00:00'), hasDailyNote: d => d !== 0 }))).toEqual(['dailyNoteToday'])
    expect(ids(input({ hasDailyNote: d => d === 0 }))).toEqual(['dailyNoteStreak'])
    expect(ids(input({ hasDailyNote: d => d === 0 || d === 2 }))).toEqual([])
  })

  it('Inbox 積壓與放太久', () => {
    const now = at('2026-10-26T10:00:00').getTime()
    const fresh = { path: '10 Inbox/a.md', mtime: now - 3_600_000 }
    const old = { path: '10 Inbox/b.md', mtime: now - 80 * 3_600_000 }
    expect(ids(input({ inbox: [fresh, fresh, fresh] }))).toEqual(['inboxCount'])
    expect(evaluateSignals(input({ inbox: [old] }), DEFAULT_SIGNAL_RULES)).toEqual([{ id: 'inboxOld', values: { days: 3, folder: '10 Inbox' } }])
  })

  it('缺連結的筆記與週末複盤', () => {
    expect(ids(input({ linklessCount: 5 }))).toEqual(['linkless'])
    expect(ids(input({ linklessCount: 4 }))).toEqual([])
    expect(ids(input({ now: at('2026-10-30T18:30:00'), weeklyReviewDone: false }))).toEqual(['weeklyReview'])
    expect(ids(input({ now: at('2026-10-30T17:00:00'), weeklyReviewDone: false }))).toEqual([])
    expect(ids(input({ now: at('2026-11-01T09:00:00'), weeklyReviewDone: false }))).toEqual(['weeklyReview'])
  })

  it('規則可以個別關掉、門檻可調', () => {
    const rules = normalizeSignalRules({ overdue: { enabled: false }, linkless: { count: 2 } })
    expect(ids(input({ overdueDues: ['2026-10-01'], linklessCount: 2 }), rules)).toEqual(['linkless'])
    expect(normalizeSignalRules({ dailyNote: { afterHour: 99 } }).dailyNote.afterHour).toBe(23)
    expect(normalizeSignalRules('x')).toEqual(DEFAULT_SIGNAL_RULES)
  })

  it('ISO 週鍵', () => {
    expect(isoWeekKey(at('2026-10-26T10:00:00'))).toBe('2026-W44')
    expect(isoWeekKey(at('2027-01-01T10:00:00'))).toBe('2026-W53')
  })
})

describe('本週足跡', () => {
  it('第一次載入不算事件；之後新檔算寫下、時間變新算修改', () => {
    expect(diffSnapshots(null, new Map([['a.md', 1]]))).toEqual({ created: [], modified: [] })
    expect(diffSnapshots(new Map([['a.md', 1], ['b.md', 5]]), new Map([['a.md', 2], ['b.md', 5], ['c.md', 1]]))).toEqual({ created: ['c.md'], modified: ['a.md'] })
  })

  it('同一天同一篇只算一次；今天寫過或改過的不算重讀', () => {
    const now = at('2026-10-26T10:00:00')
    let log = recordActivity(emptyLog(), 'modified', 'a.md', now)
    log = recordActivity(log, 'modified', 'a.md', now)
    log = recordActivity(log, 'reread', 'a.md', now)
    log = recordActivity(log, 'reread', 'b.md', now)
    expect(log.days['2026-10-26']).toEqual({ modified: ['a.md'], reread: ['b.md'] })
  })

  it('本週從週一算起，只留 60 天', () => {
    let log = recordActivity(emptyLog(), 'created', 'x.md', at('2026-10-26T09:00:00'))
    log = recordActivity(log, 'reread', 'y.md', at('2026-10-28T09:00:00'))
    log = recordActivity(log, 'created', 'old.md', at('2026-07-01T09:00:00'))
    const week = weekCounts(log, at('2026-10-29T12:00:00'))
    expect(week.map(d => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(week[0]).toMatchObject({ created: 1 })
    expect(week[2]).toMatchObject({ reread: 1 })
    expect(Object.keys(pruneLog(log, at('2026-10-29T12:00:00')).days)).toEqual(['2026-10-26', '2026-10-28'])
    expect(normalizeLog({ days: { bad: {}, '2026-10-26': { created: ['a', 3] } } })).toEqual({ days: { '2026-10-26': { created: ['a'] } } })
  })
})

describe('快速記錄', () => {
  it('檔名用時間加第一行，去掉不能用的字元', () => {
    const now = at('2026-10-26T09:05:00')
    expect(captureFileName('想到一件事：整理 [[Rust]]#tag', now)).toBe('2026-10-26 0905 想到一件事：整理 Rust tag.md')
    expect(captureFileName('   ', now)).toBe('2026-10-26 0905.md')
    expect(captureFileName('a'.repeat(40), now)).toBe(`2026-10-26 0905 ${'a'.repeat(24)}.md`)
    expect(capturePath('10 Inbox/', 'x.md')).toBe('10 Inbox/x.md')
    expect(capturePath('10 Inbox', 'x.md', 1)).toBe('10 Inbox/x 2.md')
    expect(captureContent('  hi \n')).toBe('hi\n')
  })
})

// Fork（almanac ALMNC-54.12）：重新確認期限——讀專家 rules.md、預設值（技術 6 個月／一般 1 年）、到期判斷。
import { describe, expect, it } from 'vitest'
import { expertRules } from '@/lib/commander/domain-proposal'
import {
  dueDate, defaultInterval, formatInterval, GENERAL_INTERVAL, intervalForNote, intervalsByDomain, isOverdue, notesDueForConfirm,
  parseReconfirmInterval, TECHNICAL_INTERVAL,
} from './interval'

describe('parseReconfirmInterval', () => {
  it('reads the line written in rules.md', () => {
    expect(parseReconfirmInterval('# rules\n- 重新確認頻率：6 個月（Scott 可以改）。')).toEqual({ amount: 6, unit: 'month', from: 'rules' })
    expect(parseReconfirmInterval('重新確認：2 年')).toEqual({ amount: 2, unit: 'year', from: 'rules' })
    expect(parseReconfirmInterval('- 重新確認期限: 90 天')).toEqual({ amount: 90, unit: 'day', from: 'rules' })
    expect(parseReconfirmInterval('- 重新确认频率：每 3 个月')).toEqual({ amount: 3, unit: 'month', from: 'rules' })
    expect(parseReconfirmInterval('Reconfirm interval: 4 weeks')).toEqual({ amount: 4, unit: 'week', from: 'rules' })
    expect(parseReconfirmInterval('- 重新確認頻率：一年')).toEqual({ amount: 1, unit: 'year', from: 'rules' })
  })

  it('returns undefined when nothing usable is written', () => {
    expect(parseReconfirmInterval(undefined)).toBeUndefined()
    expect(parseReconfirmInterval('- 只撰寫知識筆記草稿')).toBeUndefined()
    expect(parseReconfirmInterval('重新確認頻率：0 天')).toBeUndefined()
  })

  it('round-trips the drafted expert rules (technical 6 months, general 1 year)', () => {
    expect(parseReconfirmInterval(expertRules('資料工程'))).toMatchObject({ amount: 6, unit: 'month' })
    expect(parseReconfirmInterval(expertRules('園藝'))).toMatchObject({ amount: 1, unit: 'year' })
    expect(parseReconfirmInterval(`- 重新確認頻率：${formatInterval({ amount: 3, unit: 'week' })}`)).toMatchObject({ amount: 3, unit: 'week' })
  })
})

describe('defaults and per-domain intervals', () => {
  it('defaults technical domains to 6 months and others to 1 year', () => {
    expect(defaultInterval('軟體工程')).toBe(TECHNICAL_INTERVAL)
    expect(defaultInterval('Data Engineering')).toBe(TECHNICAL_INTERVAL)
    expect(defaultInterval('烹飪')).toBe(GENERAL_INTERVAL)
    expect(defaultInterval(undefined)).toBe(GENERAL_INTERVAL)
  })

  it('uses the expert rules, falls back to the parent domain expert, then to defaults', () => {
    const domains = [
      { id: 'ie', name: '工業工程' },
      { id: 'ie-lean', name: '精實生產', parentId: 'ie' },
      { id: 'cook', name: '烹飪' },
      { id: 'de', name: '資料工程' },
    ]
    const map = intervalsByDomain(domains, [{ domain: ' 工業工程 ', rules: '- 重新確認頻率：3 個月' }, { domain: '烹飪', rules: '沒寫' }])
    expect(map.get('ie')).toEqual({ amount: 3, unit: 'month', from: 'rules' })
    expect(map.get('ie-lean')).toEqual({ amount: 3, unit: 'month', from: 'rules' })
    expect(map.get('cook')).toBe(GENERAL_INTERVAL)
    expect(map.get('de')).toBe(TECHNICAL_INTERVAL)
    // Fork（almanac ALMNC-69.4）：筆記 domains 存名稱時也查得到。
    expect(map.get('工業工程')).toEqual({ amount: 3, unit: 'month', from: 'rules' })
    expect(intervalForNote(['精實生產'], map)).toEqual({ amount: 3, unit: 'month', from: 'rules' })
  })

  it('takes the shortest interval of a note in several domains, 1 year without a domain', () => {
    const map = new Map([['a', GENERAL_INTERVAL], ['b', TECHNICAL_INTERVAL]])
    expect(intervalForNote(['a', 'b'], map)).toBe(TECHNICAL_INTERVAL)
    expect(intervalForNote([], map)).toBe(GENERAL_INTERVAL)
    expect(intervalForNote(['unknown'], map)).toBe(GENERAL_INTERVAL)
  })
})

describe('due dates', () => {
  it('adds calendar months and clamps month ends', () => {
    expect(dueDate('2026-05-20', TECHNICAL_INTERVAL)).toBe('2026-11-20')
    expect(dueDate('2026-08-31', { amount: 6, unit: 'month' })).toBe('2027-02-28')
    expect(dueDate('2026-01-01', { amount: 2, unit: 'week' })).toBe('2026-01-15')
    expect(dueDate('nope', GENERAL_INTERVAL)).toBeUndefined()
    expect(isOverdue('2025-11-21', GENERAL_INTERVAL, '2026-11-21')).toBe(true)
    expect(isOverdue('2025-11-22', GENERAL_INTERVAL, '2026-11-21')).toBe(false)
  })

  it('lists overdue knowledge notes by due date, skipping superseded, archived and undated ones', () => {
    const intervals = new Map([['tech', TECHNICAL_INTERVAL]])
    const notes = [
      { path: 'k/tech.md', frontmatter: { type: 'knowledge', domains: ['tech'], lastConfirmed: '2026-04-01', title: 'React 19' } },
      { path: 'k/general.md', frontmatter: { type: 'knowledge', lastConfirmed: '2026-04-01' } },
      { path: 'k/old.md', frontmatter: { type: 'knowledge', lastConfirmed: '2025-01-01' } },
      { path: 'k/gone.md', frontmatter: { type: 'knowledge', lastConfirmed: '2020-01-01', status: 'superseded' } },
      { path: 'k/none.md', frontmatter: { type: 'knowledge' } },
      { path: 'r/rec.md', frontmatter: { type: 'record', lastConfirmed: '2020-01-01' } },
    ]
    expect(notesDueForConfirm(notes, intervals, '2026-11-21').map(note => [note.path, note.dueDate])).toEqual([
      ['k/old.md', '2026-01-01'],
      ['k/tech.md', '2026-10-01'],
    ])
    // 每週回顧：到週末為止會到期的。
    expect(notesDueForConfirm(notes, intervals, '2026-11-21', { until: '2027-04-01' }).map(note => note.path)).toContain('k/general.md')
  })
})

import { describe, expect, it } from 'vitest'
import { parseDailyNote } from '@/lib/daily/daily-note'
import { collectTasks } from '@/lib/vault-index/index-core'
import { indexNote } from '@/lib/vault-index/index-note'
import {
  buildAgenda,
  buildWeek,
  carryTasks,
  daysBetween,
  groupTasks,
  insertLinesInSection,
  needAttentionCount,
  openTaskLines,
  staleInboxNotes,
} from './today-model'

// 2026-10-18 週日 14:20
const NOW = new Date(2026, 9, 18, 14, 20)

const tasks = collectTasks([
  indexNote('Acme.md', [
    '- [ ] 寄報價單 📅 2026-10-15 ⏫',
    '- [ ] 整理 token 📅 2026-10-16',
    '- [ ] 今天寄信 📅 2026-10-18 ⏰ 15:00',
    '- [ ] 明天開會 📅 2026-10-19',
    '- [ ] 後天交件 📅 2026-10-20',
    '- [ ] 大後天 📅 2026-10-21',
    '- [ ] 沒有日期',
    '- [x] 今天做完 📅 2026-10-18 ✅ 2026-10-18',
    '- [x] 昨天做完 📅 2026-10-16 ✅ 2026-10-17',
  ].join('\n'), 1),
])

describe('groupTasks', () => {
  const groups = groupTasks(tasks, NOW)

  it('lists overdue tasks oldest first', () => {
    expect(groups.overdue.map(t => t.title)).toEqual(['寄報價單', '整理 token'])
  })

  it('groups today, tomorrow and the day after, ignoring later and undated tasks', () => {
    expect(groups.upcoming.map(d => [d.date, d.tasks.map(t => t.title)])).toEqual([
      ['2026-10-18', ['今天寄信']],
      ['2026-10-19', ['明天開會']],
      ['2026-10-20', ['後天交件']],
    ])
    expect(groups.pendingCount).toBe(5)
  })

  it('collects tasks completed today', () => {
    expect(groups.doneToday.map(t => t.title)).toEqual(['今天做完'])
  })

  it('counts overdue, due today and stale inbox for the status bar', () => {
    expect(needAttentionCount(groups, 3)).toBe(2 + 1 + 3)
  })
})

describe('daysBetween', () => {
  it('counts calendar days across months', () => {
    expect(daysBetween('2026-10-15', '2026-10-18')).toBe(3)
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })
})

describe('buildAgenda', () => {
  const dailyNote = parseDailyNote([
    '## 錨點時段',
    '- 08:00-08:40 早晨啟動',
    '- 14:00–15:00 深工作',
    '- 21:30 整日復盤',
  ].join('\n'))

  const agenda = buildAgenda({
    now: NOW,
    dailyNote,
    tasks,
    events: [{
      id: 'e1', title: '規格討論', calendar: '工作', allDay: false,
      start: new Date(2026, 9, 18, 10, 15).getTime(), end: new Date(2026, 9, 18, 11, 30).getTime(),
    }, {
      id: 'e2', title: '全天活動', calendar: '工作', allDay: true, start: 0, end: 0,
    }],
  })

  it('merges anchors, timed tasks and calendar events in time order', () => {
    expect(agenda.map(i => [i.kind, i.title])).toEqual([
      ['anchor', '早晨啟動'],
      ['calendar', '規格討論'],
      ['anchor', '深工作'],
      ['task', '今天寄信'],
      ['anchor', '整日復盤'],
    ])
  })

  it('marks past, current and upcoming items', () => {
    expect(agenda.map(i => i.state)).toEqual(['past', 'past', 'now', 'upcoming', 'upcoming'])
  })

  it('reports remaining minutes and progress of the current item', () => {
    const now = agenda.find(i => i.state === 'now')!
    expect(now.minutesLeft).toBe(40)
    expect(now.progress).toBeCloseTo(1 / 3)
  })

  it('gives open-ended items a duration up to the next item, capped at 60 minutes', () => {
    const review = agenda.find(i => i.title === '整日復盤')!
    expect((review.end - review.start) / 60_000).toBe(60)
    const task = agenda.find(i => i.kind === 'task')!
    expect((task.end - task.start) / 60_000).toBe(60)
  })
})

describe('buildWeek', () => {
  it('returns Monday to Sunday with note presence and due counts', () => {
    const week = buildWeek({
      now: NOW,
      tasks,
      dailyNotePathFor: d => `Daily/${d.getDate()}.md`,
      hasNote: path => path !== 'Daily/18.md',
    })
    expect(week.map(d => d.date)).toEqual([
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
    ])
    expect(week[6]).toMatchObject({ isToday: true, hasNote: false, open: 1, total: 2 })
    expect(week[3]).toMatchObject({ hasNote: true, open: 1, total: 1 })
  })
})

describe('staleInboxNotes', () => {
  it('finds inbox notes untouched for longer than staleDays', () => {
    const day = 86_400_000
    const notes = [
      indexNote('10 Inbox/old.md', '', NOW.getTime() - 5 * day),
      indexNote('10 Inbox/new.md', '', NOW.getTime() - day),
      indexNote('20 Journal/old.md', '', NOW.getTime() - 9 * day),
    ]
    expect(staleInboxNotes(notes, '10 Inbox', 3, NOW).map(n => n.path)).toEqual(['10 Inbox/old.md'])
  })
})

describe('carryTasks', () => {
  const yesterday = [
    '# 20261017',
    '- [ ] 寄報價單 📅 2026-10-15',
    '- [x] 做完的',
    '  - [/] 進行中的子任務',
    '- 普通清單',
    '',
  ].join('\n')
  const today = [
    '# 20261018',
    '## 捕捉軌',
    '- 想法 A',
    '',
    '## 沉澱',
    '',
  ].join('\n')

  it('moves open tasks into the capture section and leaves a link behind', () => {
    const lines = openTaskLines(yesterday)
    expect(lines).toEqual([1, 3])
    const result = carryTasks({ source: yesterday, target: today, lines, targetNoteName: '20261018' })
    expect(result.moved).toBe(2)
    expect(result.source.split('\n')).toEqual([
      '# 20261017',
      '- 寄報價單 📅 2026-10-15 → [[20261018]]',
      '- [x] 做完的',
      '  - 進行中的子任務 → [[20261018]]',
      '- 普通清單',
      '',
    ])
    expect(result.target.split('\n')).toEqual([
      '# 20261018',
      '## 捕捉軌',
      '- 想法 A',
      '- [ ] 寄報價單 📅 2026-10-15',
      '- [ ] 進行中的子任務',
      '',
      '## 沉澱',
      '',
    ])
  })

  it('appends at the end when the section is missing and ignores non-task lines', () => {
    const result = carryTasks({ source: yesterday, target: '# 今天\n', lines: [1, 2, 4, 99], targetNoteName: 'x' })
    expect(result.moved).toBe(1)
    expect(result.target).toBe('# 今天\n- [ ] 寄報價單 📅 2026-10-15\n')
  })

  it('returns inputs untouched when nothing moves', () => {
    const result = carryTasks({ source: yesterday, target: today, lines: [0], targetNoteName: 'x' })
    expect(result).toEqual({ source: yesterday, target: today, moved: 0 })
  })

  it('keeps CRLF line endings on both notes', () => {
    const result = carryTasks({ source: '- [ ] a\r\n', target: '# t\r\n', lines: [0], targetNoteName: 'n' })
    expect(result.source).toBe('- a → [[n]]\r\n')
    expect(result.target).toBe('# t\r\n- [ ] a\r\n')
  })
})

describe('insertLinesInSection', () => {
  it('插在指定區塊最後、略過尾端空行', () => {
    const target = '# 今日\n\n## 捕捉軌\n- [ ] 舊的\n\n## 沉澱\n'
    expect(insertLinesInSection(target, ['- [ ] 新的'], '捕捉軌'))
      .toBe('# 今日\n\n## 捕捉軌\n- [ ] 舊的\n- [ ] 新的\n\n## 沉澱\n')
  })

  it('找不到區塊時附在檔尾，沿用 CRLF', () => {
    expect(insertLinesInSection('# 今日\r\n內容\r\n', ['- [ ] 新的'], '捕捉軌'))
      .toBe('# 今日\r\n內容\r\n- [ ] 新的\r\n')
  })
})

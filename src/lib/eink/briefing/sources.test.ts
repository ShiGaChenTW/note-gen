// almanac ALMNC-47：今日簡報各來源的 adapter（行程、釘選資料、稍後讀、知識報告、工作台摘要）。天氣在 weather.test.ts。
import { describe, expect, it } from 'vitest'
import type { CalendarResponse } from '@/lib/calendar/calendar'
import type { EinkPin } from '@/lib/eink/pins'
import type { ReportData } from '@/lib/knowledge-report/report'
import type { TaskRef } from '@/lib/vault-index/index-core'
import {
  createPinsSource, createReadLaterSource, createReportSource, createScheduleSource, createWorkbenchSource,
} from './sources'

const DAY = new Date(2026, 10, 21, 7, 30)
const at = (h: number, m = 0, day = 21) => new Date(2026, 10, day, h, m).getTime()

function task(partial: Partial<TaskRef>): TaskRef {
  return { path: 'a.md', line: 0, done: false, title: 't', due: '', time: '', priority: 'mid', recurrence: '', raw: '- [ ] t', ...partial }
}

const JOURNAL = ['# 2026-11-21', '', '## 錨點時段', '- 09:00-10:00 專注寫作', '- 沒有時間的一行'].join('\n')

describe('行程 adapter', () => {
  const granted: CalendarResponse = {
    access: 'granted',
    events: [
      { id: 'e1', title: '看牙醫', start: at(14), end: at(15), allDay: false, calendar: '個人' },
      { id: 'e2', title: '連假', start: at(0), end: at(0, 0, 22), allDay: true, calendar: '假日' },
      { id: 'e3', title: '昨天的會', start: at(9, 0, 20), end: at(10, 0, 20), allDay: false, calendar: '工作' },
    ],
  }

  it('行事曆事件＋今天有時間的任務＋日誌時段，鍵跟私人標記一致', async () => {
    const source = createScheduleSource({
      loadEvents: async () => granted,
      tasks: () => [
        task({ path: '專案.md', title: '寄報價', due: '2026-11-21', time: '11:30' }),
        task({ title: '沒時間', due: '2026-11-21' }),
        task({ title: '已完成', due: '2026-11-21', time: '08:00', done: true }),
        task({ title: '明天', due: '2026-11-22', time: '08:00' }),
      ],
      dailyNote: async () => JOURNAL,
    })
    const result = await source(DAY)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.data.calendar).toBe('granted')
    expect(result.data.items.map(item => [item.key, item.start, item.end])).toEqual([
      ['cal:e1', at(14), at(15)],
      ['cal:e2', at(0), 0],
      ['task:專案.md#寄報價', at(11, 30), 0],
      ['anchor:2026-11-21#專注寫作', at(9), at(10)],
    ])
  })

  it('行事曆沒授權：仍列出任務與時段，標成 denied', async () => {
    const source = createScheduleSource({
      loadEvents: async () => ({ access: 'denied', events: [] }),
      tasks: () => [task({ title: '寄報價', due: '2026-11-21', time: '11:30' })],
      dailyNote: async () => null,
    })
    const result = await source(DAY)
    expect(result).toMatchObject({ status: 'ok', data: { calendar: 'denied' } })
    expect(result.status === 'ok' && result.data.items.map(item => item.kind)).toEqual(['task'])
  })

  it('行事曆沒授權、也沒有其他行程：回 denied', async () => {
    for (const access of ['denied', 'notDetermined', 'restricted'] as const) {
      const source = createScheduleSource({ loadEvents: async () => ({ access, events: [] }), tasks: () => [], dailyNote: async () => null })
      await expect(source(DAY)).resolves.toEqual({ status: 'denied' })
    }
  })

  it('任務或日誌讀不到只少那部分；行事曆丟錯當成無法使用', async () => {
    const source = createScheduleSource({
      loadEvents: async () => { throw new Error('no tauri') },
      tasks: () => Promise.reject(new Error('index not ready')),
      dailyNote: async () => JOURNAL,
    })
    const result = await source(DAY)
    expect(result).toMatchObject({ status: 'ok', data: { calendar: 'unavailable' } })
    expect(result.status === 'ok' && result.data.items).toHaveLength(1)
  })
})

describe('釘選資料 adapter', () => {
  const pin = (path: string, order: number): EinkPin => ({ path, pinnedAt: 1, order })

  it('釘選清單是空的：回 empty', async () => {
    const source = createPinsSource({ pins: async () => [], read: async () => 'x' })
    await expect(source(DAY)).resolves.toEqual({ status: 'empty' })
  })

  it('讀內容並取標題（frontmatter title → 一級標題 → 檔名），去掉 frontmatter', async () => {
    const files: Record<string, string> = {
      'a.md': '---\ntitle: 電子紙計畫\ntags: [x]\n---\n# 不是這個\n內文',
      '夾/b.md': '# 讀書筆記\n\n重點',
      'c.md': '只有內文',
    }
    const source = createPinsSource({ pins: async () => [pin('a.md', 0), pin('夾/b.md', 1), pin('c.md', 2)], read: async path => files[path] ?? null })
    const result = await source(DAY)
    expect(result.status === 'ok' && result.data.map(item => [item.title, item.content])).toEqual([
      ['電子紙計畫', '# 不是這個\n內文'],
      ['讀書筆記', '# 讀書筆記\n\n重點'],
      ['c', '只有內文'],
    ])
  })

  it('檔案不見、讀檔失敗、不是文字檔：那則 content 為 null，其他則照常', async () => {
    const source = createPinsSource({
      pins: async () => [pin('gone.md', 0), pin('boom.md', 1), pin('paper.pdf', 2), pin('ok.md', 3)],
      read: async path => {
        if (path === 'boom.md') throw new Error('EACCES')
        return path === 'ok.md' ? '好' : null
      },
    })
    const result = await source(DAY)
    expect(result.status === 'ok' && result.data.map(item => item.content)).toEqual([null, null, null, '好'])
  })

  it('清單讀不到：回 error', async () => {
    const source = createPinsSource({ pins: async () => { throw new Error('store') }, read: async () => null })
    await expect(source(DAY)).resolves.toMatchObject({ status: 'error' })
  })
})

describe('稍後讀 adapter', () => {
  it('稍後讀清單是空的：回 empty；有內容照原樣回', async () => {
    await expect(createReadLaterSource({ items: async () => [] })(DAY)).resolves.toEqual({ status: 'empty' })
    const item = { url: 'https://a.com/x', addedAt: 1, status: 'pending' as const }
    await expect(createReadLaterSource({ items: async () => [item] })(DAY)).resolves.toEqual({ status: 'ok', data: [item] })
  })
})

describe('知識報告 adapter', () => {
  const report = (period: string, generated: string): ReportData => ({
    period,
    generated,
    model: 'm',
    tokens: 1,
    topics: [{ name: '電子紙', level: 'organized', score: 40, notes: 3, prevLevel: 'contact', prevScore: 20, gap: '', comment: '', evidence: [] }],
    suggestions: [
      { id: '1', topic: '電子紙', text: '補連結', prompt: '', status: 'open' },
      { id: '2', topic: '電子紙', text: '已處理', prompt: '', status: 'done' },
    ],
    stats: { notes: 10, unlinked: 2, orphans: 1, inbox: 3 },
  })

  it('沒有知識報告：回 empty', async () => {
    await expect(createReportSource({ reports: async () => [] })(DAY)).resolves.toEqual({ status: 'empty' })
  })

  it('取最新一期，只列還沒處理的建議', async () => {
    const source = createReportSource({ reports: async () => [
      { path: 'r/W46.md', report: report('2026-W46', '2026-11-10T08:00') },
      { path: 'r/W47.md', report: report('2026-W47', '2026-11-17T08:00') },
    ] })
    await expect(source(DAY)).resolves.toEqual({
      status: 'ok',
      data: {
        path: 'r/W47.md',
        period: '2026-W47',
        generated: '2026-11-17T08:00',
        topics: [{ name: '電子紙', level: 'organized', score: 40, prevLevel: 'contact' }],
        suggestions: ['補連結'],
        stats: { notes: 10, unlinked: 2, orphans: 1, inbox: 3 },
      },
    })
  })
})

describe('工作台摘要 adapter', () => {
  it('要決定＝等你定清單；要完成＝逾期＋今天到期、還沒做的任務', async () => {
    const source = createWorkbenchSource({
      decisions: async () => [{ key: 'collect:1', title: '加進日誌', when: '明天 10:00', at: 5 }],
      tasks: () => [
        task({ path: 'a.md', line: 1, title: '逾期', due: '2026-11-19' }),
        task({ path: 'a.md', line: 2, title: '今天', due: '2026-11-21' }),
        task({ path: 'a.md', line: 3, title: '明天', due: '2026-11-22' }),
        task({ path: 'a.md', line: 4, title: '沒日期' }),
        task({ path: 'a.md', line: 5, title: '做完了', due: '2026-11-21', done: true }),
      ],
    })
    await expect(source(DAY)).resolves.toEqual({
      status: 'ok',
      data: {
        decide: [{ key: 'collect:1', title: '加進日誌', when: '明天 10:00', at: 5 }],
        complete: [
          { path: 'a.md', line: 1, title: '逾期', due: '2026-11-19', overdue: true },
          { path: 'a.md', line: 2, title: '今天', due: '2026-11-21', overdue: false },
        ],
      },
    })
  })

  it('讀不到：回 error', async () => {
    const source = createWorkbenchSource({ decisions: async () => { throw new Error('x') }, tasks: () => [] })
    await expect(source(DAY)).resolves.toMatchObject({ status: 'error' })
  })
})

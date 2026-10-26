import { describe, expect, it } from 'vitest'
import { buildTimeline, hasOlderThan } from './timeline'

const at = (iso: string) => new Date(iso).getTime()

const base = {
  processedIds: new Set<number>([2]),
  dailyFolder: '20 Journal/21 Daily',
  dailyPattern: 'YYYYMMDD',
  excludeFolders: ['報告'],
  since: at('2026-10-01T00:00:00'),
}

describe('buildTimeline', () => {
  it('groups notes and records by day, newest first, mixed within a day', () => {
    const days = buildTimeline({
      ...base,
      notes: [
        { path: 'a/甲.md', mtime: at('2026-10-26T09:00:00') },
        { path: '乙.md', mtime: at('2026-10-25T20:00:00') },
      ],
      records: [
        { id: 1, createdAt: at('2026-10-26T10:30:00'), title: '想法', type: 'text' },
        { id: 2, createdAt: at('2026-10-26T08:00:00'), title: '舊', type: 'link' },
      ],
    })
    expect(days.map(day => day.day)).toEqual(['2026-10-26', '2026-10-25'])
    expect(days[0].items.map(item => item.key)).toEqual(['record:1', 'note:a/甲.md', 'record:2'])
    expect(days[0].items[0]).toMatchObject({ kind: 'record', processed: false })
    expect(days[0].items[2]).toMatchObject({ kind: 'record', processed: true })
    expect(days[0].items[1]).toMatchObject({ kind: 'note', title: '甲' })
  })

  it('leaves out daily notes, report notes and anything before since', () => {
    const days = buildTimeline({
      ...base,
      notes: [
        { path: '20 Journal/21 Daily/20261026.md', mtime: at('2026-10-26T09:00:00') },
        { path: '報告/2026-W44 知識報告.md', mtime: at('2026-10-26T09:00:00') },
        { path: '舊.md', mtime: at('2026-09-01T09:00:00') },
        { path: '沒有時間.md', mtime: 0 },
      ],
      records: [{ id: 3, createdAt: at('2026-09-30T23:59:00'), title: 'x', type: 'text' }],
    })
    expect(days).toEqual([])
  })
})

describe('hasOlderThan', () => {
  it('reports whether anything predates the window', () => {
    const since = at('2026-10-01T00:00:00')
    expect(hasOlderThan({ notes: [{ path: 'a.md', mtime: at('2026-09-01T00:00:00') }], records: [] }, since)).toBe(true)
    expect(hasOlderThan({ notes: [], records: [{ id: 1, createdAt: at('2026-10-02T00:00:00'), title: '', type: 'text' }] }, since)).toBe(false)
  })
})

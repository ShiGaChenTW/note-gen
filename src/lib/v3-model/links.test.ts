// Fork（almanac ALMNC-54.1）：資料源 ↔ 筆記／行動雙向查詢（AC4）。
import { describe, expect, it } from 'vitest'
import { noteLinkDrift, outputsOfSource, sourceOutputFromRow, sourcesOfAction, sourcesOfNote, type SourceOutput } from './links'

const links: SourceOutput[] = [
  { sourceId: 's1', targetType: 'note', targetRef: '知識/A.md', createdAt: 1 },
  { sourceId: 's1', targetType: 'note', targetRef: '知識/B.md', createdAt: 2 },
  { sourceId: 's1', targetType: 'action', targetRef: 'task-9', createdAt: 3 },
  { sourceId: 's2', targetType: 'note', targetRef: '知識/A.md', createdAt: 4 },
  { sourceId: 's3', targetType: 'action', targetRef: 'task-9', createdAt: 5 },
]

describe('資料源 → 產出（AC4）', () => {
  it('一則資料源拆成多則筆記與行動', () => {
    expect(outputsOfSource('s1', links)).toEqual({ notes: ['知識/A.md', '知識/B.md'], actions: ['task-9'] })
  })

  it('沒有產出時回傳空清單', () => {
    expect(outputsOfSource('none', links)).toEqual({ notes: [], actions: [] })
  })
})

describe('筆記／行動 → 資料源（AC4）', () => {
  it('多則資料源合成一則筆記：連結表與 frontmatter 取聯集，frontmatter 順序在前', () => {
    expect(sourcesOfNote('知識/A.md', ['s9', 's2'], links)).toEqual(['s9', 's2', 's1'])
  })

  it('frontmatter 沒寫也查得到', () => {
    expect(sourcesOfNote('知識/B.md', [], links)).toEqual(['s1'])
  })

  it('行動查回來源', () => {
    expect(sourcesOfAction('task-9', links)).toEqual(['s1', 's3'])
  })

  it('雙向一致：從資料源找到的筆記，反查回得到同一則資料源', () => {
    for (const note of outputsOfSource('s2', links).notes) expect(sourcesOfNote(note, [], links)).toContain('s2')
  })

  it('列出 frontmatter 與連結表的落差', () => {
    expect(noteLinkDrift('知識/A.md', ['s1', 's9'], links)).toEqual({ missingLinks: ['s9'], missingInFrontmatter: ['s2'] })
  })

  it('列對應拒絕未知類型', () => {
    expect(sourceOutputFromRow({ sourceId: 'a', targetType: 'note', targetRef: 'x.md', createdAt: 1 }).targetType).toBe('note')
    expect(() => sourceOutputFromRow({ sourceId: 'a', targetType: 'event', targetRef: 'x', createdAt: 1 })).toThrow()
  })
})

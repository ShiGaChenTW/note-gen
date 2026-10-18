import { describe, expect, it } from 'vitest'
import { indexNote, indexTasks, INDEX_SCHEMA_VERSION, type IndexedNote } from './index-note'
import {
  collectTasks,
  planScan,
  restoreIndexCache,
  serializeIndexCache,
  toIndexablePath,
} from './index-core'

const DAILY = `---
created: 2026-10-17
tags: [daily]
---

# 20261017

- [ ] 寄報價單 📅 2026-10-17 ⏰ 9:30 ⏫
- [x] 繳電費 📅 2026-10-15 ✅ 2026-10-16
- [ ] 週報 🔁 every week when done 📅 2026-10-20 priority:: low
- 不是任務

\`\`\`md
- [ ] 程式碼區塊裡的不是任務
\`\`\`
`

describe('indexTasks', () => {
  it('extracts tasks with due, time, priority and recurrence', () => {
    const tasks = indexNote('20 Journal/21 Daily/20261017.md', DAILY, 1).tasks
    expect(tasks.map(t => [t.line, t.done, t.title, t.due, t.time, t.priority, t.recurrence])).toEqual([
      [7, false, '寄報價單', '2026-10-17', '09:30', 'high', ''],
      [8, true, '繳電費', '2026-10-15', '', 'mid', ''],
      [9, false, '週報', '2026-10-20', '', 'low', 'every week when done'],
    ])
  })

  it('reports line numbers of the whole file, including frontmatter', () => {
    const tasks = indexNote('a.md', DAILY, 1).tasks
    const lines = DAILY.split('\n')
    for (const task of tasks) expect(lines[task.line]).toBe(task.raw)
  })

  it('ignores tasks inside fenced code blocks of any length', () => {
    expect(indexTasks('````\n```\n- [ ] no\n```\n````\n- [ ] yes').map(t => t.title)).toEqual(['yes'])
  })

  it('rejects impossible times', () => {
    expect(indexTasks('- [ ] a ⏰ 25:00')[0].time).toBe('')
  })

  it('handles CRLF', () => {
    const tasks = indexNote('a.md', '---\r\na: 1\r\n---\r\n- [ ] x 📅 2026-01-02\r\n', 1).tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0].line).toBe(3)
    expect(tasks[0].raw).toBe('- [ ] x 📅 2026-01-02')
  })
})

describe('indexNote', () => {
  it('parses frontmatter into data', () => {
    expect(indexNote('a.md', DAILY, 1).frontmatter).toEqual({ created: '2026-10-17', tags: ['daily'] })
  })

  it('keeps tasks when frontmatter YAML is broken', () => {
    const note = indexNote('a.md', '---\nbad: [\n---\n- [ ] x\n', 1)
    expect(note.frontmatter).toBeNull()
    expect(note.tasks).toHaveLength(1)
  })

  it('skips tasks under NOT_TASK_PREFIXES but keeps frontmatter', () => {
    const note = indexNote('10 Inbox/idea.md', '---\na: 1\n---\n- [ ] x\n', 1)
    expect(note.tasks).toEqual([])
    expect(note.frontmatter).toEqual({ a: 1 })
  })

  it('reserves Phase 2 fields', () => {
    const note = indexNote('a.md', 'x', 1)
    expect([note.links, note.aliases, note.tags]).toEqual([[], [], []])
  })
})

const note = (path: string, mtime: number): IndexedNote => indexNote(path, '- [ ] t', mtime)

describe('planScan', () => {
  it('indexes new and modified files and removes missing ones', () => {
    const cached = new Map([
      ['same.md', note('same.md', 10)],
      ['changed.md', note('changed.md', 10)],
      ['gone.md', note('gone.md', 10)],
    ])
    const plan = planScan(cached, [
      { path: 'same.md', mtime: 10 },
      { path: 'changed.md', mtime: 11 },
      { path: 'new.md', mtime: 5 },
    ])
    expect(plan).toEqual({ toIndex: ['changed.md', 'new.md'], toRemove: ['gone.md'] })
  })

  it('re-reads files whose mtime is unknown', () => {
    const plan = planScan(new Map([['a.md', note('a.md', 0)]]), [{ path: 'a.md', mtime: 0 }])
    expect(plan.toIndex).toEqual(['a.md'])
  })
})

describe('index cache', () => {
  it('round-trips through JSON', () => {
    const notes = [note('a.md', 1), note('b.md', 2)]
    const json = JSON.parse(JSON.stringify(serializeIndexCache('/vault', notes, 99)))
    expect([...restoreIndexCache(json, '/vault').values()]).toEqual(notes)
  })

  it('discards a cache from another workspace, version or a broken file', () => {
    const cache = serializeIndexCache('/vault', [note('a.md', 1)], 0)
    expect(restoreIndexCache(cache, '/other').size).toBe(0)
    expect(restoreIndexCache({ ...cache, version: INDEX_SCHEMA_VERSION + 1 }, '/vault').size).toBe(0)
    expect(restoreIndexCache('nope', '/vault').size).toBe(0)
    expect(restoreIndexCache(null, '/vault').size).toBe(0)
  })
})

describe('collectTasks', () => {
  it('flattens tasks sorted by path then line', () => {
    const a = indexNote('b.md', '- [ ] b1\n- [ ] b2', 1)
    const b = indexNote('a.md', 'x\n- [ ] a1', 1)
    expect(collectTasks([a, b]).map(t => `${t.path}:${t.line}`)).toEqual(['a.md:1', 'b.md:0', 'b.md:1'])
  })
})

describe('toIndexablePath', () => {
  it.each([
    ['/vault/Notes/a.md', 'Notes/a.md'],
    ['/vault/a.MD', 'a.MD'],
    ['/vault/.obsidian/x.md', null],
    ['/vault/Notes/.hidden.md', null],
    ['/vault/img.png', null],
    ['/elsewhere/a.md', null],
    ['/vault2/a.md', null],
  ])('%s → %s', (input, expected) => {
    expect(toIndexablePath(input, '/vault/')).toBe(expected)
  })
})

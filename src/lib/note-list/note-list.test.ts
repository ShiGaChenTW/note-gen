// almanac ALMNC-54.17：V3「我的筆記」中間欄的清單組裝與相對時間。
import { beforeEach, describe, expect, it } from 'vitest'
import { useUiModeStore } from '@/lib/fork-ui'
import {
  applyNoteListChange, buildNoteList, folderName, nextNoteList, noteFolder, noteTitle, relativeTimeFormat, relativeTimeLabel,
  useNoteListStore, type NoteListSnapshot, type NoteListSource,
} from './note-list'

const NOTES = [
  { path: 'a.md', mtime: 100 },
  { path: 'work/b.md', mtime: 300 },
  { path: 'work/deep/c.md', mtime: 200 },
  { path: 'workshop/d.md', mtime: 400 },
  { path: 'work/image.png', mtime: 999 },
  { path: '.trash/e.md', mtime: 500 },
  { path: 'work/Z.MD', mtime: 300 },
]

describe('buildNoteList', () => {
  it('lists every markdown note for the vault root, newest first', () => {
    expect(buildNoteList(NOTES, '').map(item => item.path))
      .toEqual(['workshop/d.md', 'work/b.md', 'work/Z.MD', 'work/deep/c.md', 'a.md'])
  })

  it('includes subfolders but not sibling folders sharing a prefix', () => {
    expect(buildNoteList(NOTES, 'work').map(item => item.path))
      .toEqual(['work/b.md', 'work/Z.MD', 'work/deep/c.md'])
    expect(buildNoteList(NOTES, '/work/').map(item => item.path))
      .toEqual(['work/b.md', 'work/Z.MD', 'work/deep/c.md'])
  })

  it('fills title and containing folder', () => {
    expect(buildNoteList(NOTES, 'work/deep')).toEqual([
      { path: 'work/deep/c.md', title: 'c', folder: 'work/deep', mtime: 200 },
    ])
    expect(buildNoteList(NOTES, '').at(-1)).toMatchObject({ title: 'a', folder: '' })
  })

  it('returns an empty list for an unknown folder', () => {
    expect(buildNoteList(NOTES, 'nope')).toEqual([])
  })

  it('puts pinned notes on top, newest first within each group', () => {
    expect(buildNoteList(NOTES, '', ['a.md', 'work/deep/c.md']).map(item => item.path))
      .toEqual(['work/deep/c.md', 'a.md', 'workshop/d.md', 'work/b.md', 'work/Z.MD'])
  })

  it('ignores pinned notes outside the open folder', () => {
    expect(buildNoteList(NOTES, 'work', ['a.md', 'work\\deep\\c.md']).map(item => item.path))
      .toEqual(['work/deep/c.md', 'work/b.md', 'work/Z.MD'])
  })
})

describe('path helpers', () => {
  it('derives title, folder and folder name', () => {
    expect(noteTitle('x/y/Meeting notes.md')).toBe('Meeting notes')
    expect(noteFolder('x/y/z.md')).toBe('x/y')
    expect(noteFolder('z.md')).toBe('')
    expect(folderName('x/y')).toBe('y')
    expect(folderName('')).toBe('')
  })
})

describe('relativeTimeLabel', () => {
  const now = new Date(2026, 10, 22, 15, 0, 0).getTime()
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()

  it('uses now / minutes / hours / calendar days', () => {
    expect(relativeTimeLabel(now - 10_000, now, 'en')).toBe('now')
    expect(relativeTimeLabel(now - 5 * 60_000, now, 'en')).toBe('5 minutes ago')
    expect(relativeTimeLabel(at(22, 9), now, 'en')).toBe('6 hours ago')
    expect(relativeTimeLabel(at(21, 23, 30), now, 'en')).toBe('yesterday')
    expect(relativeTimeLabel(at(19, 12), now, 'en')).toBe('3 days ago')
  })

  it('falls back to a date after a week and blank when unknown', () => {
    expect(relativeTimeLabel(at(1, 12), now, 'en')).toBe('Nov 1')
    expect(relativeTimeLabel(new Date(2025, 0, 5).getTime(), now, 'en')).toBe('Jan 5, 2025')
    expect(relativeTimeLabel(0, now, 'en')).toBe('')
  })
})

describe('useNoteListStore', () => {
  beforeEach(() => useNoteListStore.setState({ visible: false, folder: '' }))

  it('opens only in v3', () => {
    useUiModeStore.setState({ mode: 'classic' })
    useNoteListStore.getState().show('work')
    expect(useNoteListStore.getState().visible).toBe(false)
    useUiModeStore.setState({ mode: 'v3' })
    useNoteListStore.getState().show('work/')
    expect(useNoteListStore.getState()).toMatchObject({ visible: true, folder: 'work' })
    useNoteListStore.getState().hide()
    expect(useNoteListStore.getState().visible).toBe(false)
  })
})

// ALMNC-56.3 P03：自動存檔只更新變動的那一則，不重排整份清單。
describe('applyNoteListChange', () => {
  const base = buildNoteList(NOTES, '')

  it('moves the saved note to its new place and keeps every other row object', () => {
    const next = applyNoteListChange(base, { upserted: [{ path: 'a.md', mtime: 1000 }], removed: [] }, '')
    expect(next.map(item => item.path)).toEqual(['a.md', 'workshop/d.md', 'work/b.md', 'work/Z.MD', 'work/deep/c.md'])
    expect(next).toEqual(buildNoteList(NOTES.map(note => note.path === 'a.md' ? { ...note, mtime: 1000 } : note), ''))
    for (const item of next.filter(item => item.path !== 'a.md')) {
      expect(base).toContain(item)
    }
  })

  it('keeps pinned notes first: a saved unpinned note goes to the top of the rest, a saved pinned one to the top of the pinned group', () => {
    const pinned = ['a.md', 'work/deep/c.md']
    const start = buildNoteList(NOTES, '', pinned)
    const savedRest = applyNoteListChange(start, { upserted: [{ path: 'work/b.md', mtime: 2000 }], removed: [] }, '', pinned)
    expect(savedRest.map(item => item.path)).toEqual(['work/deep/c.md', 'a.md', 'work/b.md', 'workshop/d.md', 'work/Z.MD'])
    const savedPinned = applyNoteListChange(start, { upserted: [{ path: 'a.md', mtime: 2000 }], removed: [] }, '', pinned)
    expect(savedPinned.map(item => item.path)).toEqual(['a.md', 'work/deep/c.md', 'workshop/d.md', 'work/b.md', 'work/Z.MD'])
  })

  it('adds new notes, drops removed ones and ignores notes outside the folder', () => {
    const work = buildNoteList(NOTES, 'work')
    expect(applyNoteListChange(work, { upserted: [{ path: 'a.md', mtime: 9999 }, { path: 'work/x.png', mtime: 9999 }], removed: ['zzz.md'] }, 'work')).toBe(work)
    const next = applyNoteListChange(work, { upserted: [{ path: 'work/new.md', mtime: 250 }], removed: ['work/b.md'] }, 'work')
    expect(next.map(item => item.path)).toEqual(['work/Z.MD', 'work/new.md', 'work/deep/c.md'])
  })

  it('returns the same array when the saved note did not move', () => {
    expect(applyNoteListChange(base, { upserted: [{ path: 'work/b.md', mtime: 300 }], removed: [] }, '')).toBe(base)
  })
})

describe('nextNoteList', () => {
  /** values() 會丟錯：證明增量更新不會掃整個 vault。 */
  function noScan(notes: NoteListSource[]) {
    const map = new Map(notes.map(note => [note.path, note]))
    return { get: (path: string) => map.get(path), values: () => { throw new Error('scanned the whole vault') } }
  }

  it('applies only the logged changes since the last snapshot, without scanning the vault', () => {
    const first = nextNoteList(null, { notes: new Map(NOTES.map(note => [note.path, note])), revision: 1, changeLog: [], folder: '', pinned: [] })
    const saved = NOTES.map(note => note.path === 'work/deep/c.md' ? { ...note, mtime: 5000 } : note)
    const second = nextNoteList(first, {
      notes: noScan(saved), revision: 2, changeLog: [{ revision: 2, upserted: ['work/deep/c.md'], removed: [] }], folder: '', pinned: [],
    })
    expect(second.items).toEqual(buildNoteList(saved, ''))
    expect(second.items[1]).toBe(first.items[0])
  })

  it('reuses the snapshot when nothing changed and rebuilds when the folder, pins or log continuity change', () => {
    const notes = new Map(NOTES.map(note => [note.path, note]))
    const first: NoteListSnapshot = nextNoteList(null, { notes, revision: 3, changeLog: [], folder: '', pinned: [] })
    expect(nextNoteList(first, { notes, revision: 3, changeLog: [], folder: '', pinned: [] })).toBe(first)
    expect(nextNoteList(first, { notes, revision: 3, changeLog: [], folder: 'work', pinned: [] }).items.map(item => item.path))
      .toEqual(['work/b.md', 'work/Z.MD', 'work/deep/c.md'])
    expect(nextNoteList(first, { notes, revision: 3, changeLog: [], folder: '', pinned: ['a.md'] }).items[0].path).toBe('a.md')
    // replaceAll（重新掃描）不寫 changeLog：revision 跳號就整份重建
    const rebuilt = nextNoteList(first, { notes, revision: 5, changeLog: [{ revision: 5, upserted: ['a.md'], removed: [] }], folder: '', pinned: [] })
    expect(rebuilt.items).toEqual(first.items)
    expect(rebuilt.items[0]).not.toBe(first.items[0])
  })
})

describe('relativeTimeFormat', () => {
  it('creates one Intl.RelativeTimeFormat per locale, not one per row', () => {
    const Original = Intl.RelativeTimeFormat
    const intl = Intl as { RelativeTimeFormat: typeof Intl.RelativeTimeFormat }
    let created = 0
    intl.RelativeTimeFormat = class extends Original {
      constructor(...args: ConstructorParameters<typeof Original>) {
        super(...args)
        created++
      }
    }
    try {
      const now = Date.now()
      for (let index = 0; index < 50; index++) relativeTimeLabel(now - index * 60_000, now, 'de')
      expect(created).toBe(1)
      expect(relativeTimeFormat('de')).toBe(relativeTimeFormat('de'))
    } finally {
      intl.RelativeTimeFormat = Original
    }
  })
})

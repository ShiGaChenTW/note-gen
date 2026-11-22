// almanac ALMNC-54.17：V3「我的筆記」中間欄的清單組裝與相對時間。
import { beforeEach, describe, expect, it } from 'vitest'
import { useUiModeStore } from '@/lib/fork-ui'
import { buildNoteList, folderName, noteFolder, noteTitle, relativeTimeLabel, useNoteListStore } from './note-list'

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

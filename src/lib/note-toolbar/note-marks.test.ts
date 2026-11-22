// almanac：V3 筆記工具列「置頂」「收藏」的路徑集合操作與置頂排序。
import { describe, expect, it } from 'vitest'
import {
  hasMarkedPath,
  moveMarkedPaths,
  normalizeNotePath,
  noteMarksWorkspaceKey,
  removeMarkedPaths,
  sortPinnedFirst,
  toggleMarkedPath,
} from './note-marks'

describe('normalizeNotePath', () => {
  it('uses forward slashes without leading or trailing slashes', () => {
    expect(normalizeNotePath('\\work\\a.md')).toBe('work/a.md')
    expect(normalizeNotePath('/work/a.md/')).toBe('work/a.md')
    expect(normalizeNotePath('  a.md ')).toBe('a.md')
  })
})

describe('noteMarksWorkspaceKey', () => {
  it('keys the default workspace and normalizes custom paths', () => {
    expect(noteMarksWorkspaceKey('')).toBe('__default__')
    expect(noteMarksWorkspaceKey('  ')).toBe('__default__')
    expect(noteMarksWorkspaceKey('C:\\Vault\\')).toBe('C:/Vault')
    expect(noteMarksWorkspaceKey('/Users/me/vault/')).toBe('/Users/me/vault')
  })
})

describe('toggleMarkedPath / hasMarkedPath', () => {
  it('adds new paths to the front and removes existing ones', () => {
    const once = toggleMarkedPath(['b.md'], 'a.md')
    expect(once).toEqual(['a.md', 'b.md'])
    expect(hasMarkedPath(once, 'a.md')).toBe(true)
    expect(toggleMarkedPath(once, 'a.md')).toEqual(['b.md'])
  })

  it('matches paths regardless of slash style', () => {
    const list = toggleMarkedPath([], 'work\\a.md')
    expect(list).toEqual(['work/a.md'])
    expect(hasMarkedPath(list, '/work/a.md')).toBe(true)
    expect(toggleMarkedPath(list, '/work/a.md')).toEqual([])
  })

  it('ignores empty paths and does not mutate the input', () => {
    const list = ['a.md']
    expect(toggleMarkedPath(list, '  ')).toEqual(['a.md'])
    expect(hasMarkedPath(list, '')).toBe(false)
    toggleMarkedPath(list, 'b.md')
    expect(list).toEqual(['a.md'])
  })
})

describe('moveMarkedPaths', () => {
  it('follows a renamed note', () => {
    expect(moveMarkedPaths(['a.md', 'b.md'], 'a.md', 'work/a2.md')).toEqual(['work/a2.md', 'b.md'])
  })

  it('moves notes inside a renamed folder but not sibling folders sharing a prefix', () => {
    expect(moveMarkedPaths(['work/a.md', 'work/deep/b.md', 'workshop/c.md'], 'work', 'jobs'))
      .toEqual(['jobs/a.md', 'jobs/deep/b.md', 'workshop/c.md'])
  })

  it('drops duplicates created by the move', () => {
    expect(moveMarkedPaths(['a.md', 'b.md'], 'a.md', 'b.md')).toEqual(['b.md'])
  })
})

describe('removeMarkedPaths', () => {
  it('removes a deleted note', () => {
    expect(removeMarkedPaths(['a.md', 'work/a.md'], 'a.md', false)).toEqual(['work/a.md'])
  })

  it('removes everything inside a deleted folder', () => {
    expect(removeMarkedPaths(['work/a.md', 'work/deep/b.md', 'workshop/c.md'], 'work', true))
      .toEqual(['workshop/c.md'])
  })

  it('keeps notes that only share a name prefix with a deleted file', () => {
    expect(removeMarkedPaths(['work/a.md'], 'work', false)).toEqual(['work/a.md'])
  })
})

describe('sortPinnedFirst', () => {
  const items = [{ path: 'c.md' }, { path: 'work/b.md' }, { path: 'a.md' }, { path: 'd.md' }]

  it('moves pinned items to the top and keeps both groups in their original order', () => {
    expect(sortPinnedFirst(items, ['a.md', 'work/b.md']).map(item => item.path))
      .toEqual(['work/b.md', 'a.md', 'c.md', 'd.md'])
  })

  it('returns a copy in the same order when nothing is pinned', () => {
    const sorted = sortPinnedFirst(items, [])
    expect(sorted).toEqual(items)
    expect(sorted).not.toBe(items)
  })

  it('ignores pinned paths that are not in the list', () => {
    expect(sortPinnedFirst(items, ['gone.md']).map(item => item.path)).toEqual(['c.md', 'work/b.md', 'a.md', 'd.md'])
  })
})

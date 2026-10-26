import { describe, expect, it } from 'vitest'
import {
  buildRestoreCommitSummary,
  buildVersionDisplayLabel,
  defaultShowAutoSnapshots,
  filterVersionLogEntries,
  resolveDiffPair,
  RESTORE_COMMIT_SUMMARY_PREFIX,
  toggleVersionSelection,
} from './version-history'
import type { GitVersionLogEntry } from './types'

function entry(overrides: Partial<GitVersionLogEntry>): GitVersionLogEntry {
  return {
    id: 'id',
    shortId: 'short',
    summary: 'summary',
    kind: 'prompt-version',
    authorName: 'NoteGen',
    timeSeconds: 0,
    ...overrides,
  }
}

describe('git-versions/version-history', () => {
  describe('filterVersionLogEntries', () => {
    it('keeps only prompt-version entries by default', () => {
      const entries = [
        entry({ id: 'a', kind: 'prompt-version' }),
        entry({ id: 'b', kind: 'auto-snapshot' }),
        entry({ id: 'c', kind: null }),
      ]
      expect(filterVersionLogEntries(entries, { showAutoSnapshots: false }).map(e => e.id))
        .toEqual(['a'])
    })

    it('returns every entry unchanged when auto snapshots are shown', () => {
      const entries = [
        entry({ id: 'a', kind: 'prompt-version' }),
        entry({ id: 'b', kind: 'auto-snapshot' }),
        entry({ id: 'c', kind: null }),
      ]
      expect(filterVersionLogEntries(entries, { showAutoSnapshots: true })).toEqual(entries)
    })
  })

  describe('toggleVersionSelection', () => {
    it('adds an id when fewer than two are selected', () => {
      expect(toggleVersionSelection([], 'a')).toEqual(['a'])
      expect(toggleVersionSelection(['a'], 'b')).toEqual(['a', 'b'])
    })

    it('deselects an id that is already selected', () => {
      expect(toggleVersionSelection(['a', 'b'], 'a')).toEqual(['b'])
    })

    it('drops the oldest selection and keeps the newest two when a third id is picked', () => {
      expect(toggleVersionSelection(['a', 'b'], 'c')).toEqual(['b', 'c'])
    })
  })

  describe('resolveDiffPair', () => {
    const entries = [
      entry({ id: 'newest' }),
      entry({ id: 'middle' }),
      entry({ id: 'oldest' }),
    ]

    it('returns null when fewer than two ids are selected', () => {
      expect(resolveDiffPair([], entries)).toBeNull()
      expect(resolveDiffPair(['newest'], entries)).toBeNull()
    })

    it('returns [older, newer] regardless of click order', () => {
      expect(resolveDiffPair(['newest', 'oldest'], entries)).toEqual([entries[2], entries[0]])
      expect(resolveDiffPair(['oldest', 'newest'], entries)).toEqual([entries[2], entries[0]])
    })

    it('returns null when a selected id is no longer in the list', () => {
      expect(resolveDiffPair(['newest', 'gone'], entries)).toBeNull()
    })
  })

  describe('buildRestoreCommitSummary', () => {
    it('includes the short id and original summary', () => {
      expect(buildRestoreCommitSummary({ shortId: 'ab12345', summary: '修了錯字' }))
        .toBe(`${RESTORE_COMMIT_SUMMARY_PREFIX} ab12345 修了錯字`)
    })

    it('falls back to the short id alone when there is no summary', () => {
      expect(buildRestoreCommitSummary({ shortId: 'ab12345', summary: '' }))
        .toBe(`${RESTORE_COMMIT_SUMMARY_PREFIX} ab12345`)
    })
  })

  describe('buildVersionDisplayLabel', () => {
    it('combines the summary and short id', () => {
      expect(buildVersionDisplayLabel({ shortId: 'ab12345', summary: '修了錯字' }))
        .toBe('修了錯字 (ab12345)')
    })

    it('falls back to the short id alone when there is no summary', () => {
      expect(buildVersionDisplayLabel({ shortId: 'ab12345', summary: '' })).toBe('ab12345')
    })
  })
})

describe('defaultShowAutoSnapshots', () => {
  it('shows auto snapshots when the note has no prompt versions', () => {
    expect(defaultShowAutoSnapshots([entry({ kind: 'auto-snapshot' })])).toBe(true)
    expect(defaultShowAutoSnapshots([])).toBe(true)
  })

  it('hides auto snapshots by default once a prompt version exists', () => {
    expect(defaultShowAutoSnapshots([entry({ kind: 'auto-snapshot' }), entry({ kind: 'prompt-version' })])).toBe(false)
  })
})

// Fork（almanac ALMNC-69.9）：活動紀錄的對應（Scott 直接做的每筆一筆、帶 op_id；復原記 undone）與快照轉操作。
import { describe, expect, it } from 'vitest'
import { validateActivityEntry } from '@/lib/agent-memory/activity'
import { snapshotInputs } from './refs'
import { opActivityEntry, shouldLogEach, undoneActivityEntry } from './runtime'
import type { OpRecord } from './types'

const record = (over: Partial<OpRecord> = {}): OpRecord => ({
  id: 'op-1', at: 1, seq: 1, actor: 'scott', kind: 'moc.entry.add',
  payload: { kind: 'moc.entry.add', noteTitle: '新筆記', notePath: '10 知識/新筆記.md', mocName: '時間管理', mocPath: '20 領域/時間管理.md' },
  inverse: { kind: 'moc.entry.remove', noteTitle: '新筆記', notePath: '10 知識/新筆記.md', mocName: '時間管理', mocPath: '20 領域/時間管理.md' },
  baseVersions: {}, undoneAt: null, ...over,
})

describe('activity entries for ops', () => {
  it("logs Scott's direct ops one by one with op_id and a valid format", () => {
    const entry = opActivityEntry(record())!
    expect(entry).toEqual({
      actorId: 'scott', actorRole: 'scott', action: 'linked', targetLink: `note:${encodeURI('20 領域/時間管理.md')}`,
      source: { kind: 'proposal', ref: 'op:op-1' }, note: '新筆記 › 時間管理', opId: 'op-1',
    })
    expect(validateActivityEntry(entry).ok).toBe(true)
    expect(opActivityEntry(record({ actor: 'system' }))).toBeNull()
    expect(opActivityEntry(record({ actor: 'expert', actorId: 'ivy', proposalId: 'collect:1:1' }))).toMatchObject({ actorId: 'ivy', actorRole: 'expert', source: { ref: 'collect:1:1' } })
  })

  it('an undo is a new undone entry pointing at the first undone op', () => {
    const entry = undoneActivityEntry([record(), record({ id: 'op-2' })])!
    expect(entry).toMatchObject({ actorRole: 'scott', action: 'undone', opId: 'op-1', note: '新筆記 › 時間管理 +1' })
    expect(validateActivityEntry(entry).ok).toBe(true)
  })

  it('logs each op only when there is no proposal (the accepted entry covers proposals)', () => {
    expect(shouldLogEach({ actor: 'scott' })).toBe(true)
    expect(shouldLogEach({ actor: 'commander', proposalId: 'collect:1:1' })).toBe(false)
    expect(shouldLogEach({ actor: 'system' })).toBe(false)
    expect(shouldLogEach({ actor: 'commander', proposalId: 'link:1', logActivity: true })).toBe(true)
  })
})

describe('snapshotInputs', () => {
  it('turns before/after snapshots into create, delete and edit ops with the N id', () => {
    const note = '---\nid: N-20261123-090000-AAAA\n---\nx\n'
    expect(snapshotInputs([
      { path: 'a.md', before: null, after: note },
      { path: 'b.md', before: 'old', after: null },
      { path: 'c.md', before: 'x', after: 'y' },
      { path: 'd.md', before: 'same', after: 'same' },
    ]).map(input => input.spec)).toEqual([
      { kind: 'note.create', noteId: 'N-20261123-090000-AAAA', path: 'a.md', title: 'a', content: note },
      { kind: 'note.delete', path: 'b.md', title: 'b', content: 'old' },
      { kind: 'note.edit', path: 'c.md', title: 'c', before: 'x', after: 'y' },
    ])
  })
})

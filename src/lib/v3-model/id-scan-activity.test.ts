// Fork（almanac ALMNC-71）：掃描修復 → 系統修復活動紀錄。
import { describe, expect, it } from 'vitest'
import { validateActivityEntry } from '@/lib/agent-memory/activity'
import { parseRepairRef, repairActivityEntries, repairRef } from './id-scan-activity'
import type { ScanAction } from './id-scan'

const ACTIONS: ScanAction[] = [
  { type: 'assign', path: '知識/新筆記.md', id: 'N-20261124-0930-ab12', kind: 'N' },
  { type: 'assign', path: '領域/寫作.md', id: 'C-20261124-0930-cd34', kind: 'C', heading: '尚未分章' },
  { type: 'renumber', path: '知識/新筆記 1.md', oldId: 'N-20261101-0900-aaaa', id: 'N-20261124-0931-bbbb', keptPath: '知識/新筆記.md' },
  { type: 'restore', path: '知識/舊筆記.md', id: 'N-20261001-0800-cccc' },
  { type: 'rename', id: 'N-20261001-0800-dddd', from: '知識/甲.md', to: '知識/乙.md' },
  { type: 'relink', path: '日誌/2026-11-24.md', count: 3 },
  { type: 'clock', reason: 'behind' },
  { type: 'clock', reason: 'future', id: 'N-20991231-2359-eeee', path: '知識/未來.md' },
  { type: 'clock', reason: 'before-source', id: 'N-20261001-0800-ffff', path: '知識/讀書.md', sourceId: 'S-20261002-0800-gggg' },
  { type: 'held', paths: Array.from({ length: 21 }, (_, index) => `舊/筆記${String(index).padStart(2, '0')}.md`) },
]

describe('ALMNC-71 系統修復紀錄', () => {
  it('writes one valid system entry per repair, with file, kind and details', () => {
    const { entries } = repairActivityEntries(ACTIONS)
    expect(entries).toHaveLength(ACTIONS.length)
    for (const entry of entries) {
      expect(validateActivityEntry(entry)).toMatchObject({ ok: true })
      expect(entry).toMatchObject({ actorId: 'system', actorRole: 'system', action: 'repaired', source: { kind: 'system' } })
    }
    const view = entries.map(entry => ({ target: entry.targetLink, repair: parseRepairRef(entry.source.ref), note: entry.note }))
    expect(view.slice(0, 6)).toEqual([
      { target: `note:${encodeURI('知識/新筆記.md')}`, repair: { kind: 'assign', values: { kind: 'N' } }, note: 'N-20261124-0930-ab12' },
      { target: `note:${encodeURI('領域/寫作.md')}`, repair: { kind: 'assign', values: { kind: 'C' } }, note: 'C-20261124-0930-cd34 · 尚未分章' },
      { target: `note:${encodeURI('知識/新筆記 1.md')}`, repair: { kind: 'renumber', values: { kept: '新筆記' } }, note: 'N-20261101-0900-aaaa → N-20261124-0931-bbbb' },
      { target: `note:${encodeURI('知識/舊筆記.md')}`, repair: { kind: 'restore', values: {} }, note: 'N-20261001-0800-cccc' },
      { target: `note:${encodeURI('知識/乙.md')}`, repair: { kind: 'rename', values: { from: '知識/甲.md' } }, note: 'N-20261001-0800-dddd' },
      { target: `note:${encodeURI('日誌/2026-11-24.md')}`, repair: { kind: 'relink', values: { links: '3' } }, note: '→ 乙' },
    ])
    expect(view[6]).toEqual({ target: 'system:clock', repair: { kind: 'clock', values: { reason: 'behind' } }, note: '' })
    expect(view[7]).toMatchObject({ target: `note:${encodeURI('知識/未來.md')}`, note: 'N-20991231-2359-eeee' })
    expect(view[8]).toMatchObject({ repair: { kind: 'clock', values: { reason: 'before-source' } }, note: 'N-20261001-0800-ffff < S-20261002-0800-gggg' })
    expect(view[9].repair).toEqual({ kind: 'held', values: { count: '21' } })
    expect(view[9].target).toBe(`note:${encodeURI('舊/筆記00.md')}`)
    expect([...view[9].note!].length).toBe(60)
    expect(view[9].note!.endsWith('…')).toBe(true)
  })

  it('logs clock and bulk reminders only once per app session', () => {
    const first = repairActivityEntries(ACTIONS)
    expect(first.onceKeys).toHaveLength(4)
    const again = repairActivityEntries(ACTIONS, new Set(first.onceKeys))
    expect(again.entries.map(entry => parseRepairRef(entry.source.ref)?.kind)).toEqual(['assign', 'assign', 'renumber', 'restore', 'rename', 'relink'])
    expect(again.onceKeys).toEqual([])
    // 同一次掃描裡重複的提醒也只記一次
    expect(repairActivityEntries([{ type: 'clock', reason: 'behind' }, { type: 'clock', reason: 'behind' }]).entries).toHaveLength(1)
  })

  it('round-trips refs and ignores non-repair refs', () => {
    expect(parseRepairRef(repairRef('rename', { from: 'a&b=c?.md' }))).toEqual({ kind: 'rename', values: { from: 'a&b=c?.md' } })
    expect(parseRepairRef('id-scan:held')).toEqual({ kind: 'held', values: {} })
    expect(parseRepairRef('op:123')).toBeNull()
    expect(parseRepairRef('id-scan:unknown')).toBeNull()
    expect(repairActivityEntries([]).entries).toEqual([])
  })

  it('system entries must pair the system actor, repaired and a system source', () => {
    const [entry] = repairActivityEntries([ACTIONS[0]]).entries
    expect(validateActivityEntry({ ...entry, action: 'created' })).toEqual({ ok: false, error: 'SYSTEM_ENTRY_INVALID' })
    expect(validateActivityEntry({ ...entry, source: { kind: 'conversation', ref: 'c1' } })).toEqual({ ok: false, error: 'SYSTEM_ENTRY_INVALID' })
    expect(validateActivityEntry({ ...entry, actorId: 'mia' })).toEqual({ ok: false, error: 'ACTOR_ROLE_INVALID' })
    expect(validateActivityEntry({ actorId: 'mia', actorRole: 'commander', action: 'repaired', targetLink: 'note:a', source: { kind: 'conversation', ref: 'c' } }))
      .toEqual({ ok: false, error: 'SYSTEM_ENTRY_INVALID' })
    expect(validateActivityEntry({ actorId: 'system', actorRole: 'commander', action: 'created', targetLink: 'note:a', source: { kind: 'conversation', ref: 'c' } }))
      .toEqual({ ok: false, error: 'ACTOR_ROLE_INVALID' })
  })
})

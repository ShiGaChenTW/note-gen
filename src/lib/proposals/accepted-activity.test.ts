// Fork（almanac ALMNC-54.21 AC#3）：接受一則提案時，活動紀錄留下一筆——誰提的、改了什麼、來源對話。
import { describe, expect, it } from 'vitest'
import { validateActivityEntry } from '@/lib/agent-memory/activity'
import type { DecideItem } from '@/lib/decide/project'
import { acceptedActivityEntry, acceptedFromDecide, acceptedFromProposal, acceptedTargetLink } from './accepted-activity'

const ROSTER = [
  { id: 'c-1', role: 'commander' as const },
  { id: 's-1', role: 'secretary' as const },
]

function item(over: Partial<DecideItem> = {}): DecideItem {
  return {
    key: 'collect:b1:p1', source: 'collect', kind: 'create', title: '知識/工業工程/OEE.md', origin: 'Mia · 指揮官（對話）', summary: '新增 OEE 的定義筆記', when: '', at: 0,
    preview: { type: 'file', path: '知識/工業工程/OEE.md', diff: null }, duplicates: [], ref: { source: 'collect', itemId: 'b1', proposalId: 'p1' }, status: 'wait',
    drafter: { role: 'commander', agentId: 'c-1' }, conversationId: 7, ...over,
  }
}

describe('accepted proposal → activity entry', () => {
  it('records who proposed, what changed and the source conversation in the fixed format', () => {
    const entry = acceptedActivityEntry(acceptedFromDecide(item(), '知識/工業工程/OEE.md'), ROSTER)
    expect(entry).toEqual({
      actorId: 'c-1', actorRole: 'commander', action: 'accepted',
      targetLink: 'note:%E7%9F%A5%E8%AD%98/%E5%B7%A5%E6%A5%AD%E5%B7%A5%E7%A8%8B/OEE.md',
      source: { kind: 'conversation', ref: '7' }, note: '新增 OEE 的定義筆記',
    })
    expect(validateActivityEntry(entry).ok).toBe(true)
  })

  it('a secretary task without a conversation links the journal and points the source at the proposal', () => {
    const entry = acceptedActivityEntry(acceptedFromProposal('collect:b2:p9', {
      kind: 'task', title: '寄報價單給 B 公司', drafter: { role: 'secretary' },
    }, '20 Journal/2026-11-23.md'), ROSTER)
    expect(entry).toMatchObject({ actorId: 's-1', actorRole: 'secretary', targetLink: 'task:20%20Journal/2026-11-23.md', source: { kind: 'proposal', ref: 'collect:b2:p9' }, note: '寄報價單給 B 公司' })
    expect(validateActivityEntry(entry).ok).toBe(true)
  })

  it('falls back to the commander and to a proposal link when the drafter or the written file is unknown; long text is clipped to 60', () => {
    const entry = acceptedActivityEntry(acceptedFromDecide(item({ key: 'job:j1:s1', kind: 'job', summary: '', title: '週'.repeat(80), drafter: undefined, conversationId: undefined })), [])
    expect(entry).toMatchObject({ actorId: 'commander', actorRole: 'commander', targetLink: 'proposal:job%3Aj1%3As1', source: { kind: 'proposal', ref: 'job:j1:s1' } })
    expect(Array.from(entry.note!)).toHaveLength(60)
    expect(validateActivityEntry(entry).ok).toBe(true)
  })

  it('uses the file change summary for a commander file change accepted from a chat card', () => {
    const accepted = acceptedFromProposal('collect:b1:p1', {
      kind: 'note', title: '知識/a.md', drafter: { role: 'commander', agentId: 'c-1' }, conversationId: 3,
      change: { toolName: 'note_update_file', args: {}, kind: 'update', path: '知識/a.md', baseContent: '', summary: '補上交期基準' },
    }, '知識/a.md')
    expect(accepted).toMatchObject({ kind: 'update', what: '補上交期基準', conversationId: 3 })
    expect(acceptedTargetLink(accepted)).toBe('note:%E7%9F%A5%E8%AD%98/a.md')
  })
})

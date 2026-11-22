// Fork（almanac ALMNC-54.7）：Scott 親口交代的任務和行程直接寫進今日日誌、回一行確認、可以復原；
// 交代得不夠具體就先問；不是 Scott 說的（秘書自己的建議）走提案。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Proposal } from '@/lib/collect/types'
import type { DirectEdit, ScheduleDeps } from './schedule-direct'

const files = new Map<string, string>()
const DAILY = '20 Journal/21 Daily/20261119.md'
const BEFORE = '# 今天\n\n## 捕捉軌\n\n- [ ] 既有任務\n'

vi.mock('@/lib/daily/note-io', () => ({
  noteExists: async (path: string) => files.has(path),
  readNote: async (path: string) => files.get(path) ?? null,
  writeNote: async (path: string, content: string) => { files.set(path, content) },
  revealInFileTree: async () => undefined,
}))
vi.mock('@/lib/daily/open-daily-note', () => ({
  ensureDailyNote: async () => {
    if (!files.has(DAILY)) files.set(DAILY, BEFORE)
    return { path: DAILY }
  },
}))

const { acceptProposal, undoAccepted } = await import('@/lib/collect/write')
const { buildScheduleTools, describeDirectEdit, isVagueSchedule, looksLikeScheduleInstruction, quotedFromScott, suggestSlots } = await import('./schedule-direct')

const NOW = new Date(2026, 10, 19, 9, 0) // 週四
const context = { runId: 'test', context: { userInput: '' } }

function setup(messages: string[], answered = false) {
  const edits: DirectEdit[] = []
  const proposed: Proposal[] = []
  let choice = answered
  const deps: ScheduleDeps = {
    now: () => NOW,
    scottMessages: () => messages,
    // 實際的任務／時段寫入（收集提案同一套），復原也是同一套
    write: async proposal => {
      const result = await acceptProposal(proposal, { noteFolder: '10 Inbox', now: NOW })
      return { proposal, path: result.path, undo: () => undoAccepted(result) }
    },
    onDirectEdit: edit => { edits.push(edit) },
    propose: proposal => { proposed.push(proposal) },
    choiceAnswered: () => choice,
  }
  const [task, event] = buildScheduleTools(deps)
  return { task, event, edits, proposed, answer: () => { choice = true } }
}

describe('schedule instruction detection', () => {
  it('recognizes instructions but not questions about the schedule', () => {
    expect(looksLikeScheduleInstruction('幫我排明天 10:00 跟 A 開會')).toBe(true)
    expect(looksLikeScheduleInstruction('新增任務：週五前交報告')).toBe(true)
    expect(looksLikeScheduleInstruction('可以幫我加一個會議嗎？')).toBe(true)
    expect(looksLikeScheduleInstruction('Add a meeting with A tomorrow at 10')).toBe(true)
    expect(looksLikeScheduleInstruction('明天有什麼會議？')).toBe(false)
    expect(looksLikeScheduleInstruction('幫我摘要這篇')).toBe(false)
  })
  it('flags instructions that do not say exactly when', () => {
    expect(isVagueSchedule('下週找時間跟 A 開會')).toBe(true)
    expect(isVagueSchedule('下週跟 A 開會')).toBe(true)
    expect(isVagueSchedule('下週二 15:00 跟 A 開會')).toBe(false)
    expect(isVagueSchedule('明天 10:00 跟 A 開會')).toBe(false)
  })
  it('checks the quote against what Scott actually wrote', () => {
    expect(quotedFromScott('明天10:00跟A開會', ['幫我排明天 10:00 跟 A 開會'])).toBe(true)
    expect(quotedFromScott('跟 B 開會', ['幫我排明天 10:00 跟 A 開會'])).toBe(false)
    expect(quotedFromScott('', ['x'])).toBe(false)
  })
  it('suggests next-week slots for "next week"', () => {
    expect(suggestSlots('下週找時間開會', NOW).map(slot => `${slot.date} ${slot.time}`)).toEqual(['2026-11-23 10:00', '2026-11-24 14:00', '2026-11-26 10:00'])
  })
})

describe('schedule tools', () => {
  beforeEach(() => files.clear())

  it('writes an explicitly requested time block directly, confirms it in one line, and undo restores the note', async () => {
    const { event, edits, proposed } = setup(['幫我排明天 10:00 跟 A 開會'])
    const result = await event.execute({ title: '跟 A 開會', date: '2026-11-20', time: '10:00', quote: '明天 10:00 跟 A 開會' }, context)
    expect(result.ok).toBe(true)
    expect(proposed).toEqual([])
    expect(files.get(DAILY)).toContain('- [ ] 跟 A 開會 📅 2026-11-20 ⏰ 10:00')
    expect(edits).toHaveLength(1)
    expect(describeDirectEdit(edits[0].proposal)).toBe('11/20 10:00 跟 A 開會')

    expect(await edits[0].undo()).toBe(true)
    expect(files.get(DAILY)).toBe(BEFORE)
  })

  it('writes an explicitly requested task directly', async () => {
    const { task, edits } = setup(['新增任務：週五前交報告'])
    await task.execute({ title: '交報告', date: '2026-11-21', quote: '新增任務：週五前交報告' }, context)
    expect(files.get(DAILY)).toContain('- [ ] 交報告 📅 2026-11-21')
    expect(edits).toHaveLength(1)
  })

  it('asks instead of guessing when the instruction is underspecified, then applies Scott\'s choice directly', async () => {
    const { event, edits, proposed, answer } = setup(['下週找時間跟 A 開會'])
    const asked = await event.execute({ title: '跟 A 開會', date: '2026-11-24', time: '14:00', quote: '下週找時間跟 A 開會' }, context)
    expect(asked).toMatchObject({ ok: false, error: 'NEEDS_CHOICE' })
    expect(asked.message).toContain('ask_user_question')
    expect((asked.data as { options: unknown[] }).options).toHaveLength(3)
    expect(files.has(DAILY)).toBe(false)
    expect(proposed).toEqual([])

    answer() // Scott 在 ask_user_question 選了「11/24 14:00」
    const done = await event.execute({ title: '跟 A 開會', date: '2026-11-24', time: '14:00', quote: '下週找時間跟 A 開會' }, context)
    expect(done.ok).toBe(true)
    expect(files.get(DAILY)).toContain('- [ ] 跟 A 開會 📅 2026-11-24 ⏰ 14:00')
    expect(edits).toHaveLength(1)
    expect(proposed).toEqual([])
  })

  it('applies a choice Scott gave in a follow-up message', async () => {
    const { event, edits } = setup(['週二下午兩點', '下週找時間跟 A 開會'])
    const done = await event.execute({ title: '跟 A 開會', date: '2026-11-24', time: '14:00', quote: '下週找時間跟 A 開會' }, context)
    expect(done.ok).toBe(true)
    expect(edits).toHaveLength(1)
  })

  it('asks when a time block has no exact time', async () => {
    const { event, edits } = setup(['幫我排明天跟 A 開會'])
    const asked = await event.execute({ title: '跟 A 開會', date: '2026-11-20', quote: '幫我排明天跟 A 開會' }, context)
    expect(asked).toMatchObject({ ok: false, error: 'NEEDS_CHOICE' })
    expect(edits).toEqual([])
  })

  it('turns the secretary\'s own suggestion into a proposal instead of writing', async () => {
    const { task, edits, proposed } = setup(['這週好累'])
    const result = await task.execute({ title: '安排休假', date: '2026-11-21', quote: '安排休假' }, context)
    expect(result).toMatchObject({ ok: true, data: { proposed: true } })
    expect(files.has(DAILY)).toBe(false)
    expect(edits).toEqual([])
    expect(proposed).toEqual([expect.objectContaining({ kind: 'task', title: '安排休假', due: '2026-11-21', drafter: { role: 'secretary' } })])
  })
})

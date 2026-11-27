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
const { draftToProposal } = await import('./consolidate')
const { buildScheduleTools, describeDirectEdit, resolveTaskProject, isVagueSchedule, looksLikeScheduleInstruction, quotedFromScott, suggestSlots } = await import('./schedule-direct')

const NOW = new Date(2026, 10, 19, 9, 0) // 週四
const context = { runId: 'test', context: { userInput: '' } }

function setup(messages: string[], answered = false, projectOptions: { projects?: string[], conversationProject?: string } = {}) {
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
    ...(projectOptions.projects ? { projects: () => projectOptions.projects ?? [] } : {}),
    ...(projectOptions.conversationProject !== undefined ? { conversationProject: () => projectOptions.conversationProject ?? '' } : {}),
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

// Fork（almanac ALMNC-87）：秘書新增任務時掛到相關專案——Scott 提到的或對話所屬的現有專案；方式同指揮官的任務；對不到就不掛。
describe('schedule_add_task project', () => {
  beforeEach(() => files.clear())
  const PROJECTS = ['Almanac 改版', '搬家']

  it('offers an optional project parameter on schedule_add_task only', () => {
    const { task, event } = setup([])
    const schema = task.inputSchema as { properties: Record<string, { type: string }>, required: string[] }
    expect(schema.properties.project).toMatchObject({ type: 'string' })
    expect(schema.required).not.toContain('project')
    expect((event.inputSchema as { properties: Record<string, unknown> }).properties.project).toBeUndefined()
  })

  it('attaches the project Scott named, using the existing name, the same way as commander tasks', async () => {
    const { task, edits } = setup(['新增任務：週五前交 almanac 改版的報告'], false, { projects: PROJECTS })
    const result = await task.execute({ title: '交報告', date: '2026-11-21', project: 'almanac-改版', quote: '新增任務：週五前交 almanac 改版的報告' }, context)
    expect(result).toMatchObject({ ok: true, data: { direct: true, project: 'Almanac 改版' } })
    expect(edits[0].proposal).toMatchObject({ project: 'Almanac 改版', tags: ['Almanac-改版'] })
    expect(files.get(DAILY)).toContain('- [ ] 交報告 📅 2026-11-21 #Almanac-改版')

    // 與指揮官分析資料源產生的任務一致：同樣的 project 欄位與專案標籤
    const commander = draftToProposal({
      role: 'commander', kind: 'task', title: '交報告', body: '', date: '2026-11-21', tags: [], people: [], domainIds: [], project: 'Almanac 改版',
      fragment: { index: 0, kind: 'task', title: '交報告', body: '', people: [], tags: [] },
    } as unknown as Parameters<typeof draftToProposal>[0], [])
    expect({ project: edits[0].proposal.project, tags: edits[0].proposal.tags }).toEqual({ project: commander.project, tags: commander.tags })
  })

  it('defaults to the conversation\'s project when none is named', async () => {
    const { task, edits } = setup(['新增任務：明天打給房東'], false, { projects: PROJECTS, conversationProject: '搬家' })
    await task.execute({ title: '打給房東', date: '2026-11-20', quote: '新增任務：明天打給房東' }, context)
    expect(edits[0].proposal).toMatchObject({ project: '搬家', tags: ['搬家'] })
    expect(files.get(DAILY)).toContain('- [ ] 打給房東 📅 2026-11-20 #搬家')
  })

  it('also carries the project on a secretary proposal', async () => {
    const { task, proposed } = setup(['這週好累'], false, { projects: PROJECTS, conversationProject: '搬家' })
    await task.execute({ title: '整理紙箱', quote: '整理紙箱' }, context)
    expect(proposed).toEqual([expect.objectContaining({ project: '搬家', tags: ['搬家'] })])
  })

  it('does not attach a project that does not exist, and does not fall back to a guess', async () => {
    const { task, edits } = setup(['新增任務：週五前交報告'], false, { projects: PROJECTS, conversationProject: '搬家' })
    const result = await task.execute({ title: '交報告', date: '2026-11-21', project: '新創計畫', quote: '新增任務：週五前交報告' }, context)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('No existing project is named "新創計畫"')
    expect(edits[0].proposal.project).toBeUndefined()
    expect(edits[0].proposal.tags).toEqual([])
    expect(files.get(DAILY)).toContain('- [ ] 交報告 📅 2026-11-21\n')
  })

  it('attaches nothing when there is no related project', async () => {
    const { task, edits } = setup(['新增任務：週五前交報告'], false, { projects: PROJECTS, conversationProject: '' })
    await task.execute({ title: '交報告', date: '2026-11-21', quote: '新增任務：週五前交報告' }, context)
    expect(edits[0].proposal).toMatchObject({ tags: [] })
    expect(edits[0].proposal.project).toBeUndefined()

    const noProjects = setup(['新增任務：週五前交報告'], false, { conversationProject: '搬家' })
    await noProjects.task.execute({ title: '交報告', date: '2026-11-21', project: '搬家', quote: '新增任務：週五前交報告' }, context)
    expect(noProjects.edits[0].proposal.project).toBeUndefined()
  })

  it('resolveTaskProject matches existing names only', () => {
    expect(resolveTaskProject('  almanac   改版 ', PROJECTS)).toEqual({ project: 'Almanac 改版' })
    expect(resolveTaskProject('', PROJECTS, '搬家')).toEqual({ project: '搬家' })
    expect(resolveTaskProject('', PROJECTS, '已刪除的專案')).toEqual({})
    expect(resolveTaskProject('別的', PROJECTS, '搬家')).toEqual({ unmatched: '別的' })
    expect(resolveTaskProject('', [], '')).toEqual({})
  })
})

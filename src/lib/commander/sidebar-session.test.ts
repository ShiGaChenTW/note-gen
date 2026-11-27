// Fork（almanac ALMNC-54.7）：右側欄的 AI 是指揮官——用指揮官的工作指示、記憶與「本名 · 指揮官」；
// 想改的檔案在執行結束後送進工作台並掛提案卡；Scott 親口交代的行程由秘書直接寫，掛一行確認與「復原」並記活動紀錄。
import { describe, expect, it, vi } from 'vitest'
import { createTranslator } from 'next-intl'
import messages from '../../../messages/zh-TW.json'
import { agentToolRegistry } from '@/lib/agent/tool-registry'
import { ROLE_INSTRUCTIONS } from '@/lib/agents/instructions'
import { buildDeskContext, readDeskContext } from '@/lib/workbench/desk-context'
import type { AgentTool } from '@/lib/agent/types'
import type { Proposal } from '@/lib/collect/types'
import { commanderDisplayName, prepareSidebarCommanderRun, type SidebarRunDeps } from './sidebar-session'
import { SIDEBAR_ASK_RULES, SIDEBAR_COMMANDER_RULES } from './sidebar'
import { EXPERT_HANDOFF_RULE, EXPERT_HANDOFF_TOOL_NAME } from '@/lib/threads/expert-handoff'

const roles = createTranslator({ locale: 'zh-TW', messages, namespace: 'agents.roles' })
const roleLabel = (key: string, values?: Record<string, string>) => roles(key as 'commander', values)
const ROSTER = [
  { id: 'c-1', name: 'Mia', role: 'commander' as const, enabled: true },
  { id: 's-1', name: 'Leo', role: 'secretary' as const, enabled: true },
]
const context = { runId: 'test', context: { userInput: '' } }

function fakeDeps(over: Partial<SidebarRunDeps> = {}) {
  const undo = vi.fn(async () => true)
  const deps: SidebarRunDeps = {
    roster: async () => ROSTER,
    memoryPrompt: vi.fn(async () => '## Your identity (soul.md)\n- 本名：Mia'),
    readFile: async path => (path === 'a.md' ? '舊' : null),
    writeSchedule: vi.fn(async () => ({ path: '20 Journal/2026 11 19.md', undo })),
    submitProposals: vi.fn(async () => {}),
    attachCard: vi.fn(),
    attachDirectEdit: vi.fn(),
    logActivity: vi.fn(async () => {}),
    roleLabel,
    originLabel: agent => `${agent}（對話）`,
    now: () => new Date(2026, 10, 19, 9),
    ...over,
  }
  return { deps, undo }
}

function tool(run: Awaited<ReturnType<typeof prepareSidebarCommanderRun>>, name: string) {
  const found = run.transformTools(agentToolRegistry.listTools()).find(entry => entry.name === name)
  if (!found) throw new Error(`missing ${name}`)
  return found
}

describe('sidebar commander identity', () => {
  it('answers as the commander: instructions, memory and "本名 · 指揮官" in the system prompt', async () => {
    const { deps } = fakeDeps()
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: [] }, deps)
    expect(run.displayName).toBe('Mia · 指揮官')
    expect(deps.memoryPrompt).toHaveBeenCalledWith(ROSTER[0])
    expect(run.rolePrompt).toContain(ROLE_INSTRUCTIONS.commander)
    expect(run.rolePrompt).toContain('本名：Mia')
    expect(run.rolePrompt).toContain('"Mia · 指揮官"')
    expect(run.rolePrompt).toContain(SIDEBAR_COMMANDER_RULES)
  })

  it('is still the commander in Ask mode, with read-only rules', async () => {
    const { deps } = fakeDeps()
    const run = await prepareSidebarCommanderRun({ chatId: 1, scottMessages: [], readOnly: true }, deps)
    expect(run.rolePrompt).toContain(ROLE_INSTRUCTIONS.commander)
    expect(run.rolePrompt).toContain('"Mia · 指揮官"')
    expect(run.rolePrompt).toContain(SIDEBAR_ASK_RULES)
    expect(run.rolePrompt).not.toContain(SIDEBAR_COMMANDER_RULES)
  })

  it('falls back to the role name when the roster cannot be read, and still runs without memory', async () => {
    const { deps } = fakeDeps({ roster: async () => { throw new Error('no db') } })
    const run = await prepareSidebarCommanderRun({ chatId: 1, scottMessages: [] }, deps)
    expect(run.displayName).toBe('指揮官')
    expect(run.rolePrompt).toContain(ROLE_INSTRUCTIONS.commander)
    expect(commanderDisplayName(ROSTER, roleLabel)).toBe('Mia · 指揮官')
  })
})

describe('ALMNC-54.11 routed runs', () => {
  const expert = { id: 'e-1', name: 'Alex', role: 'expert' as const, domain: '工業工程', enabled: true }

  it('a routed query answers as the expert, read-only, with the expert\'s instructions and memory', async () => {
    const { deps } = fakeDeps()
    const run = await prepareSidebarCommanderRun({ chatId: 1, scottMessages: [], readOnly: true, answerAs: expert, routeNote: 'Router: query' }, deps)
    expect(run.displayName).toBe('Alex · 工業工程專家')
    expect(deps.memoryPrompt).toHaveBeenCalledWith(expert)
    expect(run.rolePrompt).toContain(ROLE_INSTRUCTIONS.expert)
    expect(run.rolePrompt).toContain(SIDEBAR_ASK_RULES.replace('as the commander', 'as the expert'))
    expect(run.rolePrompt.endsWith('Router: query')).toBe(true)
  })

  it('uses secretary memory for schedule replies and learns only on completion', async () => {
    const rememberWork = vi.fn(async () => {})
    const { deps } = fakeDeps({ rememberWork })
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: ['提前提醒我'], answerAs: ROSTER[1] }, deps)
    expect(deps.memoryPrompt).toHaveBeenCalledWith(ROSTER[1])
    await run.finish()
    expect(rememberWork).not.toHaveBeenCalled()
    await run.remember('下次會提前提醒。')
    expect(rememberWork).toHaveBeenCalledWith(ROSTER[1], expect.objectContaining({
      reference: 'conversation:7#70', request: '提前提醒我', fromScott: true,
    }))
  })

  // Fork（almanac ALMNC-91）：專家只讀回答時才有 expert_suggest_commander；AI 呼叫它（固定回應）就記下這則回答。
  it('gives a read-only expert expert_suggest_commander, which flags this answer for a handoff prompt', async () => {
    const suggestCommander = vi.fn()
    const { deps } = fakeDeps({ suggestCommander })
    const run = await prepareSidebarCommanderRun({ chatId: 42, scottMessages: ['今天匯率多少？'], readOnly: true, answerAs: expert }, deps)
    expect(run.rolePrompt).toContain(EXPERT_HANDOFF_RULE)
    const result = await tool(run, EXPERT_HANDOFF_TOOL_NAME).execute({ reason: '需要即時匯率' }, context)
    expect(result.ok).toBe(true)
    expect(suggestCommander).toHaveBeenCalledWith(42)
  })

  it('does not offer expert_suggest_commander to the commander or outside read-only expert answers', async () => {
    const { deps } = fakeDeps({ suggestCommander: vi.fn() })
    const names = async (input: Parameters<typeof prepareSidebarCommanderRun>[0]) => {
      const run = await prepareSidebarCommanderRun(input, deps)
      return { prompt: run.rolePrompt, tools: run.transformTools(agentToolRegistry.listTools()).map(entry => entry.name) }
    }
    for (const input of [
      { chatId: 1, scottMessages: [], readOnly: true },
      { chatId: 1, scottMessages: [], answerAs: expert },
      { chatId: 1, scottMessages: [] },
    ]) {
      const { prompt, tools } = await names(input)
      expect(tools).not.toContain(EXPERT_HANDOFF_TOOL_NAME)
      expect(prompt).not.toContain(EXPERT_HANDOFF_RULE)
    }
    const { deps: withoutHook } = fakeDeps()
    const run = await prepareSidebarCommanderRun({ chatId: 1, scottMessages: [], readOnly: true, answerAs: expert }, withoutHook)
    expect(run.transformTools(agentToolRegistry.listTools()).map(entry => entry.name)).not.toContain(EXPERT_HANDOFF_TOOL_NAME)
  })

  it('answerAs is ignored outside read-only runs（只讀才由專家回答）', async () => {
    const { deps } = fakeDeps()
    const run = await prepareSidebarCommanderRun({ chatId: 1, scottMessages: [], answerAs: expert }, deps)
    expect(run.displayName).toBe('Mia · 指揮官')
    expect(run.rolePrompt).toContain(SIDEBAR_COMMANDER_RULES)
  })
})

describe('sidebar commander changes', () => {
  it('sends note changes to the workbench with the conversation and shows proposal cards; nothing is written', async () => {
    const { deps } = fakeDeps()
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: ['把 a.md 改一下'] }, deps)
    await tool(run, 'propose_note_update').execute({ filePath: 'a.md', content: '新' }, context)
    expect(deps.submitProposals).not.toHaveBeenCalled()

    const proposals = await run.finish()
    expect(proposals).toHaveLength(1)
    const batch = vi.mocked(deps.submitProposals).mock.calls[0][0]
    expect(batch).toMatchObject({ origin: 'Mia · 指揮官（對話）', conversationId: 7 })
    expect(batch.proposals[0]).toMatchObject({ conversationId: 7, drafter: { role: 'commander', agentId: 'c-1' }, change: { kind: 'update', path: 'a.md', baseContent: '舊', content: '新' } })
    expect(deps.attachCard).toHaveBeenCalledWith(70, expect.objectContaining({ type: 'proposal', status: 'wait', source: { itemId: batch.id, proposalId: batch.proposals[0].id } }))
    expect(deps.writeSchedule).not.toHaveBeenCalled()
  })

  it('submits nothing when the run made no changes', async () => {
    const { deps } = fakeDeps()
    const run = await prepareSidebarCommanderRun({ chatId: 1, scottMessages: [] }, deps)
    expect(await run.finish()).toEqual([])
    expect(deps.submitProposals).not.toHaveBeenCalled()
  })

  it('lets the secretary apply Scott\'s own schedule instruction directly with a one-line confirmation, undo and an activity entry', async () => {
    const { deps, undo } = fakeDeps()
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: ['幫我排明天 10:00 跟 A 開會'] }, deps)
    const result = await tool(run, 'schedule_add_event').execute({ title: '會議', date: '2026-11-20', time: '10:00', quote: '明天 10:00 跟 A 開會' }, context)
    expect(result.ok).toBe(true)
    expect(deps.writeSchedule).toHaveBeenCalledWith(expect.objectContaining({ kind: 'event', title: '會議', due: '2026-11-20', time: '10:00' }))
    expect(deps.attachDirectEdit).toHaveBeenCalledWith(70, expect.objectContaining({ type: 'direct-edit', what: '11/20 10:00 會議', agent: 'Leo · 秘書', status: 'done' }), undo)
    expect(deps.logActivity).toHaveBeenCalledWith(expect.objectContaining({ actorId: 's-1', actorRole: 'secretary', conversationId: 7, note: '11/20 10:00 會議' }))
    expect(await run.finish()).toEqual([])
  })

  it('turns a schedule item Scott did not ask for into a secretary proposal', async () => {
    const { deps } = fakeDeps()
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: ['這週好累'] }, deps)
    await tool(run, 'schedule_add_task').execute({ title: '安排休假', quote: '安排休假' }, context)
    expect(deps.writeSchedule).not.toHaveBeenCalled()
    const [proposal] = await run.finish() as Proposal[]
    expect(proposal).toMatchObject({ kind: 'task', title: '安排休假', conversationId: 7, drafter: { role: 'secretary', agentId: 's-1' } })
  })
})

// Fork（almanac ALMNC-87）：對話所屬的專案與現有專案名單從右側欄的一次執行帶給秘書的工具與提示詞。
describe('secretary tasks and projects', () => {
  it('defaults a task Scott asked for to the conversation\'s project and tells the model the existing projects', async () => {
    const { deps } = fakeDeps()
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: ['新增任務：明天打給房東'], projects: ['搬家', 'Almanac'], conversationProject: '搬家' }, deps)
    expect(run.rolePrompt).toContain('Existing projects: "搬家", "Almanac".')
    expect(run.rolePrompt).toContain('This conversation belongs to the project "搬家"')
    await tool(run, 'schedule_add_task').execute({ title: '打給房東', date: '2026-11-20', quote: '新增任務：明天打給房東' }, context)
    expect(deps.writeSchedule).toHaveBeenCalledWith(expect.objectContaining({ kind: 'task', project: '搬家', tags: ['搬家'] }))
  })

  it('attaches nothing and says nothing about projects when none exist', async () => {
    const { deps } = fakeDeps()
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: ['新增任務：明天打給房東'] }, deps)
    expect(run.rolePrompt).not.toContain('Existing projects')
    await tool(run, 'schedule_add_task').execute({ title: '打給房東', date: '2026-11-20', project: '搬家', quote: '新增任務：明天打給房東' }, context)
    const written = vi.mocked(deps.writeSchedule).mock.calls[0][0]
    expect(written.project).toBeUndefined()
    expect(written.tags).toEqual([])
  })
})

// Fork（almanac ALMNC-54.21 AC#2）：秘書在對話裡問 Scott 的問題記到工作台「等你回話」——明確標記，不從文字猜。
describe('secretary waiting for Scott\'s reply', () => {
  function awaitingDeps() {
    const markAwaiting = vi.fn()
    const clearAwaiting = vi.fn()
    return { ...fakeDeps({ markAwaiting, clearAwaiting }), markAwaiting, clearAwaiting }
  }

  it('schedule_await_reply records the question when the turn ends, attributed to the secretary', async () => {
    const { deps, markAwaiting } = awaitingDeps()
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: ['下週找時間跟 A 開會'] }, deps)
    const result = await tool(run, 'schedule_await_reply').execute({ question: ' 跟 A 開會要排\n哪一天？ ' }, context)
    expect(result.ok).toBe(true)
    expect(markAwaiting).not.toHaveBeenCalled()
    await run.finish()
    expect(markAwaiting).toHaveBeenCalledWith({
      conversationId: 7, chatId: 70, question: '跟 A 開會要排 哪一天？', by: 'Leo · 秘書', at: new Date(2026, 10, 19, 9).getTime(), via: 'turn',
    })
    expect(SIDEBAR_COMMANDER_RULES).toContain('schedule_await_reply')
  })

  it('records nothing when the secretary did not ask, and rejects an empty question', async () => {
    const { deps, markAwaiting } = awaitingDeps()
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: [] }, deps)
    expect((await tool(run, 'schedule_await_reply').execute({ question: '  ' }, context)).ok).toBe(false)
    await run.finish()
    expect(markAwaiting).not.toHaveBeenCalled()
  })

  it('an open ask_user_question waits on the workbench until it is answered', async () => {
    const { deps, markAwaiting, clearAwaiting } = awaitingDeps()
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: [] }, deps)
    let answer: (value: Array<{ question: string, selected: string[] }>) => void = () => {}
    const pending = tool(run, 'ask_user_question').execute(
      { questions: [{ question: '要排哪一天？', options: [{ label: '週二' }, { label: '週三' }] }] },
      { ...context, requestUserQuestion: () => new Promise(resolve => { answer = resolve }) },
    )
    await vi.waitFor(() => expect(markAwaiting).toHaveBeenCalled())
    expect(markAwaiting).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 7, chatId: 70, question: '要排哪一天？', choices: ['週二', '週三'], by: 'Mia · 指揮官', via: 'live' }))
    expect(clearAwaiting).not.toHaveBeenCalled()
    answer([{ question: '要排哪一天？', selected: ['週二'] }])
    expect((await pending).ok).toBe(true)
    expect(clearAwaiting).toHaveBeenCalledWith(7, 'live')
  })

  it('does not offer schedule_await_reply without a saved conversation', async () => {
    const { deps } = awaitingDeps()
    const run = await prepareSidebarCommanderRun({ chatId: -1, scottMessages: [] }, deps)
    expect(run.transformTools(agentToolRegistry.listTools()).some(entry => entry.name === 'schedule_await_reply')).toBe(false)
  })
})

describe('ALMNC-54.22 desk consultation', () => {
  it('restores multiple materials and consults only enabled experts for their frontmatter domains', async () => {
    const expert = { id: 'e-1', name: 'Alex', role: 'expert' as const, domain: '工業工程', enabled: true }
    const disabled = { id: 'e-2', name: 'Kim', role: 'expert' as const, domain: '寫作', enabled: false }
    const roster = [...ROSTER, expert, disabled]
    const seed = buildDeskContext([
      { id: 'a', kind: 'note', path: 'a.md', title: 'A', noteRaw: '---\ndomains: [ie, 寫作]\nsources: [s1]\n---\n產線', text: '產線' },
      { id: 'b', kind: 'note', path: 'b.md', title: 'B', noteRaw: '---\ndomains: 工業工程\n---\n瓶頸', text: '瓶頸' },
      { id: 'c', kind: 'source', sourceId: 's2', title: 'C', text: '現場觀察' },
    ], [{ id: 'ie', name: '工業工程' } as Parameters<typeof buildDeskContext>[1][number]], roster)
    expect(seed.expertIds).toEqual(['e-1'])
    expect(seed.materials[0].noteSourceIds).toEqual(['s1'])
    expect(seed.materials[2].sourceId).toBe('s2')
    const deskContext = readDeskContext([{ type: 'desk_context', content: JSON.stringify(seed) }])
    expect(deskContext?.materials).toHaveLength(3)
    const { deps } = fakeDeps({ roster: async () => roster, memoryPrompt: async agent => `Memory for ${agent.name}` })
    const askExpert = vi.fn(async () => '第三站需要更多數據')
    const run = await prepareSidebarCommanderRun({ chatId: 3, scottMessages: ['請專家判斷'], deskContext, askExpert }, deps)
    expect(run.displayName).toBe('Mia · 指揮官')
    expect(run.rolePrompt).toContain('產線')
    expect(run.rolePrompt).toContain('瓶頸')
    expect(run.rolePrompt).toContain('現場觀察')
    const consult = tool(run, 'desk_consult_expert')
    expect(consult.risk).toBe('read')
    expect(await consult.execute({ expertId: 'e-2', question: '看這些筆記' }, context)).toMatchObject({ ok: false })
    expect(askExpert).not.toHaveBeenCalled()
    expect(await consult.execute({ expertId: 'e-1', question: '看這些筆記' }, context)).toMatchObject({ ok: true, message: 'Alex (工業工程): 第三站需要更多數據' })
    expect(askExpert).toHaveBeenCalledWith(expect.stringContaining('Memory for Alex'), '看這些筆記', undefined)
    expect(askExpert).toHaveBeenCalledWith(expect.stringContaining('現場觀察'), '看這些筆記', undefined)
  })
})

// Fork（almanac ALMNC-92）：指揮官在處理對話中用網路工具查到新資料，執行結束後交給衝突比對（背景）。AI 與網路搜尋用固定回應。
describe('ALMNC-92 fetched-data conflict check', () => {
  const expert = { id: 'e-1', name: 'Alex', role: 'expert' as const, domain: '工業工程', enabled: true }
  const secretary = ROSTER[1]
  const searchResult = {
    ok: true,
    message: '找到 1 個來源',
    data: { query: '節拍', provider: 'native', sources: [{ title: '新版標準', url: 'https://example.com/std', snippet: '節拍時間改為 45 秒' }] },
  }
  const webSearch = (result: unknown = searchResult): AgentTool => ({
    name: 'web_search', title: 'web', description: '', category: 'web', risk: 'read', inputSchema: { type: 'object' }, execute: vi.fn(async () => result as never),
  })
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  it('the commander\'s process turn hands the fetched sources and Scott\'s question to the conflict check once the run ends', async () => {
    const checkFetched = vi.fn(async () => {})
    const { deps } = fakeDeps({ checkFetched })
    const run = await prepareSidebarCommanderRun({ conversationId: 7, chatId: 70, scottMessages: ['現在的節拍時間是多少？', '更早的問題'] }, deps)
    const search = run.transformTools([webSearch()]).find(entry => entry.name === 'web_search')!
    expect(await search.execute({ query: '節拍時間 標準' }, context)).toBe(searchResult)
    expect(checkFetched).not.toHaveBeenCalled()
    await run.finish()
    await flush()
    expect(checkFetched).toHaveBeenCalledWith([{ title: '新版標準', url: 'https://example.com/std', snippet: '節拍時間改為 45 秒' }], '現在的節拍時間是多少？')
    await run.finish()
    await flush()
    expect(checkFetched).toHaveBeenCalledTimes(1)
  })

  it('does not check turns without fetched data, failed searches, read-only answers or secretary turns', async () => {
    const checkFetched = vi.fn(async () => {})
    const { deps } = fakeDeps({ checkFetched })
    const quiet = await prepareSidebarCommanderRun({ chatId: 1, scottMessages: ['整理一下'] }, deps)
    await quiet.finish()
    const failed = await prepareSidebarCommanderRun({ chatId: 2, scottMessages: ['查一下'] }, deps)
    await failed.transformTools([webSearch({ ok: false, message: 'off', error: 'WEB_SEARCH_FAILED' })])[0].execute({ query: 'x' }, context)
    await failed.finish()
    for (const input of [
      { chatId: 3, scottMessages: ['查一下'], readOnly: true },
      { chatId: 4, scottMessages: ['查一下'], readOnly: true, answerAs: expert },
      { chatId: 5, scottMessages: ['明天三點開會'], answerAs: secretary },
    ]) {
      const run = await prepareSidebarCommanderRun(input, deps)
      const search = run.transformTools([webSearch()]).find(entry => entry.name === 'web_search')
      await search?.execute({ query: 'x' }, context)
      await run.finish()
    }
    await flush()
    expect(checkFetched).not.toHaveBeenCalled()
  })

  it('a failing conflict check does not affect the turn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const checkFetched = vi.fn(async () => { throw new Error('model down') })
    const { deps } = fakeDeps({ checkFetched })
    const run = await prepareSidebarCommanderRun({ chatId: 70, scottMessages: ['節拍'] }, deps)
    await run.transformTools([webSearch()])[0].execute({ query: '節拍' }, context)
    await expect(run.finish()).resolves.toEqual([])
    await flush()
    expect(checkFetched).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[commander] fetched-data conflict check failed:', expect.any(Error))
    warn.mockRestore()
  })
})

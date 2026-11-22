// Fork（almanac ALMNC-54.7）：右側欄的 AI 是指揮官——用指揮官的工作指示、記憶與「本名 · 指揮官」；
// 想改的檔案在執行結束後送進工作台並掛提案卡；Scott 親口交代的行程由秘書直接寫，掛一行確認與「復原」並記活動紀錄。
import { describe, expect, it, vi } from 'vitest'
import { createTranslator } from 'next-intl'
import messages from '../../../messages/zh-TW.json'
import { agentToolRegistry } from '@/lib/agent/tool-registry'
import { ROLE_INSTRUCTIONS } from '@/lib/agents/instructions'
import { buildDeskContext, readDeskContext } from '@/lib/workbench/desk-context'
import type { Proposal } from '@/lib/collect/types'
import { commanderDisplayName, prepareSidebarCommanderRun, type SidebarRunDeps } from './sidebar-session'
import { SIDEBAR_ASK_RULES, SIDEBAR_COMMANDER_RULES } from './sidebar'

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
    expect(run.rolePrompt).toContain(SIDEBAR_ASK_RULES)
    expect(run.rolePrompt.endsWith('Router: query')).toBe(true)
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

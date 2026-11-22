// Fork（almanac ALMNC-54.7）：右側欄「處理」模式的一次執行——讓 AI 以指揮官身分回答，寫檔變成提案，
// Scott 親口交代的任務和行程由秘書直接寫並貼一行確認與「復原」。
// prepareSidebarCommanderRun 只靠注入的依賴（測試用假的）；createDefaultSidebarDeps 接到 App 裡既有的名單、記憶、
// 今日日誌寫入、工作台（收集項目）、對話卡片與活動紀錄。
import { rememberCompletedRoleWork } from '@/lib/agent-memory/runtime'
import type { CompletedRoleWork } from '@/lib/agent-memory/completion'
import type { AgentTool } from '@/lib/agent/types'
import { ROLE_INSTRUCTIONS } from '@/lib/agents/instructions'
import { agentDisplayName } from '@/lib/agents/display'
import type { AgentRole } from '@/lib/agents/settings'
import type { Proposal } from '@/lib/collect/types'
import type { AwaitingReply } from '@/lib/threads/awaiting'
import type { DirectEditCardData, ProposalCardData } from '@/lib/threads/cards'
import { deskMaterialPrompt, type DeskContext } from '@/lib/workbench/desk-context'
import { describeDirectEdit, type DirectEdit } from './schedule-direct'
import { buildCommanderSidebarPrompt, buildSidebarCommanderTools, changesToProposals, createChangeCollector } from './sidebar'

export interface SidebarRosterAgent {
  id: string
  name: string
  role: AgentRole
  domain?: string
  enabled: boolean
}

type RoleTranslator = (key: string, values?: Record<string, string>) => string

export interface SidebarRunDeps {
  roster: () => Promise<SidebarRosterAgent[]>
  memoryPrompt: (agent: SidebarRosterAgent) => Promise<string>
  readFile: (path: string) => Promise<string | null>
  /** 直接寫一條任務或時段（今日日誌的捕捉軌），回傳寫到哪與復原。 */
  writeSchedule: (proposal: Proposal) => Promise<{ path: string, undo: () => Promise<boolean> }>
  /** 一批提案送進工作台，回傳收集項目 id（卡片用來接受／放棄）。 */
  submitProposals: (batch: { id: string, origin: string, proposals: Proposal[], conversationId?: number }) => Promise<void>
  attachCard: (chatId: number, card: ProposalCardData) => void
  attachDirectEdit: (chatId: number, card: DirectEditCardData, undo: () => Promise<boolean>) => void
  /** 活動紀錄（#111）；失敗只記錯。 */
  logActivity: (entry: { actorId: string, actorRole: AgentRole, targetLink: string, conversationId?: number, note: string }) => Promise<void>
  /** Fork（almanac ALMNC-54.21）：工作台「等你回話」記一筆／拿掉（沒給就不記，也不提供 schedule_await_reply）。 */
  markAwaiting?: (entry: AwaitingReply) => void
  clearAwaiting?: (conversationId: number, via: AwaitingReply['via']) => void
  /** 角色名稱（agents.roles）。 */
  roleLabel: RoleTranslator
  /** 工作台上這批提案的來源名稱，例如「Mia · 指揮官（對話）」。 */
  originLabel: (agent: string) => string
  rememberWork?: (agent: SidebarRosterAgent, work: CompletedRoleWork) => Promise<void>
  now: () => Date
}

export interface SidebarCommanderRun {
  /** 「Mia · 指揮官」。 */
  displayName: string
  rolePrompt: string
  transformTools: (tools: AgentTool[]) => AgentTool[]
  /** 執行結束後：把這次想改的檔案送進工作台、在訊息下面掛提案卡。回傳送出的提案。 */
  finish: () => Promise<Proposal[]>
  remember: (completedAnswer: string) => Promise<void>
}

/** 名單裡的指揮官（沒有就用角色名稱）：「Mia · 指揮官」。 */
export function commanderDisplayName(roster: readonly SidebarRosterAgent[], roleLabel: RoleTranslator): string {
  const commander = roster.find(agent => agent.role === 'commander')
  return commander ? agentDisplayName(commander, roleLabel) : roleLabel('commander')
}

let batchCounter = 0

export async function prepareSidebarCommanderRun(
  input: {
    conversationId?: number
    chatId: number
    scottMessages: readonly string[]
    readOnly?: boolean
    /** Fork（almanac ALMNC-54.11）：路由器把查詢交給某位專家時，以他的身分（工作指示、記憶、本名）只讀回答。 */
    answerAs?: SidebarRosterAgent
    /** Fork（almanac ALMNC-54.11）：路由器的決定，接在規則後面給模型參考（例如「這是交代秘書的日程」）。 */
    routeNote?: string
    deskContext?: DeskContext
    expertToolTitle?: string
    askExpert?: (system: string, question: string, signal?: AbortSignal) => Promise<string>
  },
  deps: SidebarRunDeps,
): Promise<SidebarCommanderRun> {
  const roster = await deps.roster().catch(error => {
    console.warn('[commander] roster unavailable', error)
    return [] as SidebarRosterAgent[]
  })
  const commander = roster.find(agent => agent.role === 'commander')
  const secretary = roster.find(agent => agent.role === 'secretary')
  // 專家以只讀方式答詢，秘書處理日程；沒有指定夥伴時由指揮官接手。
  const speaker = input.answerAs?.role === 'expert' && !input.readOnly ? commander : input.answerAs ?? commander
  const displayName = speaker && speaker !== commander ? agentDisplayName(speaker, deps.roleLabel) : commanderDisplayName(roster, deps.roleLabel)
  const secretaryName = secretary ? agentDisplayName(secretary, deps.roleLabel) : deps.roleLabel('secretary')
  let memory = ''
  if (speaker) {
    try {
      memory = await deps.memoryPrompt(speaker)
    } catch (error) {
      // 讀不到記憶照常執行（只少了記憶），同背景 agent（agents/runner.ts）。
      console.warn('[commander] memory unavailable', error)
    }
  }
  // 「問」模式也是指揮官在回答，只是規則換成只讀（工具由 runtime 的 read-only 篩掉，這裡不替換）。
  const materials = input.deskContext ? deskMaterialPrompt(input.deskContext) : ''
  const experts = roster.filter(agent => agent.enabled && agent.role === 'expert' && input.deskContext?.expertIds.includes(agent.id))
  const askExpert = input.askExpert
  const expertTool: AgentTool | undefined = experts.length && askExpert ? {
    name: 'desk_consult_expert',
    title: input.expertToolTitle ?? 'Consult a desk domain expert',
    description: `Ask for a read-only assessment of the desk materials. Available experts: ${experts.map(expert => `${expert.id} = ${expert.name} (${expert.domain})`).join(', ')}.`,
    category: 'system',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        expertId: { type: 'string', enum: experts.map(expert => expert.id) },
        question: { type: 'string' },
      },
      required: ['expertId', 'question'],
      additionalProperties: false,
    },
    execute: async ({ expertId, question }, context) => {
      const expert = experts.find(agent => agent.id === expertId)
      if (!expert || typeof question !== 'string' || !question.trim()) {
        return { ok: false, error: 'INVALID_EXPERT_REQUEST', message: 'Choose a desk expert and ask a specific question.' }
      }
      const expertMemory = await deps.memoryPrompt(expert).catch(() => '')
      const system = [
        ROLE_INSTRUCTIONS.expert,
        `You are ${expert.name}, responsible for ${expert.domain}. Give a read-only opinion based on the supplied materials. State where evidence is missing.`,
        expertMemory,
        materials,
      ].filter(Boolean).join('\n\n')
      context?.signal?.throwIfAborted()
      const answer = await askExpert(system, question, context?.signal)
      return { ok: true, message: `${expert.name} (${expert.domain}): ${answer}` }
    },
  } : undefined
  const rolePrompt = [
    buildCommanderSidebarPrompt({ instructions: ROLE_INSTRUCTIONS[speaker?.role ?? 'commander'], memory, displayName, readOnly: input.readOnly, role: speaker?.role }),
    input.routeNote?.trim() ?? '',
    materials,
    expertTool ? 'When Scott asks for a domain expert or the question needs domain judgment, consult the relevant expert with desk_consult_expert and attribute their assessment in your reply.' : '',
  ].filter(Boolean).join('\n\n')

  const collector = createChangeCollector()
  const secretaryProposals: Proposal[] = []
  let choiceAnswered = false
  let directCount = 0
  // Fork（almanac ALMNC-54.21）：秘書這一輪以問句收尾（schedule_await_reply），執行結束時記到「等你回話」。
  let awaitedQuestion: string | null = null
  const conversationId = input.conversationId
  const markAwaiting = deps.markAwaiting
  const awaitReply = conversationId !== undefined && markAwaiting ? {
    onAsk: (question: string) => { awaitedQuestion = question },
    open: (line: { question: string, choices?: string[] }) => markAwaiting({
      conversationId, chatId: input.chatId, question: line.question, ...(line.choices ? { choices: line.choices } : {}),
      by: displayName, at: deps.now().getTime(), via: 'live',
    }),
    close: () => deps.clearAwaiting?.(conversationId, 'live'),
  } : undefined

  const transformTools = (tools: AgentTool[]) => buildSidebarCommanderTools(tools, {
    collector,
    readFile: deps.readFile,
    onChoiceAnswered: () => { choiceAnswered = true },
    ...(awaitReply ? { awaitReply } : {}),
    schedule: {
      now: deps.now,
      scottMessages: () => input.scottMessages,
      choiceAnswered: () => choiceAnswered,
      write: async (proposal): Promise<DirectEdit> => {
        const written = await deps.writeSchedule(proposal)
        return { proposal, path: written.path, undo: written.undo }
      },
      onDirectEdit: async edit => {
        directCount += 1
        const what = describeDirectEdit(edit.proposal)
        deps.attachDirectEdit(input.chatId, {
          type: 'direct-edit', id: `direct-${input.chatId}-${directCount}-${edit.proposal.id}`, what, agent: secretaryName, status: 'done',
        }, edit.undo)
        try {
          await deps.logActivity({
            actorId: secretary?.id ?? 'secretary',
            actorRole: 'secretary',
            targetLink: `task:${encodeURI(edit.path)}`,
            conversationId: input.conversationId,
            note: what,
          })
        } catch (error) {
          console.error('[commander] activity log failed:', error)
        }
      },
      propose: proposal => { secretaryProposals.push(proposal) },
    },
  })

  return {
    displayName,
    rolePrompt,
    transformTools: tools => {
      const selected = input.readOnly ? tools : transformTools(tools)
      return expertTool ? [...selected, expertTool] : selected
    },
    remember: async completedAnswer => {
      const rememberWork = deps.rememberWork
      if (!completedAnswer.trim() || !speaker || !rememberWork || (input.conversationId ?? 0) <= 0) return
      const work = {
        request: input.scottMessages[0],
        result: completedAnswer,
        fromScott: true,
        reference: `conversation:${input.conversationId}#${input.chatId}`,
        conversationId: input.conversationId,
      }
      const participants = secretary && directCount > 0 && speaker !== secretary ? [speaker, secretary] : [speaker]
      await Promise.all(participants.map(agent => rememberWork(agent, work)))
    },
    finish: async () => {
      if (awaitedQuestion && conversationId !== undefined) {
        markAwaiting?.({ conversationId, chatId: input.chatId, question: awaitedQuestion, by: secretaryName, at: deps.now().getTime(), via: 'turn' })
      }
      const proposals = [
        ...changesToProposals(collector.changes(), { conversationId: input.conversationId, agentId: commander?.id }),
        ...secretaryProposals.map(proposal => ({
          ...proposal,
          ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
          drafter: { role: 'secretary' as const, ...(secretary ? { agentId: secretary.id } : {}) },
        })),
      ]
      if (!proposals.length) return []
      batchCounter += 1
      const id = `sidebar-${input.chatId}-${Date.now().toString(36)}-${batchCounter}`
      await deps.submitProposals({ id, origin: deps.originLabel(displayName), proposals, conversationId: input.conversationId })
      for (const proposal of proposals) {
        deps.attachCard(input.chatId, {
          type: 'proposal',
          id: `${id}:${proposal.id}`,
          kind: proposal.kind,
          title: proposal.title,
          ...(proposal.due ? { due: proposal.due } : {}),
          ...(proposal.time ? { time: proposal.time } : {}),
          status: 'wait',
          source: { itemId: id, proposalId: proposal.id },
        })
      }
      return proposals
    },
  }
}

/** App 內的實際依賴。需要 Tauri（資料庫、檔案）才跑得起來，單元測試用假的。 */
export async function createDefaultSidebarDeps(labels: { roleLabel: RoleTranslator, originLabel: (agent: string) => string }): Promise<SidebarRunDeps> {
  const [agentsDb, memoryDb, noteIo, write, { default: useCollectStore }, { default: useThreadsStore }, { default: useDailySettingsStore }, { default: useAwaitingRepliesStore }] = await Promise.all([
    import('@/db/agents'),
    import('@/db/agent-memory'),
    import('@/lib/daily/note-io'),
    import('@/lib/collect/write'),
    import('@/stores/collect'),
    import('@/stores/threads'),
    import('@/stores/daily-settings'),
    import('@/stores/awaiting-replies'),
  ])
  return {
    roster: async () => {
      await agentsDb.ensureDefaultRoster().catch(() => false)
      return agentsDb.listAgentSettings()
    },
    memoryPrompt: agent => memoryDb.loadAgentMemoryPrompt(agent),
    readFile: noteIo.readNote,
    writeSchedule: async proposal => {
      await useDailySettingsStore.getState().initSettings()
      // 任務、時段走收集提案同一套寫入（今日日誌的捕捉軌，經編輯器協調），復原也一樣（檔案被別處改過就不動）。
      const result = await write.acceptProposal(proposal, { noteFolder: useDailySettingsStore.getState().inboxFolder })
      return { path: result.path, undo: () => write.undoAccepted(result) }
    },
    submitProposals: async batch => {
      await useCollectStore.getState().hydrate()
      useCollectStore.getState().addProposals(batch.id, batch.origin, batch.proposals, { conversationId: batch.conversationId })
    },
    attachCard: (chatId, card) => useThreadsStore.getState().attachCard(chatId, card),
    attachDirectEdit: (chatId, card, undo) => useThreadsStore.getState().attachDirectEdit(chatId, card, undo),
    markAwaiting: entry => useAwaitingRepliesStore.getState().mark(entry),
    clearAwaiting: (conversationId, via) => useAwaitingRepliesStore.getState().clear(conversationId, via),
    logActivity: async entry => {
      await memoryDb.appendActivity('system', {
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        action: 'created',
        targetLink: entry.targetLink,
        source: { kind: 'conversation', ref: entry.conversationId !== undefined ? String(entry.conversationId) : 'sidebar' },
        note: Array.from(entry.note).slice(0, 60).join(''),
      })
      // TODO（ALMNC-54.7）：按「復原」時還沒記活動紀錄；活動紀錄只能新增，復原要記成哪個動作待定。
    },
    roleLabel: labels.roleLabel,
    originLabel: labels.originLabel,
    rememberWork: rememberCompletedRoleWork,
    now: () => new Date(),
  }
}

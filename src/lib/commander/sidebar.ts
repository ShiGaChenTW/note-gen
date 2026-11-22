// Fork（almanac ALMNC-54.7）：右側欄的 AI 就是指揮官（定案文件第三節「對話」）。
// 指揮官改動筆記庫一律要經過 Scott 接受（第二節權限），所以右側欄「處理」模式提供給模型的工具這樣換：
// - 讀取類工具照舊；
// - 會改檔的筆記／資料夾工具（新增、修改、刪除、搬移、複製、新增資料夾）換成「變成提案」的版本，不碰檔案；
// - 其他會寫入的工具（編輯器寫入、畫布、標籤、記錄、記憶、腳本、技能安裝……）一律不提供；
// - 加上秘書的 schedule_* 工具：只有 Scott 親口交代的任務和行程直接寫（schedule-direct.ts）。
// 這裡全是純函式，寫入、送進工作台由呼叫端注入（sidebar-session.ts）。
import type { AgentTool, AgentToolResult } from '@/lib/agent/types'
import { buildBackgroundTools, type DraftSink } from '@/lib/agent-tasks/draft-tools'
import { DRAFT_TOOL_KINDS, mergeDraft } from '@/lib/agent-tasks/draft'
import type { DraftChange } from '@/lib/agent-tasks/types'
import { newProposalId } from '@/lib/collect/split'
import type { FileChange, Proposal } from '@/lib/collect/types'
import { buildScheduleTools, SCHEDULE_TOOL_NAMES, type ScheduleDeps } from './schedule-direct'
import { buildAwaitReplyTool, withAwaitingQuestion } from './await-reply'

/** 會改檔、要換成提案版本的原工具（同背景任務的草稿工具）。 */
const DRAFTABLE_TOOL_NAMES = new Set(Object.keys(DRAFT_TOOL_KINDS))

/**
 * 提案版本改名（propose_*）：原名在 runtime 裡會走「改檔預覽／已套用」的流程（hasFileEditPreview），
 * 對話時間軸會把它畫成已改好的檔案；改名後只是一般工具。提案記的仍是原工具名，接受時用原工具寫入。
 */
export function proposalToolName(original: string): string {
  return `propose_${original.replace(/_file$/, '')}`
}

export const PROPOSAL_TOOL_NAMES = new Set([...DRAFTABLE_TOOL_NAMES].map(proposalToolName))

/** 每個提供給模型的工具屬於哪一類；測試用它確認右側欄沒有任何直接寫檔的工具。 */
export type SidebarToolKind = 'read' | 'proposal' | 'schedule'

export function sidebarToolKind(tool: Pick<AgentTool, 'name' | 'risk'>): SidebarToolKind | null {
  if (PROPOSAL_TOOL_NAMES.has(tool.name)) return 'proposal'
  if ((SCHEDULE_TOOL_NAMES as readonly string[]).includes(tool.name)) return 'schedule'
  if (tool.risk === 'read') return 'read'
  return null
}

/** 收集這次執行想做的檔案變更（同一個檔案的多次修改合併成一筆，同背景任務）。 */
export interface ChangeCollector extends DraftSink {
  changes: () => FileChange[]
}

export function createChangeCollector(): ChangeCollector {
  let drafts: DraftChange[] = []
  return {
    drafts: () => drafts,
    add: draft => { drafts = mergeDraft(drafts, draft) },
    changes: () => drafts.filter(draft => draft.state === 'pending').map(draft => ({
      toolName: draft.toolName,
      args: draft.args,
      kind: draft.kind,
      path: draft.path,
      ...(draft.targetPath ? { targetPath: draft.targetPath } : {}),
      ...(draft.content !== undefined ? { content: draft.content } : {}),
      baseContent: draft.baseContent,
      summary: draft.summary,
    })),
  }
}

export interface SidebarToolDeps {
  collector: ChangeCollector
  readFile: (path: string) => Promise<string | null>
  schedule: ScheduleDeps
  /** ask_user_question 有回答時呼叫（交代得不夠具體、Scott 選了之後才能直接寫）。 */
  onChoiceAnswered: () => void
  /**
   * Fork（almanac ALMNC-54.21）：秘書在等 Scott 回話（工作台「等你回話」）。onAsk＝schedule_await_reply 記下這一輪收尾的問句；
   * open／close＝ask_user_question 開著／結束。沒給就不提供 schedule_await_reply。
   */
  awaitReply?: {
    onAsk: (question: string) => void
    open: (line: { question: string, choices?: string[] }) => void
    close: () => void
  }
}

const PROPOSAL_NOTE = '\n(Right sidebar: this does not change any file. It becomes a proposal on the workbench and is written only after Scott accepts it.)'

function asProposalTool(wrapped: AgentTool, original: AgentTool, collector: ChangeCollector): AgentTool {
  return {
    ...wrapped,
    name: proposalToolName(original.name),
    title: `${original.title}（提案）`,
    description: `${original.description}${PROPOSAL_NOTE}`,
    // 不碰檔案；用 medium 讓它仍算寫入類（介面顯示、失敗保護），右側欄以 auto-edit 執行，不跳確認。
    risk: 'medium',
    execute: async (input, context): Promise<AgentToolResult> => {
      const result = await wrapped.execute(input, context)
      if (!result.ok) return result
      const summary = collector.drafts().at(-1)?.summary ?? ''
      return { ok: true, message: `Proposed (not written): ${summary}. The vault does not change until Scott accepts it on the workbench or in this chat.` }
    },
  }
}

function withChoiceTracking(tool: AgentTool, onAnswered: () => void): AgentTool {
  return {
    ...tool,
    execute: async (input, context) => {
      const result = await tool.execute(input, context)
      if (result.ok) onAnswered()
      return result
    },
  }
}

/**
 * 右側欄「處理」模式提供的工具。給 AgentRuntime 的 transformTools 用。
 * 只留讀取類、提案版本的檔案工具與秘書的 schedule_* 工具；其他會寫入的工具全部拿掉。
 */
export function buildSidebarCommanderTools(tools: AgentTool[], deps: SidebarToolDeps): AgentTool[] {
  const draftable = tools.filter(tool => DRAFTABLE_TOOL_NAMES.has(tool.name) || tool.name === 'note_read_file')
  const wrapped = new Map(buildBackgroundTools(draftable, deps.collector, deps.readFile).map(tool => [tool.name, tool]))
  const offered: AgentTool[] = []
  for (const tool of tools) {
    if ((SCHEDULE_TOOL_NAMES as readonly string[]).includes(tool.name)) continue
    const draft = wrapped.get(tool.name)
    if (PROPOSAL_TOOL_NAMES.has(tool.name)) continue
    if (DRAFTABLE_TOOL_NAMES.has(tool.name)) {
      if (draft) offered.push(asProposalTool(draft, tool, deps.collector))
      continue
    }
    if (tool.name === 'note_read_file') {
      offered.push(draft ?? tool)
      continue
    }
    if (tool.risk !== 'read') continue
    if (tool.name === 'ask_user_question') {
      const tracked = withChoiceTracking(tool, deps.onChoiceAnswered)
      offered.push(deps.awaitReply ? withAwaitingQuestion(tracked, deps.awaitReply) : tracked)
      continue
    }
    offered.push(tool)
  }
  return [...offered, ...buildScheduleTools(deps.schedule), ...(deps.awaitReply ? [buildAwaitReplyTool(deps.awaitReply.onAsk)] : [])]
}

/** 收集到的檔案變更 → 工作台的提案（記來源對話與撰寫者）。 */
export function changesToProposals(changes: readonly FileChange[], origin: { conversationId?: number, agentId?: string }): Proposal[] {
  return changes.map(change => ({
    id: newProposalId(),
    kind: 'note',
    title: change.summary,
    body: '',
    due: '',
    time: '',
    tags: [],
    change,
    ...(origin.conversationId !== undefined ? { conversationId: origin.conversationId } : {}),
    drafter: { role: 'commander', ...(origin.agentId ? { agentId: origin.agentId } : {}) },
  }))
}

/** 右側欄指揮官的工作規則，接在角色工作指示與記憶後面。 */
export const SIDEBAR_COMMANDER_RULES = [
  '## Right sidebar rules',
  'You are talking with Scott in the right sidebar as the commander.',
  '- There are no tools that write notes here. The propose_* tools (propose_note_create, propose_note_update, propose_note_delete, propose_note_rename, propose_note_move, propose_note_copy, propose_folder_create) take the same arguments as the note tools but only stage proposals. Nothing is written until Scott accepts. Say "I proposed …", never "I changed …".',
  '- To change the open note, read it with note_read_file and propose the full new content with propose_note_update. Editor write tools and note_update_file are not available here.',
  '- Domains and knowledge are notes too: changes to them are proposals.',
  '- Tasks and time blocks are handled by the secretary tools schedule_add_task and schedule_add_event. Use them only when Scott himself asks for a task or appointment, and pass his exact words as quote. These are written directly and Scott gets a one-line confirmation with undo.',
  '- If Scott did not say exactly when (for example "find time next week to meet A"), ask him with ask_user_question before adding anything. His choice is applied directly, without a proposal.',
  '- Tasks or time blocks you suggest on your own initiative must not be added directly; they become proposals.',
  '- If a task or appointment is waiting on Scott\'s answer to an open question (no concrete options), call schedule_await_reply with that question in one line, then ask it and stop. The question waits on his workbench until he replies.',
].join('\n')

/** 系統提示詞裡指揮官那一段：角色工作指示、記憶（soul、rules、工作筆記、Scott 的偏好、目前脈絡）、顯示名稱與右側欄規則。 */
/** 「問」模式：只回答，不提案也不改行程。 */
export const SIDEBAR_ASK_RULES = [
  '## Right sidebar rules (Ask mode)',
  'You are talking with Scott in the right sidebar as the commander, in Ask mode: answer only. Do not change, propose or schedule anything. If Scott wants something changed or scheduled, tell him to switch to Process (處理).',
].join('\n')

export function buildCommanderSidebarPrompt(input: { instructions: string, memory: string, displayName: string, readOnly?: boolean, role?: string }): string {
  const rules = input.readOnly ? SIDEBAR_ASK_RULES : SIDEBAR_COMMANDER_RULES
  return [
    input.instructions,
    `Your name in this app is "${input.displayName}".`,
    input.memory,
    input.role ? rules.replace('as the commander', `as the ${input.role}`) : rules,
  ].filter(text => text.trim()).join('\n\n')
}

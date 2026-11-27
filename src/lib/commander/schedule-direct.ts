// Fork（almanac ALMNC-54.7）：右側欄裡「Scott 親口交代的任務和行程直接修改」。
// 規格見 almanac/2026-11-19_proposal_role-data-model.md 第二節「秘書直接修改的規則」：
// - 誰發起，決定要不要提案：Scott 親口交代的直接改；秘書主動建議的走提案。
// - 交代得不夠具體（例如「下週找時間跟 A 開會」）就在對話裡問，Scott 選了就直接改，不另外產生提案。
// - 每次直接修改都回一行確認（例如「已新增：11/20 10:00 會議」），附「復原」。
// - 只限任務和行程，不套用到筆記。
// 這裡是給模型用的兩個工具（schedule_add_task／schedule_add_event）與判斷用的純函式；真正寫入、復原、貼確認卡由依賴注入。
// 「是不是 Scott 親口交代」不靠模型自己說：工具一定要附 Scott 的原話（quote），而且原話要真的出現在 Scott 的訊息裡、
// 看起來是交代排程的句子，才直接寫；否則一律改成提案。
import type { AgentTool, AgentToolResult } from '@/lib/agent/types'
import { extractSchedule, isValidYmd, newProposalId, normalizeTime } from '@/lib/collect/split'
import type { Proposal } from '@/lib/collect/types'
import { projectTag } from './consolidate'

export const SCHEDULE_TOOL_NAMES = ['schedule_add_task', 'schedule_add_event'] as const
export type ScheduleToolName = typeof SCHEDULE_TOOL_NAMES[number]

// ── 判斷 ────────────────────────────────────────────────────

/** 交代的動詞或對象（新增、排、約、提醒我、任務、會議……）。 */
const INSTRUCTION = /新增|加(?:一個|個|上|入|到)?|排(?:一下|個|進|入|在)?|安排|約|预约|預約|訂|建立|記(?:下|得)|记(?:下|得)|提醒我|待辦|待办|任務|任务|行程|會議|会议|開會|开会|時段|时段|新建|添加|日程|\b(?:add|schedule|remind me|book|set up|create|put|todo|to-do|task|meeting)\b/i
/** 問句：問行程而不是交代（「明天有什麼會議？」）。 */
const QUESTION = /[?？]\s*$|什麼|什么|哪些|有沒有|有没有|幾點|几点|\b(?:what|which|when is|do i have)\b/i
/** 問句裡帶「幫我」「請」仍算交代（「可以幫我加一個會議嗎？」）。 */
const POLITE_REQUEST = /幫我|帮我|請|请|麻煩|麻烦|\b(?:please|can you|could you)\b/i

/** 這句話是不是在交代任務或行程。只是過濾，不負責解析。 */
export function looksLikeScheduleInstruction(text: string): boolean {
  const value = text.trim()
  if (!value || !INSTRUCTION.test(value)) return false
  return !QUESTION.test(value) || POLITE_REQUEST.test(value)
}

/** 沒給確切時間（找時間、有空、改天、只說「下週」）。 */
const VAGUE = /找(?:個|一個|一)?(?:時間|时间|天)|有空|改天|某(?:一)?天|哪天|\b(?:sometime|find (?:a )?time|when (?:i'm|you're|we're) free|some day)\b/i
const WEEK_ONLY = /(?:下|這|这|本)(?:週|周|星期|禮拜|礼拜)(?![一二三四五六日天])|\bnext week\b|\bthis week\b/i

export function isVagueSchedule(text: string): boolean {
  if (VAGUE.test(text)) return true
  if (!WEEK_ONLY.test(text)) return false
  // 只說「下週」，卻也說了星期幾或幾點，就算具體
  const { time } = extractSchedule(text, new Date())
  return !time && !/(?:週|周|星期|禮拜|礼拜)[一二三四五六日天]|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i.test(text)
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase()
}

/** 原話有沒有出現在 Scott 的訊息裡（忽略空白與大小寫）。 */
export function quotedFromScott(quote: string, scottMessages: readonly string[]): boolean {
  const needle = normalize(quote)
  if (Array.from(needle).length < 2) return false
  return scottMessages.some(message => normalize(message).includes(needle))
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export interface SlotOption {
  date: string
  time: string
  label: string
}

/** 交代得不夠具體時給 Scott 選的時間：說「下週」就給下週一、二、四，否則給明天、後天。 */
export function suggestSlots(text: string, now: Date): SlotOption[] {
  const days: Date[] = []
  if (/(?:下)(?:週|周|星期|禮拜|礼拜)|\bnext week\b/i.test(text)) {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((8 - now.getDay()) % 7 || 7))
    for (const offset of [0, 1, 3]) days.push(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset))
  } else {
    for (const offset of [1, 1, 2]) days.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset))
  }
  const times = ['10:00', '14:00', '10:00']
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return days.map((day, index) => ({
    date: ymd(day),
    time: times[index],
    label: `${ymd(day)} (${weekday[day.getDay()]}) ${times[index]}`,
  }))
}

// ── 工具 ────────────────────────────────────────────────────

export interface DirectEdit {
  proposal: Proposal
  /** 復原這一筆；檔案之後被改過就不動，回傳 false。 */
  undo: () => Promise<boolean>
  /** 寫進哪個檔案（活動紀錄的對象連結用）。 */
  path: string
}

export interface ScheduleDeps {
  now: () => Date
  /** Scott 在這段對話裡的訊息，最新的在前（第一則是這次送出的）。 */
  scottMessages: () => readonly string[]
  /** 直接寫進今日日誌（既有的任務／時段寫入），回傳復原用的資料。 */
  write: (proposal: Proposal) => Promise<DirectEdit>
  /** 直接修改後：貼一行確認與「復原」、記活動紀錄。 */
  onDirectEdit: (edit: DirectEdit) => void | Promise<void>
  /** 不是 Scott 親口交代的：改成提案（秘書主動提出的建議）。 */
  propose: (proposal: Proposal) => void | Promise<void>
  /** 這次執行裡 Scott 是否已經在對話裡選過（ask_user_question 有回答）。 */
  choiceAnswered: () => boolean
  /**
   * Fork（almanac ALMNC-87）：現有的專案名稱（對話頁的專案分組，lib/threads/projects）。
   * 任務只會掛到這裡面的專案；沒給就當作沒有專案，一律不掛。
   */
  projects?: () => readonly string[]
  /** Fork（almanac ALMNC-87）：這段對話所屬的專案（沒有為空）；模型沒指定專案時預設帶入。 */
  conversationProject?: () => string
}

function projectKey(name: string): string {
  return name.replace(/[\s-]+/g, ' ').trim().toLowerCase()
}

/**
 * Fork（almanac ALMNC-87）：決定任務要掛哪個專案。
 * - 模型有指定（Scott 提到的專案）：只在對得到現有專案時掛，回傳現有的寫法；對不到就不掛（不猜、不建立新專案），也不退回對話的專案。
 * - 沒指定：對話屬於某個現有專案就帶入。
 */
export function resolveTaskProject(requested: string, known: readonly string[], conversationProject = ''): { project?: string, unmatched?: string } {
  const find = (name: string) => {
    const key = projectKey(name)
    return key ? known.find(project => projectKey(project) === key) : undefined
  }
  const wanted = requested.trim()
  if (wanted) {
    const project = find(wanted)
    return project ? { project } : { unmatched: wanted }
  }
  const project = find(conversationProject)
  return project ? { project } : {}
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const QUOTE_DESCRIPTION = 'Scott\'s exact words in this conversation that ask for this item (copy them verbatim). Without real words from Scott the item becomes a proposal instead of a direct change.'

/** 「11/20 10:00 會議」：確認那一行的內容（畫面上再套「已新增：」的翻譯）。 */
export function describeDirectEdit(proposal: Pick<Proposal, 'due' | 'time' | 'title'>): string {
  const m = proposal.due.match(/^\d{4}-(\d{2})-(\d{2})$/)
  const when = [m ? `${Number(m[1])}/${Number(m[2])}` : proposal.due, proposal.time].filter(Boolean).join(' ')
  return [when, proposal.title].filter(Boolean).join(' ')
}

async function runSchedule(kind: 'task' | 'event', input: Record<string, unknown>, deps: ScheduleDeps): Promise<AgentToolResult> {
  const title = str(input.title).replace(/\s*\n\s*/g, ' ')
  if (!title) return { ok: false, error: 'TITLE_REQUIRED', message: 'A title is required.' }
  const quote = str(input.quote)
  const messages = deps.scottMessages()
  const rawDate = str(input.date)
  const rawTime = str(input.time)
  const date = rawDate && isValidYmd(rawDate) ? rawDate : ''
  const time = rawTime ? normalizeTime(rawTime) : ''
  if (rawDate && !date) return { ok: false, error: 'INVALID_DATE', message: 'Use a local date in YYYY-MM-DD format.' }
  if (rawTime && !time) return { ok: false, error: 'INVALID_TIME', message: 'Use a 24-hour time in HH:mm format.' }

  // 掛專案的方式與指揮官產生的任務一致（consolidate.ts draftToProposal）：project 欄位＋專案標籤。
  const { project, unmatched } = kind === 'task'
    ? resolveTaskProject(str(input.project), deps.projects?.() ?? [], deps.conversationProject?.() ?? '')
    : {}
  const tag = projectTag(project)
  const proposal: Proposal = {
    id: newProposalId(), kind, title, body: '', due: date, time: kind === 'event' ? time : '', tags: tag ? [tag] : [],
    ...(project ? { project } : {}),
  }
  const projectNote = unmatched ? ` No existing project is named "${unmatched}", so no project was attached; do not create one.` : ''
  const explicit = quotedFromScott(quote, messages) && looksLikeScheduleInstruction(quote)
  if (!explicit) {
    await deps.propose({ ...proposal, drafter: { role: 'secretary' } })
    return {
      ok: true,
      message: `Scott did not explicitly ask for this in his own words, so it became a proposal on the workbench. Nothing was written. Tell Scott in one line that you proposed it.${projectNote}`,
      data: { proposed: true },
    }
  }

  // 交代得不夠具體：在對話裡問，Scott 選了才直接改。原話是這次的訊息、而且還沒問過才擋；
  // Scott 在後續訊息回答（原話在較早的訊息裡）或已在 ask_user_question 選過，就照選的寫。
  const missing = kind === 'event' && (!date || !time)
  const vagueNow = isVagueSchedule(quote) && quotedFromScott(quote, messages.slice(0, 1)) && !deps.choiceAnswered()
  if (missing || vagueNow) {
    const options = suggestSlots(quote, deps.now())
    return {
      ok: false,
      error: 'NEEDS_CHOICE',
      message: 'Scott\'s instruction does not say exactly when. Do not pick a time yourself and do not create a proposal. Ask Scott with ask_user_question (single choice) using these options, then call this tool again with his choice.',
      data: { options },
    }
  }

  const edit = await deps.write(proposal)
  await deps.onDirectEdit(edit)
  return {
    ok: true,
    message: `Added directly: ${describeDirectEdit(edit.proposal)}${project ? ` (project: ${project})` : ''}. A one-line confirmation with an undo button is already shown to Scott; reply with at most one short line.${projectNote}`,
    data: { direct: true, ...(project ? { project } : {}) },
  }
}

const DATE_PROP = { type: 'string', description: 'Local date YYYY-MM-DD.' }
const TIME_PROP = { type: 'string', description: '24-hour time HH:mm.' }
const PROJECT_PROP = {
  type: 'string',
  description: 'Optional. The existing project this task belongs to, only when Scott named it. Leave it out otherwise: the conversation\'s project (if any) is used. A name that matches no existing project is ignored; never invent or create a project.',
}

/** 秘書的兩個工具：只能加任務或時段，不能碰筆記。 */
export function buildScheduleTools(deps: ScheduleDeps): AgentTool[] {
  return [
    {
      name: 'schedule_add_task',
      title: '新增任務',
      description: 'Secretary: add a task to the daily note directly, only when Scott explicitly asked for it in his own words in this conversation. Never use it for your own suggestions or for notes.',
      category: 'system',
      // 直接寫入是規格允許的（Scott 親口交代）；用 medium 讓它算寫入工具，右側欄的「處理」以 auto-edit 執行，不再跳確認。
      risk: 'medium',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' }, date: DATE_PROP, project: PROJECT_PROP, quote: { type: 'string', description: QUOTE_DESCRIPTION } },
        required: ['title', 'quote'],
        additionalProperties: false,
      },
      execute: input => runSchedule('task', input, deps),
    },
    {
      name: 'schedule_add_event',
      title: '新增時段',
      description: 'Secretary: add a time block (meeting, appointment) to the daily note directly, only when Scott explicitly asked for it in his own words. Requires an exact date and time; if Scott did not give them, the tool tells you to ask him.',
      category: 'system',
      risk: 'medium',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' }, date: DATE_PROP, time: TIME_PROP, quote: { type: 'string', description: QUOTE_DESCRIPTION } },
        required: ['title', 'quote'],
        additionalProperties: false,
      },
      execute: input => runSchedule('event', input, deps),
    },
  ]
}

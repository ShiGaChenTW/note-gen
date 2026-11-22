// Fork（almanac ALMNC-54.13）：G3 秘書回顧行動——完成了什麼、拖延了什麼、時間花在哪。
// 結果寫進 E2 時期回顧（每週回顧提案的一段）；對排程的調整建議作用在 E4（改任務日期的提案，走秘書「主動建議走提案」的規則）。
// 統計是純函式；秘書的文字摘要由模型寫（注入），失敗就只列統計。
import { newProposalId } from '@/lib/collect/split'
import type { Proposal } from '@/lib/collect/types'
import { ymd } from '@/lib/cleanup/interval'
import type { CalendarEvent } from '@/lib/today/today-model'
import type { TaskRef } from '@/lib/vault-index/index-core'
import type { AskModel } from './research'

/** 逾期超過幾天算拖延。 */
export const PROCRASTINATION_DAYS = 7
const DAY = 86_400_000
const DONE_DATE = /✅️?\s*(\d{4}-\d{2}-\d{2})/u

export interface TimeBucket {
  key: string
  minutes: number
}

export interface ActionStats {
  completed: TaskRef[]
  overdue: TaskRef[]
  /** 逾期超過 PROCRASTINATION_DAYS 天、還沒完成的（拖延）。 */
  procrastinated: TaskRef[]
  /** 時間花在哪：行事曆（依行事曆名稱）加上有時間的任務。 */
  time: TimeBucket[]
  totalMinutes: number
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / DAY)
}

export function computeActionStats(input: { tasks: readonly TaskRef[], events?: readonly CalendarEvent[], range: { start: Date, end: Date }, today: string }): ActionStats {
  const start = ymd(input.range.start)
  const end = ymd(input.range.end)
  const completed = input.tasks.filter(task => {
    const done = task.done ? task.raw.match(DONE_DATE)?.[1] : undefined
    return done !== undefined && done >= start && done <= end
  })
  const overdue = input.tasks.filter(task => !task.done && task.due && task.due < input.today)
    .sort((a, b) => a.due.localeCompare(b.due) || a.path.localeCompare(b.path))
  const procrastinated = overdue.filter(task => daysBetween(task.due, input.today) >= PROCRASTINATION_DAYS)
  const buckets = new Map<string, number>()
  const from = input.range.start.getTime()
  const to = input.range.end.getTime()
  for (const event of input.events ?? []) {
    if (event.allDay || event.end <= from || event.start >= to) continue
    const minutes = Math.round((Math.min(event.end, to) - Math.max(event.start, from)) / 60_000)
    if (minutes <= 0) continue
    const key = event.calendar || event.title
    buckets.set(key, (buckets.get(key) ?? 0) + minutes)
  }
  const time = [...buckets].map(([key, minutes]) => ({ key, minutes })).sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key))
  return { completed, overdue, procrastinated, time, totalMinutes: time.reduce((sum, bucket) => sum + bucket.minutes, 0) }
}

export interface ScheduleSuggestion {
  task: TaskRef
  /** 建議的新日期，YYYY-MM-DD。 */
  due: string
}

/** 拖延的任務各建議一個新日期：接下來 7 天裡（跳過週末）已排任務最少的那天。 */
export function suggestReschedules(stats: Pick<ActionStats, 'procrastinated'>, tasks: readonly TaskRef[], today: string, limit = 5): ScheduleSuggestion[] {
  const load = new Map<string, number>()
  for (const task of tasks) if (!task.done && task.due) load.set(task.due, (load.get(task.due) ?? 0) + 1)
  const base = Date.parse(`${today}T00:00:00`)
  const days = Array.from({ length: 7 }, (_, offset) => new Date(base + (offset + 1) * DAY)).filter(date => date.getDay() !== 0 && date.getDay() !== 6).map(ymd)
  const out: ScheduleSuggestion[] = []
  for (const task of stats.procrastinated.slice(0, limit)) {
    const due = days.reduce((best, day) => ((load.get(day) ?? 0) < (load.get(best) ?? 0) ? day : best), days[0])
    load.set(due, (load.get(due) ?? 0) + 1)
    out.push({ task, due })
  }
  return out
}

const DUE_EMOJI = /(📅️?\s*)\d{4}-\d{2}-\d{2}/u
const DUE_FIELD = /(due::\s*)\d{4}-\d{2}-\d{2}/u

/** 改任務行的到期日（📅 或 due::）；沒有日期就加在最後。 */
export function rescheduleLine(raw: string, due: string): string {
  if (DUE_EMOJI.test(raw)) return raw.replace(DUE_EMOJI, `$1${due}`)
  if (DUE_FIELD.test(raw)) return raw.replace(DUE_FIELD, `$1${due}`)
  return `${raw.replace(/\s+$/, '')} 📅 ${due}`
}

export interface ScheduleLabels {
  title: (input: { task: string, from: string, to: string }) => string
  body: (input: { task: string, days: number }) => string
}

/**
 * 排程調整建議做成提案（作用在 E4：改任務日期）。任務所在檔案讀不到、或那一行已經被改過就不提。
 * 卡片標「日程」、動詞「改時間」。
 */
export async function scheduleProposals(
  suggestions: readonly ScheduleSuggestion[],
  deps: { readNote: (path: string) => Promise<string | null>, labels: ScheduleLabels, today: string },
): Promise<Proposal[]> {
  const proposals: Proposal[] = []
  for (const { task, due } of suggestions) {
    const raw = await deps.readNote(task.path).catch(() => null)
    if (raw === null) continue
    const lines = raw.split('\n')
    if ((lines[task.line] ?? '').replace(/\r$/, '') !== task.raw) continue
    lines[task.line] = rescheduleLine(lines[task.line].replace(/\r$/, ''), due) + (lines[task.line].endsWith('\r') ? '\r' : '')
    proposals.push({
      id: newProposalId(),
      kind: 'task',
      title: deps.labels.title({ task: task.title, from: task.due, to: due }),
      body: deps.labels.body({ task: task.title, days: daysBetween(task.due, deps.today) }),
      due,
      time: '',
      tags: [],
      edits: [{ path: task.path, baseContent: raw, content: lines.join('\n'), summary: task.title }],
      card: { label: 'schedule', verb: 'reschedule' },
      drafter: { role: 'secretary' },
    })
  }
  return proposals
}

/** 秘書用自己的話寫兩三句回顧（拖延的原因、時間分配）；失敗回傳空字串。 */
export async function narrateActions(stats: ActionStats, deps: { ask: AskModel, prompt?: string }): Promise<string> {
  const lines = [
    `completed: ${stats.completed.map(task => task.title).join('; ') || '-'}`,
    `overdue: ${stats.overdue.map(task => `${task.title} (due ${task.due})`).join('; ') || '-'}`,
    `procrastinated: ${stats.procrastinated.map(task => task.title).join('; ') || '-'}`,
    `time: ${stats.time.map(bucket => `${bucket.key} ${bucket.minutes}min`).join('; ') || '-'}`,
  ]
  try {
    const text = await deps.ask([deps.prompt, 'You are the secretary. In 2–4 sentences, review this period\'s actions for Scott: what got done, what keeps slipping and where the time went. Observations only, no new tasks. Use Traditional Chinese unless the task titles are in another language. Plain text only.', '---', ...lines].filter(Boolean).join('\n'))
    return text.trim().replace(/^```\w*\n?|```$/g, '').trim()
  } catch (error) {
    console.warn('[review] secretary narrative failed:', error)
    return ''
  }
}

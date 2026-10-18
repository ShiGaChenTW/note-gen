/**
 * D2 今日頁的資料模型：把 F3 索引、今日 Daily Note、行事曆事件整理成畫面要的形狀。
 * 純函式、無 I/O；now 一律由參數注入。
 */

import { formatDate } from '@/lib/daily/format'
import type { DailyNote } from '@/lib/daily/daily-note'
import type { TaskRef } from '@/lib/vault-index/index-core'
import type { IndexedNote } from '@/lib/vault-index/index-note'

export const UPCOMING_DAYS = 3

const DAY_MS = 86_400_000

export function dateKey(date: Date): string {
  return formatDate(date, 'YYYY-MM-DD')
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** 兩個 `YYYY-MM-DD` 之間差幾天（b − a），以本地日曆日計算。 */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS)
}

const PRIORITY_RANK = { high: 0, mid: 1, low: 2 } as const

function byDueThenPriority(a: TaskRef, b: TaskRef): number {
  if (a.due !== b.due) return a.due < b.due ? -1 : 1
  if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (a.time !== b.time) return (a.time || '99') < (b.time || '99') ? -1 : 1
  return a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1
}

// ---------- 任務分組 ----------

export interface DayGroup {
  date: string
  /** 0 = 今天、1 = 明天、2 = 後天 */
  offset: number
  tasks: TaskRef[]
}

export interface TaskGroups {
  overdue: TaskRef[]
  upcoming: DayGroup[]
  /** 今天完成（✅ 今天）的任務 */
  doneToday: TaskRef[]
  pendingCount: number
}

const DONE_DATE_RE = /✅️?\s*(\d{4}-\d{2}-\d{2})/u

/** 待處理：逾期＋今天起 UPCOMING_DAYS 天內到期、未完成的任務。 */
export function groupTasks(tasks: readonly TaskRef[], now: Date, days = UPCOMING_DAYS): TaskGroups {
  const today = dateKey(now)
  const overdue: TaskRef[] = []
  const upcoming: DayGroup[] = Array.from({ length: days }, (_, offset) => ({
    date: dateKey(addDays(startOfDay(now), offset)),
    offset,
    tasks: [],
  }))
  const doneToday: TaskRef[] = []

  for (const task of tasks) {
    if (task.done) {
      if (task.raw.match(DONE_DATE_RE)?.[1] === today) doneToday.push(task)
      continue
    }
    if (!task.due) continue
    if (task.due < today) {
      overdue.push(task)
      continue
    }
    const group = upcoming.find(day => day.date === task.due)
    if (group) group.tasks.push(task)
  }

  overdue.sort(byDueThenPriority)
  for (const group of upcoming) group.tasks.sort(byDueThenPriority)
  doneToday.sort(byDueThenPriority)
  return {
    overdue,
    upcoming,
    doneToday,
    pendingCount: overdue.length + upcoming.reduce((sum, day) => sum + day.tasks.length, 0),
  }
}

// ---------- 今日進程 ----------

export interface CalendarEvent {
  id: string
  title: string
  /** 毫秒時間戳 */
  start: number
  end: number
  allDay: boolean
  calendar: string
}

export type AgendaKind = 'anchor' | 'task' | 'calendar'
export type AgendaState = 'past' | 'now' | 'upcoming'

export interface AgendaItem {
  key: string
  kind: AgendaKind
  title: string
  start: number
  end: number
  state: AgendaState
  /** state = now 時剩下的分鐘數 */
  minutesLeft: number
  /** state = now 時已經過的比例 0–1 */
  progress: number
  /** 任務：所在筆記；行事曆：日曆名稱 */
  source: string
  task?: TaskRef
}

const DEFAULT_DURATION_MIN = 30
const ANCHOR_RANGE_RE = /^(\d{1,2}):(\d{2})\s*(?:[-–~]\s*(\d{1,2}):(\d{2}))?/

function at(day: Date, hours: number, minutes: number): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes).getTime()
}

/**
 * 依時間排序今天的錨點時段、有 ⏰ 的今日任務、行事曆事件。
 * 沒有結束時間的項目：延續到下一個項目開始，最多 60 分鐘，最少 DEFAULT_DURATION_MIN。
 */
export function buildAgenda(input: {
  now: Date
  dailyNote: DailyNote | null
  tasks: readonly TaskRef[]
  events: readonly CalendarEvent[]
}): AgendaItem[] {
  const { now, dailyNote, tasks, events } = input
  const today = dateKey(now)
  const draft: Array<Omit<AgendaItem, 'state' | 'minutesLeft' | 'progress'> & { open: boolean }> = []

  for (const anchor of dailyNote?.anchors ?? []) {
    if (!anchor.time) continue
    const [h, m] = anchor.time.split(':').map(Number)
    const range = anchor.raw.replace(/^\s*[-*+]\s*(?:\[.\]\s*)?/, '').match(ANCHOR_RANGE_RE)
    const start = at(now, h, m)
    const end = range?.[3] ? at(now, Number(range[3]), Number(range[4])) : 0
    draft.push({ key: `anchor:${anchor.lineNo}`, kind: 'anchor', title: anchor.text, start, end, open: !end, source: '' })
  }

  for (const task of tasks) {
    if (task.done || task.due !== today || !task.time) continue
    const [h, m] = task.time.split(':').map(Number)
    draft.push({ key: `task:${task.path}:${task.line}`, kind: 'task', title: task.title, start: at(now, h, m), end: 0, open: true, source: task.path, task })
  }

  for (const event of events) {
    if (event.allDay) continue
    draft.push({ key: `cal:${event.id}`, kind: 'calendar', title: event.title, start: event.start, end: event.end, open: false, source: event.calendar })
  }

  draft.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key))
  for (let i = 0; i < draft.length; i++) {
    const item = draft[i]
    if (!item.open) continue
    const nextStart = draft.slice(i + 1).find(next => next.start > item.start)?.start
    const cap = item.start + 60 * 60_000
    const floor = item.start + DEFAULT_DURATION_MIN * 60_000
    item.end = Math.max(floor, Math.min(nextStart ?? cap, cap))
  }

  const t = now.getTime()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return draft.map(({ open: _open, ...item }) => {
    const state: AgendaState = t >= item.end ? 'past' : t >= item.start ? 'now' : 'upcoming'
    return {
      ...item,
      state,
      minutesLeft: state === 'now' ? Math.ceil((item.end - t) / 60_000) : 0,
      progress: state === 'now' ? (t - item.start) / (item.end - item.start) : 0,
    }
  })
}

// ---------- 本週 ----------

export interface WeekDay {
  date: string
  /** 0 = 週一 … 6 = 週日 */
  index: number
  isToday: boolean
  hasNote: boolean
  open: number
  total: number
}

/** 本週（週一到週日）每天的日記是否存在、當天到期的任務數。 */
export function buildWeek(input: {
  now: Date
  tasks: readonly TaskRef[]
  dailyNotePathFor: (date: Date) => string
  hasNote: (path: string) => boolean
}): WeekDay[] {
  const { now, tasks, dailyNotePathFor, hasNote } = input
  const today = startOfDay(now)
  const monday = addDays(today, -((today.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => {
    const day = addDays(monday, index)
    const date = dateKey(day)
    const due = tasks.filter(task => task.due === date)
    return {
      date,
      index,
      isToday: date === dateKey(today),
      hasNote: hasNote(dailyNotePathFor(day)),
      open: due.filter(task => !task.done).length,
      total: due.length,
    }
  })
}

// ---------- 需處理 ----------

/** Inbox 資料夾內超過 staleDays 天沒動的筆記。 */
export function staleInboxNotes(notes: Iterable<IndexedNote>, inboxFolder: string, staleDays: number, now: Date): IndexedNote[] {
  const prefix = `${inboxFolder.replace(/^\/+|\/+$/g, '')}/`
  const cutoff = now.getTime() - staleDays * DAY_MS
  const out: IndexedNote[] = []
  for (const note of notes) {
    if (note.path.startsWith(prefix) && note.mtime > 0 && note.mtime < cutoff) out.push(note)
  }
  return out.sort((a, b) => a.mtime - b.mtime)
}

/** 狀態列的「需處理」：逾期＋今天到期未完成＋Inbox 積壓。 */
export function needAttentionCount(groups: TaskGroups, staleInbox: number): number {
  return groups.overdue.length + (groups.upcoming[0]?.tasks.length ?? 0) + staleInbox
}

// ---------- D6：把昨天未完成的任務帶到今天 ----------

export interface CarryResult {
  /** 昨天的筆記：任務行改成一般清單項目並指向今天 */
  source: string
  /** 今天的筆記：在指定區塊末尾插入任務行 */
  target: string
  moved: number
}

const TASK_LINE_RE = /^(\s*)[-*+]\s+\[[ /]\]\s+(.*)$/

/**
 * 移動指定行號（0 起算）的未完成任務：
 * - 原處改成 `- <原文字> → [[今天的筆記名稱]]`，不再是任務，Obsidian Tasks 也不會再列出
 * - 今日筆記：插在標題含 sectionHint 的區塊最後；找不到該區塊就附在檔尾
 * 其餘行逐字不變；行號不是未完成任務時略過。
 */
export function carryTasks(input: {
  source: string
  target: string
  lines: readonly number[]
  targetNoteName: string
  sectionHint?: string
}): CarryResult {
  const { targetNoteName, sectionHint = '捕捉軌' } = input
  const eolSource = input.source.includes('\r\n') ? '\r\n' : '\n'
  const sourceLines = input.source.split('\n')
  const carried: string[] = []
  for (const lineNo of [...new Set(input.lines)].sort((a, b) => a - b)) {
    const raw = sourceLines[lineNo]
    if (raw === undefined) continue
    const cr = raw.endsWith('\r') ? '\r' : ''
    const m = raw.replace(/\r$/, '').match(TASK_LINE_RE)
    if (!m) continue
    carried.push(`- [ ] ${m[2]}`)
    sourceLines[lineNo] = `${m[1]}- ${m[2]} → [[${targetNoteName}]]${cr}`
  }
  if (carried.length === 0) return { source: input.source, target: input.target, moved: 0 }
  return {
    source: sourceLines.join('\n'),
    target: insertLinesInSection(input.target, carried, sectionHint, eolSource),
    moved: carried.length,
  }
}

/**
 * 把多行插在標題含 sectionHint 的區塊最後（略過區塊尾端的空行）；找不到該區塊就附在檔尾。
 * 其餘行逐字不變；換行符沿用 target 的寫法，target 沒有換行時用 fallbackEol。
 */
export function insertLinesInSection(target: string, lines: readonly string[], sectionHint: string, fallbackEol = '\n'): string {
  const eol = target.includes('\r\n') ? '\r\n' : fallbackEol
  const targetLines = target.split(/\r?\n/)
  const head = targetLines.findIndex(line => /^#{1,6}\s/.test(line) && line.includes(sectionHint))
  let insertAt: number
  if (head >= 0) {
    let end = targetLines.findIndex((line, i) => i > head && (/^#{1,6}\s/.test(line) || /^---\s*$/.test(line)))
    if (end < 0) end = targetLines.length
    insertAt = end
    while (insertAt > head + 1 && targetLines[insertAt - 1].trim() === '') insertAt--
  } else {
    insertAt = targetLines.length
    while (insertAt > 0 && targetLines[insertAt - 1].trim() === '') insertAt--
  }
  targetLines.splice(insertAt, 0, ...lines)
  return targetLines.join(eol)
}

/** 昨天的日記裡還沒完成的任務行（0 起算行號）。 */
export function openTaskLines(content: string): number[] {
  return content.split('\n').flatMap((line, i) => (TASK_LINE_RE.test(line.replace(/\r$/, '')) ? [i] : []))
}

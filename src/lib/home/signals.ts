// Fork（#32）：「可以交給 Agent」的規則。純函式：輸入目前的 vault 狀態，輸出要提醒的事。
// 規格 personal/specs/11 §2.3；文字與預填指令在 messages 的 home.signals.<id>。

export interface SignalRules {
  overdue: { enabled: boolean; longDays: number }
  dailyNote: { enabled: boolean; afterHour: number; missingDays: number }
  inbox: { enabled: boolean; count: number; hours: number }
  linkless: { enabled: boolean; count: number }
  weeklyReview: { enabled: boolean; afterHour: number }
}

export const DEFAULT_SIGNAL_RULES: SignalRules = {
  overdue: { enabled: true, longDays: 3 },
  dailyNote: { enabled: true, afterHour: 18, missingDays: 3 },
  inbox: { enabled: true, count: 3, hours: 72 },
  linkless: { enabled: true, count: 5 },
  weeklyReview: { enabled: true, afterHour: 18 },
}

export type SignalId =
  | 'overdue'
  | 'overdueLong'
  | 'dailyNoteToday'
  | 'dailyNoteStreak'
  | 'inboxCount'
  | 'inboxOld'
  | 'linkless'
  | 'weeklyReview'

export interface Signal {
  id: SignalId
  /** 給 i18n 的參數；同一組參數也代入預填指令。 */
  values: Record<string, string | number>
}

export interface SignalInput {
  now: Date
  /** 逾期任務的到期日（YYYY-MM-DD）。 */
  overdueDues: string[]
  /** 某天（往前數 n 天，0 = 今天）有沒有寫每日筆記。 */
  hasDailyNote: (daysAgo: number) => boolean
  /** Inbox 資料夾裡的筆記與最後修改時間。 */
  inbox: { path: string; mtime: number }[]
  inboxFolder: string
  /** 沒有任何進出連結的筆記數。 */
  linklessCount: number
  /** 這週（ISO 週）已經有複盤筆記。 */
  weeklyReviewDone: boolean
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function daysLate(due: string, now: Date) {
  const start = new Date(`${due}T00:00:00`).getTime()
  const today = new Date(`${dateKey(now)}T00:00:00`).getTime()
  return Math.round((today - start) / DAY_MS)
}

/** ISO 週鍵，例如 2026-W44；用來認出本週的複盤筆記。 */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** 週五晚上（afterHour 之後）到週日整天。 */
function inWeeklyReviewWindow(now: Date, afterHour: number) {
  const day = now.getDay()
  return day === 6 || day === 0 || (day === 5 && now.getHours() >= afterHour)
}

export function evaluateSignals(input: SignalInput, rules: SignalRules): Signal[] {
  const { now } = input
  const out: Signal[] = []

  if (rules.overdue.enabled && input.overdueDues.length > 0) {
    out.push({ id: 'overdue', values: { count: input.overdueDues.length } })
    const long = input.overdueDues.filter(due => daysLate(due, now) > rules.overdue.longDays).length
    if (long > 0) out.push({ id: 'overdueLong', values: { count: long, days: rules.overdue.longDays } })
  }

  if (rules.dailyNote.enabled) {
    if (now.getHours() >= rules.dailyNote.afterHour && !input.hasDailyNote(0)) {
      out.push({ id: 'dailyNoteToday', values: { hour: rules.dailyNote.afterHour } })
    }
    const missing = rules.dailyNote.missingDays
    if (missing > 0) {
      let streak = 0
      for (let daysAgo = 1; daysAgo <= missing && !input.hasDailyNote(daysAgo); daysAgo++) streak++
      if (streak >= missing) out.push({ id: 'dailyNoteStreak', values: { days: missing } })
    }
  }

  if (rules.inbox.enabled && input.inbox.length > 0) {
    if (input.inbox.length >= rules.inbox.count) {
      out.push({ id: 'inboxCount', values: { count: input.inbox.length, folder: input.inboxFolder } })
    }
    const oldest = Math.min(...input.inbox.map(note => note.mtime || now.getTime()))
    const hours = Math.floor((now.getTime() - oldest) / HOUR_MS)
    if (hours >= rules.inbox.hours) {
      out.push({ id: 'inboxOld', values: { days: Math.floor(hours / 24), folder: input.inboxFolder } })
    }
  }

  if (rules.linkless.enabled && input.linklessCount >= rules.linkless.count) {
    out.push({ id: 'linkless', values: { count: input.linklessCount } })
  }

  if (rules.weeklyReview.enabled && !input.weeklyReviewDone && inWeeklyReviewWindow(now, rules.weeklyReview.afterHour)) {
    out.push({ id: 'weeklyReview', values: { week: isoWeekKey(now) } })
  }

  return out
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/** 讀回 store.json 的設定：缺的補預設、數字夾在合理範圍。 */
export function normalizeSignalRules(saved: unknown): SignalRules {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, Record<string, unknown> | undefined>
  const d = DEFAULT_SIGNAL_RULES
  const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
  return {
    overdue: { enabled: bool(s.overdue?.enabled, d.overdue.enabled), longDays: clampInt(s.overdue?.longDays, d.overdue.longDays, 1, 60) },
    dailyNote: {
      enabled: bool(s.dailyNote?.enabled, d.dailyNote.enabled),
      afterHour: clampInt(s.dailyNote?.afterHour, d.dailyNote.afterHour, 0, 23),
      missingDays: clampInt(s.dailyNote?.missingDays, d.dailyNote.missingDays, 0, 30),
    },
    inbox: {
      enabled: bool(s.inbox?.enabled, d.inbox.enabled),
      count: clampInt(s.inbox?.count, d.inbox.count, 1, 500),
      hours: clampInt(s.inbox?.hours, d.inbox.hours, 1, 24 * 60),
    },
    linkless: { enabled: bool(s.linkless?.enabled, d.linkless.enabled), count: clampInt(s.linkless?.count, d.linkless.count, 1, 10_000) },
    weeklyReview: { enabled: bool(s.weeklyReview?.enabled, d.weeklyReview.enabled), afterHour: clampInt(s.weeklyReview?.afterHour, d.weeklyReview.afterHour, 0, 23) },
  }
}

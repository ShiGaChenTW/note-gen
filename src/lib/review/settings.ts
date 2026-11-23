// Fork（almanac ALMNC-54.13）：調研與回顧的頻率（G 自我優化）。在 Agent 設定區設定，預設每週彙整一次，
// 由指揮官整理成一張「每週回顧」提案。
// 規格：almanac/2026-11-19_proposal_role-data-model.md 第四節「調研與回顧的頻率」、路由 R6。純函式＋注入的存檔。

export const REVIEW_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'off'] as const
export type ReviewFrequency = typeof REVIEW_FREQUENCIES[number]

export interface ReviewSettings {
  frequency: ReviewFrequency
  /** 每週、每兩週在星期幾彙整（0＝星期日，同 Date#getDay）。 */
  weekday: number
}

/** 預設：每週日彙整一次（整週的事都發生完）。 */
export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { frequency: 'weekly', weekday: 0 }

export const REVIEW_SETTINGS_KEY = 'almanacReviewSettings'
export const REVIEW_LAST_RUN_KEY = 'almanacReviewLastRun'

export function sanitizeReviewSettings(raw: unknown): ReviewSettings {
  const value = raw && typeof raw === 'object' ? raw as Partial<ReviewSettings> : {}
  const frequency = REVIEW_FREQUENCIES.includes(value.frequency as ReviewFrequency) ? value.frequency as ReviewFrequency : DEFAULT_REVIEW_SETTINGS.frequency
  const weekday = Number.isInteger(value.weekday) && value.weekday! >= 0 && value.weekday! <= 6 ? value.weekday! : DEFAULT_REVIEW_SETTINGS.weekday
  return { frequency, weekday }
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** 每兩週的基準：2026-01-04（星期日）所在的那一週算第 0 週。 */
const BIWEEKLY_ANCHOR = new Date(2026, 0, 4).getTime()
const DAY = 86_400_000

/** 最近一次（含今天）排定的彙整時間（當天 00:00）；關閉時回傳 undefined。 */
export function latestSlot(settings: ReviewSettings, now: Date): Date | undefined {
  const today = startOfDay(now)
  switch (settings.frequency) {
    case 'off': return undefined
    case 'daily': return today
    case 'monthly': return new Date(today.getFullYear(), today.getMonth(), 1)
    case 'weekly':
    case 'biweekly': {
      const back = (today.getDay() - settings.weekday + 7) % 7
      const slot = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)
      if (settings.frequency === 'weekly') return slot
      const weeks = Math.round((slot.getTime() - (BIWEEKLY_ANCHOR + settings.weekday * DAY)) / (7 * DAY))
      return ((weeks % 2) + 2) % 2 === 0 ? slot : new Date(slot.getFullYear(), slot.getMonth(), slot.getDate() - 7)
    }
  }
}

/** 到了該彙整的時候：最近一次排定的時間之後還沒跑過。 */
export function isReviewDue(settings: ReviewSettings, lastRunAt: number | undefined, now: Date): boolean {
  const slot = latestSlot(settings, now)
  if (!slot) return false
  return lastRunAt === undefined || lastRunAt < slot.getTime()
}

/** 這一次回顧涵蓋的期間：從上一次排定的時間到現在（第一次跑時往回推一個週期）。 */
export function reviewRange(settings: ReviewSettings, now: Date, lastRunAt?: number): { start: Date, end: Date } {
  const days = { daily: 1, weekly: 7, biweekly: 14, monthly: 31, off: 7 }[settings.frequency]
  const fallback = new Date(startOfDay(now).getTime() - (days - 1) * DAY)
  const start = lastRunAt !== undefined && lastRunAt > fallback.getTime() - days * DAY ? startOfDay(new Date(lastRunAt)) : fallback
  return { start, end: now }
}

export interface ReviewSettingsStore {
  load: () => Promise<{ settings: ReviewSettings, lastRunAt?: number }>
  save: (settings: ReviewSettings) => Promise<void>
  markRun: (at: number) => Promise<void>
}

/** 包一個鍵值存檔（store.json）。 */
export function keyValueSettingsStore(store: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> }): ReviewSettingsStore {
  return {
    load: async () => {
      const [raw, last] = await Promise.all([store.get(REVIEW_SETTINGS_KEY), store.get(REVIEW_LAST_RUN_KEY)])
      return { settings: sanitizeReviewSettings(raw), ...(typeof last === 'number' && Number.isFinite(last) ? { lastRunAt: last } : {}) }
    },
    save: settings => store.set(REVIEW_SETTINGS_KEY, sanitizeReviewSettings(settings)),
    markRun: at => store.set(REVIEW_LAST_RUN_KEY, at),
  }
}

/** App 用的存檔（Tauri store.json）。 */
export async function defaultReviewSettingsStore(): Promise<ReviewSettingsStore> {
  const { appStore } = await import('@/lib/cleanup/runtime')
  return keyValueSettingsStore(await appStore())
}

// ── 時期 ──────────────────────────────────────────────────────

export interface ReviewPeriod {
  /** 唯一鍵，例如 2026-W47、2026-11-21、2026-11。 */
  key: string
  month: number
  /** 這個月的第幾週（以期間開始那週的星期一為準）。 */
  week: number
  year: number
  start: Date
  end: Date
}

function isoWeek(date: Date): { year: number, week: number } {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return { year: target.getUTCFullYear(), week: Math.ceil(((target.getTime() - yearStart.getTime()) / DAY + 1) / 7) }
}

export function isoWeekKey(date: Date): string {
  const { year, week } = isoWeek(date)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** 卡片上的時期，例如「11 月第 3 週」：期間結束那天所在的週，以那週星期一的日期算第幾週。 */
export function reviewPeriod(settings: ReviewSettings, range: { start: Date, end: Date }): ReviewPeriod {
  const end = startOfDay(range.end)
  const monday = new Date(end.getFullYear(), end.getMonth(), end.getDate() - ((end.getDay() + 6) % 7))
  const pad = (n: number) => String(n).padStart(2, '0')
  const key = settings.frequency === 'daily'
    ? `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`
    : settings.frequency === 'monthly' ? `${end.getFullYear()}-${pad(end.getMonth() + 1)}` : isoWeekKey(end)
  return { key, year: monday.getFullYear(), month: monday.getMonth() + 1, week: Math.ceil(monday.getDate() / 7), start: range.start, end: range.end }
}

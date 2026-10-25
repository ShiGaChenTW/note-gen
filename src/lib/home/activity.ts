// Fork（#32）：本週足跡。只記「哪一天、哪個路徑、哪種事件」，不記內容；存在 app 端。
// 寫下＝新出現的筆記；修改＝修改時間變新；重讀＝打開一篇今天沒寫也沒改的筆記。

export type ActivityKind = 'created' | 'modified' | 'reread'

export interface ActivityLog {
  /** 鍵是 YYYY-MM-DD；同一天同一路徑同一種事件只算一次。 */
  days: Record<string, Partial<Record<ActivityKind, string[]>>>
}

export const KEEP_DAYS = 60

export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function emptyLog(): ActivityLog {
  return { days: {} }
}

export function normalizeLog(saved: unknown): ActivityLog {
  const days = (saved as ActivityLog | undefined)?.days
  if (!days || typeof days !== 'object') return emptyLog()
  const out: ActivityLog = { days: {} }
  for (const [key, value] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') continue
    const entry: Partial<Record<ActivityKind, string[]>> = {}
    for (const kind of ['created', 'modified', 'reread'] as const) {
      const list = (value as Record<string, unknown>)[kind]
      if (Array.isArray(list)) entry[kind] = list.filter((path): path is string => typeof path === 'string')
    }
    out.days[key] = entry
  }
  return out
}

export function recordActivity(log: ActivityLog, kind: ActivityKind, path: string, now: Date): ActivityLog {
  const key = dayKey(now)
  const day = log.days[key] ?? {}
  const list = day[kind] ?? []
  if (list.includes(path)) return log
  if (kind === 'reread' && (day.created?.includes(path) || day.modified?.includes(path))) return log
  return { days: { ...log.days, [key]: { ...day, [kind]: [...list, path] } } }
}

/** 只留最近 KEEP_DAYS 天。 */
export function pruneLog(log: ActivityLog, now: Date): ActivityLog {
  const cutoff = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - KEEP_DAYS))
  const days = Object.fromEntries(Object.entries(log.days).filter(([key]) => key >= cutoff))
  return Object.keys(days).length === Object.keys(log.days).length ? log : { days }
}

/**
 * 比對兩次索引快照（路徑 → 修改時間）找出寫下與修改。
 * prev 為 null 表示第一次載入，不算任何事件。
 */
export function diffSnapshots(prev: Map<string, number> | null, next: Map<string, number>): { created: string[]; modified: string[] } {
  if (!prev) return { created: [], modified: [] }
  const created: string[] = []
  const modified: string[] = []
  for (const [path, mtime] of next) {
    const before = prev.get(path)
    if (before === undefined) created.push(path)
    else if (mtime > before) modified.push(path)
  }
  return { created, modified }
}

export interface WeekDay {
  date: string
  created: number
  modified: number
  reread: number
}

/** 本週（週一開始）每天的次數。 */
export function weekCounts(log: ActivityLog, now: Date): WeekDay[] {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => {
    const date = dayKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))
    const day = log.days[date] ?? {}
    return { date, created: day.created?.length ?? 0, modified: day.modified?.length ?? 0, reread: day.reread?.length ?? 0 }
  })
}

/**
 * D3 日記導航：前一篇／後一篇日記、月曆上哪些日子有日記。純函式、無 I/O。
 */

import { parseDailyNotePath, toDateKey } from './format'

/** vault 內所有日記的日期（`YYYY-MM-DD`）。 */
export function dailyNoteDateKeys(paths: Iterable<string>, folder: string, pattern: string): Set<string> {
  const keys = new Set<string>()
  for (const path of paths) {
    const date = parseDailyNotePath(path, folder, pattern)
    if (date) keys.add(toDateKey(date))
  }
  return keys
}

export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * 從 current 往前（-1）或往後（1）找下一篇日記，跳過沒有日記的日子。
 * 往今天的方向走、中間又沒有日記時停在今天（今天的日記不存在也一樣，由呼叫端建立）。
 * 沒有下一篇時回傳 null。
 */
export function stepDailyDate(current: Date, direction: -1 | 1, existing: ReadonlySet<string>, today: Date): Date | null {
  const from = toDateKey(current)
  const todayKey = toDateKey(today)
  const sorted = [...existing].sort()
  const found = direction === 1
    ? sorted.find(key => key > from)
    : [...sorted].reverse().find(key => key < from)

  if (direction === 1 && from < todayKey && (!found || found > todayKey)) return dateFromKey(todayKey)
  if (direction === -1 && from > todayKey && (!found || found < todayKey)) return dateFromKey(todayKey)
  return found ? dateFromKey(found) : null
}

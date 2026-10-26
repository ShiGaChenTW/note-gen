// Fork（UI 一致性）：清單裡的時間一律 24 小時制。
// Intl 的 hour: '2-digit' 在繁中會用 12 小時制，顯示成「清晨07:11」「凌晨02:29」，跟首頁的「18:46」不一致。

/** 時:分（24 小時制）。 */
export function formatClock(value: number | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value)
}

/** 清單用：今天顯示時:分，其他日子顯示月日。 */
export function formatListTime(value: number, locale: string, now = new Date()): string {
  const date = new Date(value)
  if (date.toDateString() === now.toDateString()) return formatClock(date, locale)
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
}

import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { isoWeek } from '@/lib/today-v3/layout'

function formatDateRange(start: Date, end: Date) {
  const startYear = start.getFullYear()
  const endYear = end.getFullYear()
  const startMonth = start.getMonth() + 1
  const endMonth = end.getMonth() + 1
  const startDay = start.getDate()
  const endDay = end.getDate()
  const padded = (value: number) => String(value).padStart(2, '0')

  if (startYear !== endYear) {
    return `${startYear}/${padded(startMonth)}/${padded(startDay)} – ${endYear}/${padded(endMonth)}/${padded(endDay)}`
  }
  if (startMonth !== endMonth) {
    return `${startMonth}/${startDay} – ${padded(endMonth)}/${padded(endDay)}`
  }
  return `${startMonth}/${startDay}–${endDay}`
}

/** Format local calendar dates with the active app locale. */
export function createDateFormats(locale: string, formatWeekNumber: (week: number) => string) {
  const monthDay = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const month = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' })
  const short = new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' })
  const dayNumber = new Intl.NumberFormat(locale, { useGrouping: false })
  const isChinese = new Intl.Locale(locale).language === 'zh'
  const full = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short' })

  return {
    full: (date: Date) => isChinese ? `${monthDay.format(date)} ${weekday.format(date)}` : full.format(date),
    monthDay: monthDay.format,
    month: month.format,
    weekday: weekday.format,
    dayNumber: (date: Date) => dayNumber.format(date.getDate()),
    short: short.format,
    range: formatDateRange,
    week: (date: Date) => formatWeekNumber(isoWeek(date)),
  }
}

export function useDateFormats() {
  const locale = useLocale()
  const t = useTranslations('dateNavigation')
  return useMemo(() => createDateFormats(locale, week => t('weekNumber', { week })), [locale, t])
}

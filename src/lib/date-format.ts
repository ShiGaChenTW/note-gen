import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { isoWeek } from '@/lib/today-v3/layout'

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
    range: (start: Date, end: Date) => monthDay.formatRange(start, end),
    shortRange: (start: Date, end: Date) => `${short.format(start)} – ${short.format(end)}`,
    week: (date: Date) => formatWeekNumber(isoWeek(date)),
  }
}

export function useDateFormats() {
  const locale = useLocale()
  const t = useTranslations('dateNavigation')
  return useMemo(() => createDateFormats(locale, week => t('weekNumber', { week })), [locale, t])
}

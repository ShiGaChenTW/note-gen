import { createTranslator } from 'next-intl'
import { expect, it } from 'vitest'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'
import zhTW from '../../messages/zh-TW.json'
import { createDateFormats } from './date-format'

const thursday = new Date(2026, 10, 19)

it.each([
  ['zh-TW', zhTW, ['11月19日 週四', '2026年11月', '週四 19', '11/19', '第 47 週', '11月19日']],
  ['zh', zh, ['11月19日 周四', '2026年11月', '周四 19', '11/19', '第 47 周', '11月19日']],
  ['en', en, ['Thu, Nov 19', 'November 2026', 'Thu 19', '11/19', 'W47', 'Nov 19']],
] as const)('formats local calendar dates in %s', (locale, messages, expected) => {
  const t = createTranslator({ locale, messages, namespace: 'dateNavigation' })
  const formats = createDateFormats(locale, week => t('weekNumber', { week }))
  expect([
    formats.full(thursday), formats.month(thursday), formats.weekday(thursday) + ' ' + formats.dayNumber(thursday),
    formats.short(thursday), formats.week(thursday), formats.monthDay(thursday),
  ]).toEqual(expected)
  expect(formats.week(new Date(2027, 0, 1))).toBe(t('weekNumber', { week: 53 }))
})

it.each([
  [new Date(2026, 10, 16), new Date(2026, 10, 22), '11/16–22'],
  [new Date(2026, 10, 30), new Date(2026, 11, 6), '11/30 – 12/06'],
  [new Date(2026, 11, 28), new Date(2027, 0, 3), '2026/12/28 – 2027/01/03'],
] as const)('formats the local date range from %s to %s as %s', (start, end, expected) => {
  for (const locale of ['zh-TW', 'zh', 'en']) {
    expect(createDateFormats(locale, String).range(start, end)).toBe(expected)
  }
})

// Fork（almanac ALMNC-54.8）：decide 這一項打開的是工作台頁（workbench.title）。
it.each([en, zh, zhTW])('matches the six v3 page titles to their navigation labels', messages => {
  const { today, decide, collect, threads, knowledge, plan } = messages.sidebarV3.nav
  expect([
    messages.todayV3.title, messages.workbench.title, messages.collect.title,
    messages.threads.title, messages.sidebarV3.knowledge.title, messages.week.title,
  ]).toEqual([today, decide, collect, threads, knowledge, plan])
})

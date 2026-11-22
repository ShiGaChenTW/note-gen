// Fork（almanac ALMNC-49）：休眠畫面上的固定文字。字串放在 messages/*.json 的 eink.sleep（zh-TW／zh／en 同一組鍵），
// 「私人行程」沿用 eink.briefing.privateLabel。取原始樣板，由 epub/texts.ts 的 fill() 代入參數。
import type { AbstractIntlMessages } from 'next-intl'
import { rawTexts } from '@/lib/eink/epub/texts'

export const SLEEP_TEXT_KEYS = [
  'updatedAt', 'weatherTitle', 'scheduleTitle', 'reviewTitle', 'allDay', 'more', 'highLow', 'precipitation',
  'hintPages', 'hintNew', 'hintArticles', 'hintPinned', 'hintReview', 'hintReport', 'hintNone',
] as const
export type SleepTextKey = typeof SLEEP_TEXT_KEYS[number]

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export type SleepTexts = Record<SleepTextKey, string> & {
  /** 星期日到星期六（Date.getDay() 的順序） */
  weekdays: string[]
  privateLabel: string
  dayParts: Record<'morning' | 'noon' | 'evening' | 'night', string>
}

export function sleepTextsFromMessages(messages: AbstractIntlMessages, locale: string): SleepTexts {
  const base = rawTexts(messages, locale, 'eink.sleep', SLEEP_TEXT_KEYS)
  const weekdays = rawTexts(messages, locale, 'eink.sleep.weekdays', WEEKDAY_KEYS)
  const briefing = rawTexts(messages, locale, 'eink.briefing', ['privateLabel'] as const)
  const dayParts = rawTexts(messages, locale, 'eink.briefing.dayParts', ['morning', 'noon', 'evening', 'night'] as const)
  return { ...base, weekdays: WEEKDAY_KEYS.map(key => weekdays[key]), privateLabel: briefing.privateLabel, dayParts }
}

export async function loadSleepTexts(): Promise<SleepTexts> {
  const { DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, loadMessagesWithFallback, normalizeLocale } = await import('@/i18n/config')
  let locale = DEFAULT_LOCALE
  try {
    locale = normalizeLocale(typeof window === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY))
  } catch {
    // 沒有 localStorage（測試、背景）就用預設語系
  }
  return sleepTextsFromMessages(await loadMessagesWithFallback(locale), locale)
}

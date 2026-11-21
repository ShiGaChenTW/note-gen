// Fork（almanac ALMNC-47）：今日簡報的章節標題與說明文字。字串放在 messages/*.json 的 eink.briefing（zh-TW／zh／en 同一組鍵），
// 組裝時由呼叫端給定目前語系的文字；純函式不碰語系設定。
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import type { ChapterKind, DayPart } from './types'

export const BRIEFING_NOTE_KEYS = [
  'calendarDenied',
  'calendarDeniedEmpty',
  'scheduleEmpty',
  'scheduleError',
  'weatherUnavailable',
  'weatherNoCity',
  'workbenchEmpty',
  'workbenchError',
] as const
export type BriefingNoteKey = typeof BRIEFING_NOTE_KEYS[number]

export interface BriefingTexts {
  chapters: Record<ChapterKind, string>
  notes: Record<BriefingNoteKey, string>
  dayParts: Record<DayPart, string>
  /** 休眠畫面上私人行程顯示的字（今日簡報照樣顯示完整標題） */
  privateLabel: string
}

const CHAPTERS: ChapterKind[] = ['schedule', 'weather', 'pinned', 'articles', 'review', 'report', 'workbench']
const DAY_PARTS: DayPart[] = ['morning', 'noon', 'evening', 'night']

/** 從 messages 物件取出 eink.briefing 的文字。 */
export function briefingTextsFromMessages(messages: AbstractIntlMessages, locale: string): BriefingTexts {
  const t = createTranslator({ locale, messages, namespace: 'eink.briefing' }) as unknown as (key: string) => string
  return {
    chapters: Object.fromEntries(CHAPTERS.map(kind => [kind, t(`chapters.${kind}`)])) as Record<ChapterKind, string>,
    notes: Object.fromEntries(BRIEFING_NOTE_KEYS.map(key => [key, t(`notes.${key}`)])) as Record<BriefingNoteKey, string>,
    dayParts: Object.fromEntries(DAY_PARTS.map(part => [part, t(`dayParts.${part}`)])) as Record<DayPart, string>,
    privateLabel: t('privateLabel'),
  }
}

/** 讀目前介面語系的文字（app 內用；讀不到語系時退回預設語系）。 */
export async function loadBriefingTexts(): Promise<BriefingTexts> {
  const { DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, loadMessagesWithFallback, normalizeLocale } = await import('@/i18n/config')
  let locale = DEFAULT_LOCALE
  try {
    locale = normalizeLocale(typeof window === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY))
  } catch {
    // 沒有 localStorage（測試、背景）就用預設語系
  }
  return briefingTextsFromMessages(await loadMessagesWithFallback(locale), locale)
}

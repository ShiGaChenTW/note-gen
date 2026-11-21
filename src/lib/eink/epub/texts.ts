// Fork（almanac ALMNC-48）：今日簡報 EPUB 裡的固定文字（目錄、附錄、「續讀見附錄」、精簡說明…）。
// 字串放在 messages/*.json 的 eink.epub（zh-TW／zh／en 同一組鍵）；這裡只取出原始樣板，
// 由 fill() 代入 {name} 參數，純函式不碰語系設定（跟 briefing/texts.ts 同一個做法）。
import { createTranslator, type AbstractIntlMessages } from 'next-intl'

export const EPUB_TEXT_KEYS = [
  'bookTitle', 'tocTitle', 'appendixTitle', 'continueInAppendix', 'continuedFrom', 'source', 'author', 'allDay', 'calendarLabel',
  'pinnedInAppendix', 'pinnedMissing', 'reviewFrom', 'reportPeriod', 'reportStats', 'reportSuggestions', 'reportTopics',
  'reportOneLine', 'workbenchDecide', 'workbenchComplete', 'workbenchMore', 'overdue', 'due', 'high', 'low', 'precipitation',
  'imageAlt', 'trimmedTitle', 'trimmedArticle', 'trimmedArticleStub', 'trimmedReview', 'trimmedReviewNote', 'trimmedReport',
  'trimmedReportNote', 'trimmedPin', 'trimmedPinStub', 'trimmedImages', 'trimmedImageNote',
] as const
export type EpubTextKey = typeof EPUB_TEXT_KEYS[number]
export type EpubTexts = Record<EpubTextKey, string>

/** 把樣板裡的 {name} 換成值；沒給的參數保留原樣。 */
export function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match))
}

type RawTranslator = { raw: (key: string) => unknown }

/** 從 messages 取出 namespace 底下 keys 的原始樣板。 */
export function rawTexts<K extends string>(messages: AbstractIntlMessages, locale: string, namespace: string, keys: readonly K[]): Record<K, string> {
  const t = createTranslator({ locale, messages, namespace }) as unknown as RawTranslator
  return Object.fromEntries(keys.map(key => [key, String(t.raw(key))])) as Record<K, string>
}

export function epubTextsFromMessages(messages: AbstractIntlMessages, locale: string): EpubTexts {
  return rawTexts(messages, locale, 'eink.epub', EPUB_TEXT_KEYS)
}

/** 介面語系 → EPUB 的語言標籤（dc:language、xml:lang）。 */
export function epubLanguage(locale: string): string {
  if (locale === 'zh-TW') return 'zh-Hant-TW'
  if (locale === 'zh') return 'zh-Hans'
  return locale || 'en'
}

/** 讀目前介面語系的文字（app 內用）。 */
export async function loadEpubTexts(): Promise<{ texts: EpubTexts, locale: string }> {
  const { DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, loadMessagesWithFallback, normalizeLocale } = await import('@/i18n/config')
  let locale = DEFAULT_LOCALE
  try {
    locale = normalizeLocale(typeof window === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY))
  } catch {
    // 沒有 localStorage（測試、背景）就用預設語系
  }
  return { texts: epubTextsFromMessages(await loadMessagesWithFallback(locale), locale), locale }
}

// Fork（almanac ALMNC-49）：休眠畫面的對外入口。
//   buildSleepBmp(briefing, input)  Briefing（ALMNC-47）→ 排版（layout.ts，純函式）→ canvas → 4 階灰 → BMP
//   buildTodaySleepBmp(date)        app 內：讀今天的簡報、順便算今日簡報頁數，產生 sleep.bmp
// 區網下載（ALMNC-50）與立即推送（ALMNC-52）讀這裡的結果；這張票不做 UI 也不開服務。
import type { Briefing } from '@/lib/eink/briefing/types'
import { encodeBmp } from './bmp'
import { layoutSleepScreen, type SleepInput, type SleepLayout } from './layout'
import { SLEEP_BMP_BIT_DEPTH, type BmpBitDepth } from './params'
import { rasterizeSleepLayout } from './render'

export { layoutSleepScreen } from './layout'
export { encodeBmp, readBmpHeader } from './bmp'
export { SLEEP_BMP_BIT_DEPTH, SLEEP_HEIGHT, SLEEP_WIDTH } from './params'

export const SLEEP_FILE_NAME = 'sleep.bmp'

export interface SleepBmp {
  bytes: Uint8Array
  layout: SleepLayout
  levels: Uint8Array
}

export async function buildSleepBmp(briefing: Briefing, input: SleepInput, bitDepth: BmpBitDepth = SLEEP_BMP_BIT_DEPTH): Promise<SleepBmp> {
  const layout = layoutSleepScreen(briefing, input)
  const levels = await rasterizeSleepLayout(layout)
  return { bytes: encodeBmp(levels, layout.width, layout.height, bitDepth), layout, levels }
}

/** app 內：產生 date 那天的休眠畫面（只讀，不把任何東西標成已送）。 */
export async function buildTodaySleepBmp(date: Date = new Date(), now: number = Date.now()): Promise<SleepBmp> {
  const [{ buildBriefing }, { loadBriefingTexts }, { loadSleepTexts }, epub] = await Promise.all([
    import('@/lib/eink/briefing'), import('@/lib/eink/briefing/texts'), import('./texts'), import('@/lib/eink/epub'),
  ])
  const briefingTexts = await loadBriefingTexts()
  const [briefing, texts, { texts: epubTexts, locale }] = await Promise.all([
    buildBriefing(date, undefined, briefingTexts), loadSleepTexts(), import('@/lib/eink/epub/texts').then(m => m.loadEpubTexts()),
  ])
  // 頁數用不抓圖的 EPUB 估（快，而且圖片頁數影響不大）
  const pages = epub.fitBriefingEpub(briefing, new Map(), { texts: epubTexts, locale, dayParts: briefingTexts.dayParts, generatedAt: now }).pages
  return buildSleepBmp(briefing, { updatedAt: now, texts, briefingPages: pages })
}

/**
 * 開發預覽（不進 production）：在開發者工具執行 `await window.__almanacSleepPreview()`，
 * 下載今天的 sleep.bmp。只讀。
 */
export function registerSleepPreview(): void {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return
  ;(window as unknown as { __almanacSleepPreview?: (date?: string) => Promise<unknown> }).__almanacSleepPreview = async (date?: string) => {
    const bmp = await buildTodaySleepBmp(date ? new Date(`${date}T12:00:00`) : new Date())
    const url = URL.createObjectURL(new Blob([bmp.bytes.slice().buffer], { type: 'image/bmp' }))
    const a = document.createElement('a')
    a.href = url
    a.download = SLEEP_FILE_NAME
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return { size: bmp.bytes.length }
  }
}

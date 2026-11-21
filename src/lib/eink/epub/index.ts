// Fork（almanac ALMNC-48）：今日簡報 EPUB 產生器的對外入口。
//   buildBriefingEpub(briefing, options)  Briefing（ALMNC-47）→ EPUB 位元組，保證不超過大小上限（盡力，見 overLimit）
//   fitBriefingEpub(...)                  同上但同步、圖片已經準備好（測試與預覽用）
//   buildTodayEpub(date)                  app 內：讀今天的簡報、抓圖、產生 EPUB
// 區網下載（ALMNC-50）與立即推送（ALMNC-52）讀這裡的結果；這張票不做 UI 也不開服務。
//
// 大小上限的精簡順序（AC #2，依序累加，壓到上限以下就停）：
//   1. 附錄裡的文章續讀全文，最早存的文章先砍
//   2. 每日回顧卡減成 1 張
//   3. 知識報告只留一句話
// AC 三步之後仍太大時（例如文章圖片很多），再依序：
//   4. 附錄裡舊釘選資料的全文（照釘選順序）
//   5. 精選文章的圖片全部拿掉
// 行程、天氣、當天釘選資料、工作台摘要永遠不砍；只剩這些還超過時回傳 overLimit: true，由呼叫端決定（不擋產生）。
import type { Briefing, DayPart } from '@/lib/eink/briefing/types'
import { EMPTY_TRIM, renderBook, splitArticles, trimNotices, type EpubImageAsset, type TrimPlan } from './document'
import { fetchImageWithTauri, shrinkImageForEink, type RawImage } from './images'
import { markdownImageUrls } from './markdown'
import { packageEpub } from './package'
import { DEFAULT_PAGE_BUDGET, type PageBudget } from './pages'
import { ARTICLE_MAX_PAGES, EPUB_MAX_BYTES, EPUB_MAX_IMAGES_PER_ARTICLE } from './params'
import { epubLanguage, type EpubTexts } from './texts'

export type { Book, EpubImageAsset, TrimPlan } from './document'
export { EPUB_MAX_BYTES } from './params'

export function epubFileName(date: string): string {
  return `almanac-${date}.epub`
}

export interface FitOptions {
  texts: EpubTexts
  locale: string
  /** 天氣四格的時段名稱（BriefingTexts.dayParts） */
  dayParts?: Record<DayPart, string>
  /** 產生時間（毫秒）；預設現在 */
  generatedAt?: number
  maxBytes?: number
  budget?: PageBudget
  articleMaxPages?: number
}

export interface BriefingEpub {
  fileName: string
  bytes: Uint8Array
  /** 估計頁數（休眠畫面底部提示用） */
  pages: number
  /** 為了壓進上限精簡了什麼 */
  trim: TrimPlan
  /** 簡報目錄頁上的精簡說明 */
  notices: string[]
  /** 不能砍的內容本身就超過上限 */
  overLimit: boolean
}

type TrimStep = (plan: TrimPlan) => TrimPlan

/** 依 AC #2 的順序列出可以做的精簡步驟（只列今天的內容真的用得到的）。 */
export function trimSteps(briefing: Briefing, images: ReadonlyMap<string, EpubImageAsset>, maxPages = ARTICLE_MAX_PAGES, budget: PageBudget = DEFAULT_PAGE_BUDGET): TrimStep[] {
  const steps: TrimStep[] = []
  const parts = splitArticles(briefing, maxPages, budget)
  const withRest = parts
    .filter(part => part.rest !== null)
    .sort((a, b) => a.article.addedAt - b.article.addedAt || (a.article.url < b.article.url ? -1 : 1))
  for (const part of withRest) steps.push(plan => ({ ...plan, droppedArticleRest: [...plan.droppedArticleRest, part.article.url] }))
  const review = briefing.chapters.find(chapter => chapter.kind === 'review')
  if (review && review.kind === 'review' && review.items.length > 1) steps.push(plan => ({ ...plan, reviewOne: true }))
  const report = briefing.chapters.find(chapter => chapter.kind === 'report')
  if (report && report.kind === 'report' && report.report) steps.push(plan => ({ ...plan, reportOneLine: true }))
  for (const entry of briefing.appendix) steps.push(plan => ({ ...plan, droppedPinAppendix: [...plan.droppedPinAppendix, entry.id] }))
  if (images.size > 0) steps.push(plan => ({ ...plan, dropImages: true }))
  return steps
}

/** 圖片已經準備好時的同步版本：排版 → 打包 → 太大就照順序精簡再打包。 */
export function fitBriefingEpub(briefing: Briefing, images: ReadonlyMap<string, EpubImageAsset>, options: FitOptions): BriefingEpub {
  const maxBytes = options.maxBytes ?? EPUB_MAX_BYTES
  const generatedAt = options.generatedAt ?? Date.now()
  const lang = epubLanguage(options.locale)
  const render = (plan: TrimPlan) => {
    const book = renderBook(briefing, {
      texts: options.texts, lang, images, plan, generatedAt, budget: options.budget, articleMaxPages: options.articleMaxPages,
    }, options.dayParts ?? null)
    return { book, bytes: packageEpub(book) }
  }
  let plan = EMPTY_TRIM
  let result = render(plan)
  for (const step of trimSteps(briefing, images, options.articleMaxPages, options.budget)) {
    if (result.bytes.length <= maxBytes) break
    plan = step(plan)
    result = render(plan)
  }
  return {
    fileName: epubFileName(briefing.date),
    bytes: result.bytes,
    pages: result.book.pages,
    trim: plan,
    notices: trimNotices(plan, briefing, options.texts),
    overLimit: result.bytes.length > maxBytes,
  }
}

export interface BuildOptions extends FitOptions {
  /** 下載圖片；預設用 Tauri http plugin */
  loadImage?: (url: string) => Promise<RawImage | null>
  /** 縮圖＋灰階＋JPEG；預設用 canvas（webview） */
  shrinkImage?: (bytes: Uint8Array, mediaType: string) => Promise<RawImage | null>
  maxImagesPerArticle?: number
}

/** 抓精選文章裡的圖並轉好（每篇最多 maxImagesPerArticle 張；抓不到的略過，簡報裡顯示替代文字）。 */
export async function prepareImages(
  briefing: Briefing,
  loadImage: (url: string) => Promise<RawImage | null>,
  shrinkImage: (bytes: Uint8Array, mediaType: string) => Promise<RawImage | null>,
  maxImagesPerArticle = EPUB_MAX_IMAGES_PER_ARTICLE,
): Promise<Map<string, EpubImageAsset>> {
  const urls: string[] = []
  for (const chapter of briefing.chapters) {
    if (chapter.kind !== 'articles') continue
    for (const article of chapter.items) {
      const own = markdownImageUrls(article.content).filter(url => /^https?:\/\//i.test(url)).slice(0, maxImagesPerArticle)
      for (const url of own) if (!urls.includes(url)) urls.push(url)
    }
  }
  const converted = await Promise.all(urls.map(async url => {
    try {
      const raw = await loadImage(url)
      return raw ? await shrinkImage(raw.bytes, raw.mediaType) : null
    } catch {
      return null
    }
  }))
  const images = new Map<string, EpubImageAsset>()
  converted.forEach((image, i) => {
    if (!image) return
    const ext = image.mediaType === 'image/png' ? 'png' : 'jpg'
    images.set(urls[i], { href: `images/img-${String(images.size + 1).padStart(3, '0')}.${ext}`, bytes: image.bytes, mediaType: image.mediaType })
  })
  return images
}

export async function buildBriefingEpub(briefing: Briefing, options: BuildOptions): Promise<BriefingEpub> {
  const images = await prepareImages(
    briefing,
    options.loadImage ?? fetchImageWithTauri,
    options.shrinkImage ?? ((bytes, mediaType) => shrinkImageForEink(bytes, mediaType)),
    options.maxImagesPerArticle,
  )
  return fitBriefingEpub(briefing, images, options)
}

/** app 內：產生 date 那天的今日簡報 EPUB（只讀，不把任何東西標成已送）。 */
export async function buildTodayEpub(date: Date = new Date()): Promise<BriefingEpub> {
  const [{ buildBriefing }, { loadBriefingTexts }, { loadEpubTexts }] = await Promise.all([
    import('@/lib/eink/briefing'), import('@/lib/eink/briefing/texts'), import('./texts'),
  ])
  const briefingTexts = await loadBriefingTexts()
  const [briefing, { texts, locale }] = await Promise.all([buildBriefing(date, undefined, briefingTexts), loadEpubTexts()])
  return buildBriefingEpub(briefing, { texts, locale, dayParts: briefingTexts.dayParts })
}

/**
 * 開發預覽（不進 production）：在開發者工具執行 `await window.__almanacEpubPreview()`，
 * 下載今天的 almanac-YYYY-MM-DD.epub 並回傳大小、頁數與精簡說明。只讀。
 */
export function registerEpubPreview(): void {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return
  ;(window as unknown as { __almanacEpubPreview?: (date?: string) => Promise<unknown> }).__almanacEpubPreview = async (date?: string) => {
    const epub = await buildTodayEpub(date ? new Date(`${date}T12:00:00`) : new Date())
    const url = URL.createObjectURL(new Blob([epub.bytes.slice().buffer], { type: 'application/epub+zip' }))
    const a = document.createElement('a')
    a.href = url
    a.download = epub.fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return { fileName: epub.fileName, size: epub.bytes.length, pages: epub.pages, notices: epub.notices, overLimit: epub.overLimit }
  }
}

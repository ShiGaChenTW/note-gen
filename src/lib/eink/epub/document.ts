// Fork（almanac ALMNC-48）：今日簡報（Briefing，ALMNC-47）→ EPUB 的各個 XHTML 文件與目錄。純函式、無 I/O。
// 章節順序照 briefing.chapters；天氣併進「今天行程」那一章的開頭（計畫 v2：今天行程開頭一行天氣），
// 所以今天行程永遠是第 1 章，休眠畫面的「見簡報第 1 章」才對得上。
// 精簡（TrimPlan）只影響附錄的文章全文、回顧卡張數、知識報告、舊釘選的附錄全文、文章圖片；
// 行程、天氣、當天釘選資料、工作台摘要不在可精簡的範圍（AC #2）。
import type {
  ArticleItem, ArticlesChapter, Briefing, BriefingChapter, PinnedChapter, ReportChapter, ReviewChapter, ScheduleChapter,
  ScheduleItem, WeatherChapter, WeatherData, WorkbenchChapter,
} from '@/lib/eink/briefing/types'
import { escapeXml, markdownToXhtml, type MarkdownContext } from './markdown'
import { DEFAULT_PAGE_BUDGET, textUnits, truncateMarkdown, type PageBudget } from './pages'
import { ARTICLE_MAX_PAGES } from './params'
import { fill, type EpubTexts } from './texts'

export interface EpubImageAsset {
  /** EPUB 裡的路徑（相對於 OEBPS/），例如 images/img-001.jpg */
  href: string
  bytes: Uint8Array
  mediaType: string
}

/** 為了壓進大小上限而精簡的內容（依序累加，見 index.ts 的 TRIM_ORDER）。 */
export interface TrimPlan {
  /** 附錄裡續讀全文被拿掉的文章（url） */
  droppedArticleRest: string[]
  /** 回顧卡減成 1 張 */
  reviewOne: boolean
  /** 知識報告只留一句話 */
  reportOneLine: boolean
  /** 附錄裡被拿掉全文的舊釘選資料（appendix id）；超出 AC 三步仍太大時才用 */
  droppedPinAppendix: string[]
  /** 精選文章的圖片全部拿掉；最後手段 */
  dropImages: boolean
}

export const EMPTY_TRIM: TrimPlan = { droppedArticleRest: [], reviewOne: false, reportOneLine: false, droppedPinAppendix: [], dropImages: false }

export interface TocEntry {
  label: string
  href: string
  children?: TocEntry[]
}

export interface BookDoc {
  id: string
  href: string
  title: string
  xhtml: string
}

export interface Book {
  title: string
  lang: string
  identifier: string
  /** dcterms:modified，CCYY-MM-DDThh:mm:ssZ */
  modified: string
  /** nav.xhtml（目錄頁，也放進書脊當第一頁） */
  nav: string
  docs: BookDoc[]
  toc: TocEntry[]
  /** 這次內容實際用到的圖片 */
  images: EpubImageAsset[]
  /** 估計頁數（每份文件從新的一頁開始） */
  pages: number
}

export interface RenderOptions {
  texts: EpubTexts
  /** EPUB 語言標籤（epubLanguage(locale)） */
  lang: string
  /** 圖片網址 → 已轉好的圖檔（index.ts 先抓好、縮好） */
  images: ReadonlyMap<string, EpubImageAsset>
  plan: TrimPlan
  /** 產生時間（毫秒）；寫進 dcterms:modified */
  generatedAt: number
  budget?: PageBudget
  articleMaxPages?: number
}

/** 精選文章截斷後的結果；index.ts 也用它決定精簡順序。 */
export interface ArticlePart {
  article: ArticleItem
  head: string
  rest: string | null
}

export function splitArticles(briefing: Briefing, maxPages = ARTICLE_MAX_PAGES, budget: PageBudget = DEFAULT_PAGE_BUDGET): ArticlePart[] {
  const chapter = briefing.chapters.find((c): c is ArticlesChapter => c.kind === 'articles')
  if (!chapter) return []
  return chapter.items.map(article => ({ article, ...truncateMarkdown(article.content, maxPages, budget) }))
}

// ---------- 小工具 ----------

const pad = (n: number) => String(n).padStart(2, '0')

export function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function timeRange(item: ScheduleItem, texts: EpubTexts): string {
  if (item.allDay) return texts.allDay
  return item.end > item.start ? `${hhmm(item.start)}–${hhmm(item.end)}` : hhmm(item.start)
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\.md$/, '')
}

function stripTags(xhtml: string): string {
  return xhtml.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ')
}

function xhtmlDocument(lang: string, title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}">
<head>
<meta charset="UTF-8" />
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
${body}
</body>
</html>
`
}

function chapterHeading(no: number, title: string): string {
  return `<h1><span class="no">§${pad(no)}</span> ${escapeXml(title)}</h1>`
}

function noteParagraph(note: string | undefined): string {
  return note ? `<p class="note">${escapeXml(note)}</p>\n` : ''
}

// ---------- 各章 ----------

interface Ctx {
  options: RenderOptions
  texts: EpubTexts
  /** wikilink 名稱 → href */
  links: Map<string, string>
  /** 用到的圖片 */
  usedImages: Map<string, EpubImageAsset>
}

function markdownContext(ctx: Ctx, allowImages: boolean): MarkdownContext {
  const { texts, options } = ctx
  return {
    resolveWikilink: target => ctx.links.get(normalizeName(target)) ?? ctx.links.get(normalizeName(target.split('/').pop() ?? target)) ?? null,
    resolveImage: src => {
      if (!allowImages || options.plan.dropImages) return null
      const asset = options.images.get(src)
      if (!asset) return null
      ctx.usedImages.set(asset.href, asset)
      return asset.href
    },
    imageFallback: alt => (allowImages && options.plan.dropImages ? texts.trimmedImageNote : alt.trim() ? `［${alt.trim()}］` : texts.imageAlt),
  }
}

function weatherBlock(weather: WeatherChapter, texts: EpubTexts, dayParts: Record<string, string> | null): string {
  if (!weather.weather) return `<section class="weather" id="weather">\n${noteParagraph(weather.note)}</section>\n`
  const w: WeatherData = weather.weather
  const summary = [w.location, fill(texts.high, { value: w.high }), fill(texts.low, { value: w.low }), fill(texts.precipitation, { value: w.precipitationProbability })]
    .filter(Boolean)
    .map(escapeXml)
    .join(' · ')
  const cells = w.parts.map(part => (
    `<tr><th>${escapeXml(dayParts?.[part.part] ?? part.part)}</th><td class="num">${part.temperature}°</td><td class="num">${escapeXml(fill(texts.precipitation, { value: part.precipitationProbability }))}</td></tr>`
  )).join('\n')
  return `<section class="weather" id="weather">
<p class="meta">${summary}</p>
${cells ? `<table class="weather-parts">\n${cells}\n</table>` : ''}
</section>
`
}

function scheduleBody(chapter: ScheduleChapter | null, weather: WeatherChapter | null, texts: EpubTexts, dayParts: Record<string, string> | null): string {
  let body = ''
  if (weather) body += weatherBlock(weather, texts, dayParts)
  if (!chapter) return body
  body += noteParagraph(chapter.note)
  if (chapter.items.length) {
    const rows = chapter.items.map(item => {
      const meta = [item.location, item.source].filter((part): part is string => Boolean(part)).map(escapeXml).join(' · ')
      return `<li><span class="time">${escapeXml(timeRange(item, texts))}</span> <span class="title">${escapeXml(item.title)}</span>${meta ? `<br /><span class="meta">${meta}</span>` : ''}</li>`
    }).join('\n')
    body += `<ul class="schedule">\n${rows}\n</ul>\n`
  }
  return body
}

function pinnedBody(chapter: PinnedChapter, ctx: Ctx, appendixHref: Map<string, string>): string {
  return chapter.items.map((item, i) => {
    const id = `pin-${i + 1}`
    if (item.mode === 'full') {
      return `<section class="pin" id="${id}">\n<h2>${escapeXml(item.title)}</h2>\n<p class="meta">${escapeXml(item.path)}</p>\n${markdownToXhtml(item.content ?? '', markdownContext(ctx, false))}</section>`
    }
    if (item.mode === 'title') {
      const href = item.appendixId ? appendixHref.get(item.appendixId) : undefined
      const link = href ? ` · <a href="${escapeXml(href)}">${escapeXml(ctx.texts.pinnedInAppendix)}</a>` : ''
      return `<section class="pin" id="${id}">\n<h2>${escapeXml(item.title)}</h2>\n<p class="meta">${escapeXml(item.path)}${link}</p>\n</section>`
    }
    return `<section class="pin" id="${id}">\n<h2>${escapeXml(item.title)}</h2>\n<p class="note">${escapeXml(ctx.texts.pinnedMissing)}</p>\n</section>`
  }).join('\n')
}

function articleMeta(article: ArticleItem, texts: EpubTexts): string {
  const parts: string[] = []
  if (article.author) parts.push(`${escapeXml(texts.author)} ${escapeXml(article.author)}`)
  parts.push(`${escapeXml(texts.source)} <a href="${escapeXml(article.url)}">${escapeXml(hostOf(article.url))}</a>`)
  return `<p class="meta">${parts.join(' · ')}</p>`
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function articlesBody(parts: ArticlePart[], ctx: Ctx, restHref: Map<string, string>): string {
  return parts.map(({ article, head, rest }, i) => {
    const more = rest !== null && restHref.has(article.url)
      ? `\n<p class="continue"><a href="${escapeXml(restHref.get(article.url) ?? '')}">${escapeXml(ctx.texts.continueInAppendix)}</a></p>`
      : ''
    return `<section class="article" id="art-${i + 1}">\n<h2>${escapeXml(article.title)}</h2>\n${articleMeta(article, ctx.texts)}\n${markdownToXhtml(head, markdownContext(ctx, true))}${more}\n</section>`
  }).join('\n')
}

function reviewBody(chapter: ReviewChapter, ctx: Ctx): string {
  const items = ctx.options.plan.reviewOne ? chapter.items.slice(0, 1) : chapter.items
  const cards = items.map(card => (
    `<section class="card">\n<h2>${escapeXml(card.title)}</h2>\n<p>${escapeXml(card.excerpt)}</p>\n<p class="meta">${escapeXml(ctx.texts.reviewFrom)} ${escapeXml(card.path)}</p>\n</section>`
  )).join('\n')
  return `${ctx.options.plan.reviewOne && chapter.items.length > 1 ? noteParagraph(ctx.texts.trimmedReviewNote) : ''}${cards}`
}

export function reportOneLine(chapter: ReportChapter, texts: EpubTexts): string {
  const report = chapter.report
  if (!report) return ''
  return fill(texts.reportOneLine, { period: report.period, notes: report.stats.notes, suggestions: report.suggestions.length })
}

function reportBody(chapter: ReportChapter, ctx: Ctx): string {
  const { texts } = ctx
  const report = chapter.report
  if (!report) return noteParagraph(chapter.note)
  if (ctx.options.plan.reportOneLine) return `${noteParagraph(texts.trimmedReportNote)}<p>${escapeXml(reportOneLine(chapter, texts))}</p>\n`
  let body = `<p class="meta">${escapeXml(fill(texts.reportPeriod, { period: report.period }))} · ${escapeXml(report.generated)}</p>\n`
  body += `<p>${escapeXml(fill(texts.reportStats, report.stats))}</p>\n`
  if (report.topics.length) {
    const rows = report.topics.map(topic => (
      `<tr><td>${escapeXml(topic.name)}</td><td>${escapeXml(topic.prevLevel && topic.prevLevel !== topic.level ? `${topic.prevLevel} → ${topic.level}` : topic.level)}</td><td class="num">${topic.score}</td></tr>`
    )).join('\n')
    body += `<h2>${escapeXml(texts.reportTopics)}</h2>\n<table>\n${rows}\n</table>\n`
  }
  if (report.suggestions.length) {
    body += `<h2>${escapeXml(texts.reportSuggestions)}</h2>\n<ul>\n${report.suggestions.map(s => `<li>${escapeXml(s)}</li>`).join('\n')}\n</ul>\n`
  }
  return body
}

function workbenchBody(chapter: WorkbenchChapter, texts: EpubTexts): string {
  let body = noteParagraph(chapter.note)
  const more = (shown: number, total: number) => (total > shown ? `<p class="meta">${escapeXml(fill(texts.workbenchMore, { count: total - shown }))}</p>\n` : '')
  if (chapter.decide.length) {
    body += `<h2>${escapeXml(texts.workbenchDecide)} <span class="num">${chapter.decideCount}</span></h2>\n<ul>\n`
    body += chapter.decide.map(item => `<li>${escapeXml(item.title)}${item.when ? ` <span class="meta">${escapeXml(item.when)}</span>` : ''}</li>`).join('\n')
    body += `\n</ul>\n${more(chapter.decide.length, chapter.decideCount)}`
  }
  if (chapter.complete.length) {
    body += `<h2>${escapeXml(texts.workbenchComplete)} <span class="num">${chapter.completeCount}</span></h2>\n<ul>\n`
    body += chapter.complete.map(item => {
      const due = item.overdue ? `${texts.overdue} · ${fill(texts.due, { due: item.due })}` : fill(texts.due, { due: item.due })
      return `<li>${escapeXml(item.title)} <span class="meta">${escapeXml(due)} · ${escapeXml(item.path)}</span></li>`
    }).join('\n')
    body += `\n</ul>\n${more(chapter.complete.length, chapter.completeCount)}`
  }
  return body
}

// ---------- 組書 ----------

/** 目前精簡內容的說明（放在目錄頁，AC #2「在簡報裡註明」）。 */
export function trimNotices(plan: TrimPlan, briefing: Briefing, texts: EpubTexts): string[] {
  const notices: string[] = []
  const articles = briefing.chapters.find((c): c is ArticlesChapter => c.kind === 'articles')?.items ?? []
  for (const url of plan.droppedArticleRest) {
    const article = articles.find(item => item.url === url)
    notices.push(fill(texts.trimmedArticle, { title: article?.title ?? url, url }))
  }
  const review = briefing.chapters.find((c): c is ReviewChapter => c.kind === 'review')
  if (plan.reviewOne && review && review.items.length > 1) notices.push(texts.trimmedReview)
  if (plan.reportOneLine && briefing.chapters.some(c => c.kind === 'report')) notices.push(texts.trimmedReport)
  for (const id of plan.droppedPinAppendix) {
    const entry = briefing.appendix.find(item => item.id === id)
    if (entry) notices.push(fill(texts.trimmedPin, { title: entry.title }))
  }
  if (plan.dropImages) notices.push(texts.trimmedImages)
  return notices
}

type Section =
  | { kind: 'schedule', title: string, schedule: ScheduleChapter | null, weather: WeatherChapter | null }
  | { kind: 'other', title: string, chapter: Exclude<BriefingChapter, ScheduleChapter | WeatherChapter> }

function sectionsOf(briefing: Briefing): Section[] {
  const sections: Section[] = []
  const schedule = briefing.chapters.find((c): c is ScheduleChapter => c.kind === 'schedule') ?? null
  const weather = briefing.chapters.find((c): c is WeatherChapter => c.kind === 'weather') ?? null
  let scheduleAdded = false
  for (const chapter of briefing.chapters) {
    if (chapter.kind === 'schedule' || chapter.kind === 'weather') {
      if (scheduleAdded) continue
      scheduleAdded = true
      sections.push({ kind: 'schedule', title: (schedule ?? weather)?.title ?? '', schedule, weather })
      continue
    }
    sections.push({ kind: 'other', title: chapter.title, chapter })
  }
  return sections
}

/**
 * 把今日簡報排成一本書：目錄頁、每章一份 XHTML、附錄每則一份 XHTML。
 * dayParts：天氣四格的時段名稱（早／午／晚／夜），由呼叫端從 BriefingTexts 傳入。
 */
export function renderBook(briefing: Briefing, options: RenderOptions, dayParts: Record<string, string> | null = null): Book {
  const { texts, lang, plan } = options
  const budget = options.budget ?? DEFAULT_PAGE_BUDGET
  const sections = sectionsOf(briefing)
  const parts = splitArticles(briefing, options.articleMaxPages ?? ARTICLE_MAX_PAGES, budget)
  const ctx: Ctx = { options, texts, links: new Map(), usedImages: new Map() }

  // 檔名先排好，wikilink 與「續讀見附錄」才指得到
  const chapterHref = (index: number) => `ch${pad(index + 1)}.xhtml`
  const appendixDocs: Array<{ href: string, title: string, kind: 'pin' | 'article', key: string }> = []
  for (const entry of briefing.appendix) appendixDocs.push({ href: '', title: entry.title, kind: 'pin', key: entry.id })
  for (const part of parts) if (part.rest !== null) appendixDocs.push({ href: '', title: part.article.title, kind: 'article', key: part.article.url })
  appendixDocs.forEach((doc, i) => { doc.href = `ap${pad(i + 1)}.xhtml` })
  const appendixHref = new Map(appendixDocs.filter(d => d.kind === 'pin').map(d => [d.key, d.href]))
  const restHref = new Map(appendixDocs.filter(d => d.kind === 'article').map(d => [d.key, d.href]))

  const addLink = (name: string, href: string) => {
    const key = normalizeName(name)
    if (key && !ctx.links.has(key)) ctx.links.set(key, href)
  }
  sections.forEach((section, index) => {
    if (section.kind !== 'other' || section.chapter.kind !== 'pinned') return
    section.chapter.items.forEach((item, i) => {
      const href = item.mode === 'title' && item.appendixId && appendixHref.has(item.appendixId)
        ? appendixHref.get(item.appendixId) ?? ''
        : `${chapterHref(index)}#pin-${i + 1}`
      if (item.mode === 'missing') return
      addLink(item.path, href)
      addLink(item.path.split('/').pop() ?? item.path, href)
      addLink(item.title, href)
    })
  })
  for (const entry of briefing.appendix) {
    const href = appendixHref.get(entry.id)
    if (!href) continue
    addLink(entry.path, href)
    addLink(entry.path.split('/').pop() ?? entry.path, href)
    addLink(entry.title, href)
  }

  const docs: BookDoc[] = []
  const toc: TocEntry[] = []
  sections.forEach((section, index) => {
    const href = chapterHref(index)
    let body: string
    const children: TocEntry[] = []
    if (section.kind === 'schedule') {
      body = scheduleBody(section.schedule, section.weather, texts, dayParts)
    } else {
      const chapter = section.chapter
      switch (chapter.kind) {
        case 'pinned':
          body = pinnedBody(chapter, ctx, appendixHref)
          chapter.items.forEach((item, i) => children.push({ label: item.title, href: `${href}#pin-${i + 1}` }))
          break
        case 'articles':
          body = articlesBody(parts, ctx, restHref)
          parts.forEach((part, i) => children.push({ label: part.article.title, href: `${href}#art-${i + 1}` }))
          break
        case 'review':
          body = reviewBody(chapter, ctx)
          break
        case 'report':
          body = reportBody(chapter, ctx)
          break
        case 'workbench':
          body = workbenchBody(chapter, texts)
          break
      }
    }
    const xhtml = xhtmlDocument(lang, section.title, `<section epub:type="chapter">\n${chapterHeading(index + 1, section.title)}\n${body}\n</section>`)
    docs.push({ id: `ch${pad(index + 1)}`, href, title: section.title, xhtml })
    toc.push({ label: section.title, href, ...(children.length ? { children } : {}) })
  })

  const appendixToc: TocEntry[] = []
  for (const doc of appendixDocs) {
    let body: string
    if (doc.kind === 'pin') {
      const entry = briefing.appendix.find(item => item.id === doc.key)
      const dropped = plan.droppedPinAppendix.includes(doc.key)
      const content = dropped || !entry
        ? `<p class="note">${escapeXml(texts.trimmedPinStub)}</p>`
        : markdownToXhtml(entry.content, markdownContext(ctx, false))
      body = `<h2>${escapeXml(doc.title)}</h2>\n<p class="meta">${escapeXml(entry?.path ?? '')}</p>\n${content}`
    } else {
      const part = parts.find(p => p.article.url === doc.key)
      const dropped = plan.droppedArticleRest.includes(doc.key)
      const content = dropped || !part?.rest
        ? `<p class="note">${escapeXml(texts.trimmedArticleStub)}<a href="${escapeXml(doc.key)}">${escapeXml(doc.key)}</a></p>`
        : markdownToXhtml(part.rest, markdownContext(ctx, true))
      body = `<h2>${escapeXml(doc.title)}</h2>\n<p class="meta">${escapeXml(fill(texts.continuedFrom, { title: doc.title }))}</p>\n${content}`
    }
    const id = doc.href.replace(/\.xhtml$/, '')
    docs.push({ id, href: doc.href, title: doc.title, xhtml: xhtmlDocument(lang, doc.title, `<section epub:type="appendix">\n${body}\n</section>`) })
    appendixToc.push({ label: doc.title, href: doc.href })
  }
  if (appendixToc.length) toc.push({ label: texts.appendixTitle, href: appendixToc[0].href, children: appendixToc })

  const title = fill(texts.bookTitle, { date: briefing.date })
  const notices = trimNotices(plan, briefing, texts)
  const navList = (entries: TocEntry[]): string => `<ol>\n${entries.map(entry => (
    `<li><a href="${escapeXml(entry.href)}">${escapeXml(entry.label)}</a>${entry.children?.length ? `\n${navList(entry.children)}` : ''}</li>`
  )).join('\n')}\n</ol>`
  const noticeHtml = notices.length
    ? `<section class="notice">\n<h2>${escapeXml(texts.trimmedTitle)}</h2>\n<ul>\n${notices.map(n => `<li>${escapeXml(n)}</li>`).join('\n')}\n</ul>\n</section>\n`
    : ''
  const nav = xhtmlDocument(lang, texts.tocTitle, `<h1>${escapeXml(title)}</h1>\n${noticeHtml}<nav epub:type="toc" id="toc">\n<h2>${escapeXml(texts.tocTitle)}</h2>\n${toc.length ? navList(toc) : `<ol>\n<li><a href="nav.xhtml">${escapeXml(title)}</a></li>\n</ol>`}\n</nav>`)

  const images = [...ctx.usedImages.values()].sort((a, b) => (a.href < b.href ? -1 : 1))
  const pageOf = (xhtml: string) => Math.max(1, Math.ceil(textUnits(stripTags(xhtml)) / budget.charsPerPage))
  const imagePages = images.length * budget.imagePageCost
  const pages = Math.round([nav, ...docs.map(d => d.xhtml)].reduce((sum, xhtml) => sum + pageOf(xhtml), 0) + imagePages)

  return {
    title,
    lang,
    identifier: `urn:almanac:briefing:${briefing.date}`,
    modified: new Date(options.generatedAt).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    nav,
    docs,
    toc,
    images,
    pages,
  }
}

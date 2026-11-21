// Fork（almanac ALMNC-47）：今日簡報組裝。純函式、無 I/O、不讀 Date.now()：
// 同一天＋同樣的儲存狀態 ⇒ 結果完全相同（排序鍵都寫明，挑選有固定的平手規則）。
// 「已送」狀態不在這裡更新：只算出 sent 清單，真的送出後由 commitSent（commit.ts）寫回。
//
// 同一天重算的穩定性：一天內電子紙每次休眠都會下載一次，commitSent 會被呼叫很多次。
// 為了讓送出後重算仍是同一份，挑選時「今天已經送過的」優先留在今天的結果裡：
//   每日精選文章  今天送出的（sentAt 落在今天）先放，不足 3 篇才從待送補
//   釘選資料      第一次送出（firstSentAt）是今天或還沒送過 → 全文；更早送過 → 只列標題、全文進附錄
//   每日回顧卡    今天出現過的先放，不足 3 張才從「最久沒出現」的補
//   知識報告      期別跟上次送出的不同，或上次送出就是今天 → 放
import { dateKey } from '@/lib/today/today-model'
import { localDay } from '@/lib/week/dates'
import type { EinkPin } from '@/lib/eink/pins'
import { DAILY_ARTICLE_COUNT, pickDailyArticles, type ReadLaterItem } from '@/lib/eink/read-later'
import type { BriefingSection } from '@/lib/eink/settings'
import type { BriefingLog } from './state'
import type { BriefingTexts } from './texts'
import { CHAPTER_KINDS } from './types'
import type {
  AppendixEntry, ArticleItem, Briefing, BriefingChapter, ChapterKind, OmitReason, PinnedItem, ReportSummary, ReviewCard,
  ScheduleItem, SentManifest, SourceResult, WeatherData, WorkbenchData,
} from './types'

/** 每日回顧卡一天抽幾張（計畫 v2） */
export const DAILY_REVIEW_COUNT = 3
/** 回顧卡片段最多幾個字 */
export const REVIEW_EXCERPT_CHARS = 280
/** 工作台摘要每區最多列幾項（另附總數） */
export const WORKBENCH_LIST_MAX = 10

export interface ScheduleSourceData {
  calendar: 'granted' | 'denied' | 'unavailable'
  items: Array<Omit<ScheduleItem, 'private'>>
}

/** 釘選資料來源：清單裡的每一則加上讀到的內容。content 為 null 表示讀不到（檔案不見或不是文字檔）。 */
export interface PinSnapshot {
  pin: EinkPin
  title: string
  content: string | null
}

export interface BriefingInputs {
  settings: { sections: readonly BriefingSection[] }
  schedule: SourceResult<ScheduleSourceData>
  /** 行程的私人標記（store.json 的 einkPrivateItems） */
  privateItems: readonly string[]
  weather: SourceResult<WeatherData>
  pins: SourceResult<PinSnapshot[]>
  readLater: SourceResult<ReadLaterItem[]>
  /** 最新一期知識報告；沒有任何一期回 empty */
  report: SourceResult<ReportSummary>
  workbench: SourceResult<WorkbenchData>
  log: BriefingLog
}

// ---------- 小工具（也給 sources.ts 用） ----------

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

export function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_RE, '')
}

/** 筆記標題：frontmatter 的 title → 第一個一級標題 → 檔名（去副檔名）。 */
export function noteTitle(path: string, markdown: string | null): string {
  if (markdown) {
    const fm = markdown.match(FRONTMATTER_RE)?.[0]
    const fmTitle = fm?.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim()
    if (fmTitle) return fmTitle
    const heading = stripFrontmatter(markdown).match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim()
    if (heading) return heading
  }
  const name = path.split('/').pop() ?? path
  return name.replace(/\.[^.]+$/, '') || name
}

/**
 * 回顧卡片段：去掉 frontmatter、標題、程式碼區塊與圖片後，取第一段文字，最多 REVIEW_EXCERPT_CHARS 字。
 * 固定取第一段（不亂數），同一份內容每次都得到同一張卡。
 */
export function reviewExcerpt(markdown: string, max = REVIEW_EXCERPT_CHARS): string {
  const body = stripFrontmatter(markdown)
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/!\[\[[^\]]*\]\]/g, '')
  const paragraphs = body.split(/\r?\n\s*\r?\n/)
  for (const paragraph of paragraphs) {
    const lines = paragraph.split(/\r?\n/).filter(line => !/^\s*#{1,6}\s/.test(line) && !/^\s*(?:---+|\*\*\*+)\s*$/.test(line))
    const text = lines
      .map(line => line.replace(/^\s*(?:[-*+]\s+(?:\[.\]\s+)?|\d+\.\s+|>\s?)/, '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    const chars = Array.from(text)
    return chars.length > max ? `${chars.slice(0, max).join('')}…` : text
  }
  return ''
}

function inDay(at: number | undefined, start: number, end: number): boolean {
  return at !== undefined && at >= start && at < end
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ---------- 各章 ----------

type Built = { chapter: BriefingChapter } | { omit: OmitReason }

function buildSchedule(inputs: BriefingInputs, texts: BriefingTexts): Built {
  const base = { kind: 'schedule' as const, title: texts.chapters.schedule }
  const source = inputs.schedule
  if (source.status === 'denied') return { chapter: { ...base, status: 'unavailable', note: texts.notes.calendarDeniedEmpty, items: [] } }
  if (source.status === 'error') return { chapter: { ...base, status: 'unavailable', note: texts.notes.scheduleError, items: [] } }
  const data = source.status === 'ok' ? source.data : { calendar: 'granted' as const, items: [] }
  const privateSet = new Set(inputs.privateItems)
  const items: ScheduleItem[] = data.items
    .map(item => ({ ...item, private: privateSet.has(item.key) }))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.end - b.end || byString(a.key, b.key))
  const denied = data.calendar === 'denied'
  if (items.length === 0) {
    if (denied) return { chapter: { ...base, status: 'unavailable', note: texts.notes.calendarDeniedEmpty, items } }
    if (data.calendar === 'unavailable') return { chapter: { ...base, status: 'unavailable', note: texts.notes.scheduleError, items } }
    return { chapter: { ...base, status: 'empty', note: texts.notes.scheduleEmpty, items } }
  }
  return { chapter: { ...base, status: 'ok', ...(denied ? { note: texts.notes.calendarDenied } : {}), items } }
}

function buildWeather(inputs: BriefingInputs, texts: BriefingTexts): Built {
  const base = { kind: 'weather' as const, title: texts.chapters.weather }
  const source = inputs.weather
  if (source.status === 'ok') return { chapter: { ...base, status: 'ok', weather: source.data } }
  const note = source.status === 'empty' ? texts.notes.weatherNoCity : texts.notes.weatherUnavailable
  return { chapter: { ...base, status: 'unavailable', note, weather: null } }
}

function orderedPins(source: SourceResult<PinSnapshot[]>): PinSnapshot[] {
  if (source.status !== 'ok') return []
  return [...source.data].sort((a, b) => a.pin.order - b.pin.order || byString(a.pin.path, b.pin.path))
}

function buildPinned(inputs: BriefingInputs, texts: BriefingTexts, dayStart: number, appendix: AppendixEntry[], sent: SentManifest): Built {
  if (inputs.pins.status === 'denied' || inputs.pins.status === 'error') return { omit: 'unavailable' }
  const pins = orderedPins(inputs.pins)
  if (pins.length === 0) return { omit: 'empty' }
  const items: PinnedItem[] = pins.map(({ pin, title, content }) => {
    if (content === null) return { path: pin.path, title, mode: 'missing' }
    sent.pinPaths.push(pin.path)
    const firstDay = pin.firstSentAt === undefined || pin.firstSentAt >= dayStart
    if (firstDay) return { path: pin.path, title, mode: 'full', content }
    const id = `pin:${pin.path}`
    appendix.push({ id, kind: 'pin', path: pin.path, title, content })
    return { path: pin.path, title, mode: 'title', appendixId: id }
  })
  return { chapter: { kind: 'pinned', title: texts.chapters.pinned, status: 'ok', items } }
}

function buildArticles(inputs: BriefingInputs, texts: BriefingTexts, dayStart: number, dayEnd: number, sent: SentManifest): Built {
  if (inputs.readLater.status === 'denied' || inputs.readLater.status === 'error') return { omit: 'unavailable' }
  const all = inputs.readLater.status === 'ok' ? inputs.readLater.data : []
  const order = (a: ReadLaterItem, b: ReadLaterItem) => a.addedAt - b.addedAt || byString(a.url, b.url)
  const sentToday = all
    .filter(item => item.status === 'sent' && inDay(item.sentAt, dayStart, dayEnd) && Boolean(item.content?.trim()))
    .sort(order)
    .slice(0, DAILY_ARTICLE_COUNT)
  const fresh = [...pickDailyArticles(all, DAILY_ARTICLE_COUNT - sentToday.length)].sort(order)
  const picked = [...sentToday, ...fresh].sort(order)
  // 精選文章 0 篇：整章拿掉，不從別處補
  if (picked.length === 0) return { omit: 'empty' }
  const items: ArticleItem[] = picked.map(item => ({
    url: item.url,
    title: item.title || item.url,
    ...(item.author ? { author: item.author } : {}),
    content: item.content ?? '',
    images: [...(item.images ?? [])],
    addedAt: item.addedAt,
  }))
  sent.articleUrls.push(...picked.map(item => item.url))
  return { chapter: { kind: 'articles', title: texts.chapters.articles, status: 'ok', items } }
}

/**
 * 每日回顧卡：從「今天以前就送過」的釘選資料抽（firstSentAt 早於今天；今天第一次送的正在章節裡放全文，不重複）。
 * 今天已經出現過的先放；其餘依最後出現時間由舊到新（沒出現過的最先），平手看第一次送出時間，再平手看路徑。
 */
export function pickReviewCards(pins: readonly PinSnapshot[], log: BriefingLog, dayStart: number, dayEnd: number, limit = DAILY_REVIEW_COUNT): ReviewCard[] {
  const pool = pins
    .filter(({ pin, content }) => content !== null && pin.firstSentAt !== undefined && pin.firstSentAt < dayStart)
    .map(snapshot => ({ ...snapshot, excerpt: reviewExcerpt(snapshot.content ?? '') }))
    .filter(snapshot => snapshot.excerpt)
  const shown = (path: string) => log.reviewShown[path]
  const today = pool
    .filter(({ pin }) => inDay(shown(pin.path), dayStart, dayEnd))
    .sort((a, b) => byString(a.pin.path, b.pin.path))
  const rest = pool
    .filter(({ pin }) => !inDay(shown(pin.path), dayStart, dayEnd))
    .sort((a, b) => (shown(a.pin.path) ?? -Infinity) - (shown(b.pin.path) ?? -Infinity)
      || (a.pin.firstSentAt ?? 0) - (b.pin.firstSentAt ?? 0)
      || byString(a.pin.path, b.pin.path))
  return [...today, ...rest].slice(0, Math.max(0, limit)).map(({ pin, title, excerpt }) => ({ path: pin.path, title, excerpt }))
}

function buildReview(inputs: BriefingInputs, texts: BriefingTexts, dayStart: number, dayEnd: number, sent: SentManifest): Built {
  if (inputs.pins.status === 'denied' || inputs.pins.status === 'error') return { omit: 'unavailable' }
  const items = pickReviewCards(orderedPins(inputs.pins), inputs.log, dayStart, dayEnd)
  if (items.length === 0) return { omit: 'empty' }
  sent.reviewPaths.push(...items.map(item => item.path))
  return { chapter: { kind: 'review', title: texts.chapters.review, status: 'ok', items } }
}

function buildReport(inputs: BriefingInputs, texts: BriefingTexts, dayStart: number, dayEnd: number, sent: SentManifest): Built {
  const source = inputs.report
  if (source.status === 'empty') return { omit: 'empty' }
  if (source.status !== 'ok') return { omit: 'unavailable' }
  const last = inputs.log.report
  const isNew = !last || last.period !== source.data.period || inDay(last.sentAt, dayStart, dayEnd)
  if (!isNew) return { omit: 'not-new' }
  sent.reportPeriod = source.data.period
  return { chapter: { kind: 'report', title: texts.chapters.report, status: 'ok', report: source.data } }
}

function buildWorkbench(inputs: BriefingInputs, texts: BriefingTexts): Built {
  const base = { kind: 'workbench' as const, title: texts.chapters.workbench }
  const source = inputs.workbench
  if (source.status === 'denied' || source.status === 'error') {
    return { chapter: { ...base, status: 'unavailable', note: texts.notes.workbenchError, decide: [], decideCount: 0, complete: [], completeCount: 0 } }
  }
  const data = source.status === 'ok' ? source.data : { decide: [], complete: [] }
  const decide = [...data.decide].sort((a, b) => a.at - b.at || byString(a.key, b.key))
  const complete = [...data.complete].sort((a, b) => Number(b.overdue) - Number(a.overdue)
    || byString(a.due, b.due) || byString(a.path, b.path) || a.line - b.line)
  const counts = { decideCount: decide.length, completeCount: complete.length }
  const lists = { decide: decide.slice(0, WORKBENCH_LIST_MAX), complete: complete.slice(0, WORKBENCH_LIST_MAX) }
  if (decide.length === 0 && complete.length === 0) return { chapter: { ...base, status: 'empty', note: texts.notes.workbenchEmpty, ...lists, ...counts } }
  return { chapter: { ...base, status: 'ok', ...lists, ...counts } }
}

/** 章節 → 設定頁的勾選項。天氣沒有獨立勾選：計畫 v2 把天氣放在「今天行程」開頭，跟著它開關。 */
const SECTION_OF: Record<ChapterKind, BriefingSection> = {
  schedule: 'schedule',
  weather: 'schedule',
  pinned: 'pinned',
  articles: 'articles',
  review: 'review',
  report: 'report',
  workbench: 'workbench',
}

/**
 * 組出 date 那天的今日簡報。純函式：所有資料都從 inputs 來（各來源的 adapter 先讀好）。
 * 某個來源沒資料或沒授權時，那一章顯示說明或整章拿掉，其他章照常產生：
 *   今天行程   沒授權／讀不到 → 保留並說明；沒有行程 → 保留並說明
 *   天氣       抓不到 → 保留，顯示「天氣暫無資料」
 *   釘選資料   清單空的／讀不到 → 拿掉
 *   精選文章   0 篇 → 拿掉（不從別處補）
 *   回顧卡     沒有可抽的 → 拿掉
 *   知識報告   沒有報告、讀不到、或沒有新一期 → 拿掉
 *   工作台摘要 讀不到 → 保留並說明；沒事 → 保留並說明
 * 設定頁沒勾的章節拿掉（reason: disabled），也不會出現在 sent 裡。
 */
export function assembleBriefing(date: Date, inputs: BriefingInputs, texts: BriefingTexts): Briefing {
  const dayStart = localDay(date).getTime()
  const dayEnd = localDay(date, 1).getTime()
  const enabled = new Set(inputs.settings.sections)
  const appendix: AppendixEntry[] = []
  const sent: SentManifest = { articleUrls: [], pinPaths: [], reviewPaths: [] }
  const chapters: BriefingChapter[] = []
  const omitted: Briefing['omitted'] = []

  const builders: Record<ChapterKind, () => Built> = {
    schedule: () => buildSchedule(inputs, texts),
    weather: () => buildWeather(inputs, texts),
    pinned: () => buildPinned(inputs, texts, dayStart, appendix, sent),
    articles: () => buildArticles(inputs, texts, dayStart, dayEnd, sent),
    review: () => buildReview(inputs, texts, dayStart, dayEnd, sent),
    report: () => buildReport(inputs, texts, dayStart, dayEnd, sent),
    workbench: () => buildWorkbench(inputs, texts),
  }

  for (const kind of CHAPTER_KINDS) {
    if (!enabled.has(SECTION_OF[kind])) {
      omitted.push({ kind, reason: 'disabled' })
      continue
    }
    const built = builders[kind]()
    if ('chapter' in built) chapters.push(built.chapter)
    else omitted.push({ kind, reason: built.omit })
  }

  return { date: dateKey(date), chapters, appendix, omitted, sent }
}

// Fork（almanac ALMNC-49）：休眠畫面的排版。純函式、無 I/O、不讀 Date.now()、不量實際字型：
// 同一份簡報＋同一個更新時間 ⇒ 同一份繪圖指令（快照測試就是測這份指令）。
// 畫面內容（計畫 v2「休眠畫面」）：日期星期、早午晚夜四格天氣（溫度＋降雨機率，在行程上方）＋最高最低、
// 整天行程（時間、標題、地點）、角落「更新於 HH:MM」、底部一行今日簡報提示。
// 刻意不放：「下一個」、現在位置（只在闔上時更新，過時會誤導）、工作台內容（等你定、待辦）。
// 版面參考設計稿 H 版；480×800 的分區比例參考 RockyBalboa360/worker-for-crosspoint-calendar-task-screen（MIT）。
import type { Briefing, ReviewCard, ScheduleChapter, ScheduleItem, WeatherChapter } from '@/lib/eink/briefing/types'
import { fill } from '@/lib/eink/epub/texts'
import { CHAR_WIDTH_EM, LAYOUT, SLEEP_HEIGHT, SLEEP_MAX_EVENTS, SLEEP_WIDTH, type GrayLevel } from './params'
import type { SleepTexts } from './texts'

export type FontFamily = 'sans' | 'mono'

export interface FontSpec {
  family: FontFamily
  size: number
  weight: 400 | 600
}

export type DrawOp =
  | { op: 'text', x: number, y: number, text: string, font: FontSpec, gray: GrayLevel, maxWidth: number, align?: 'left' | 'right' }
  | { op: 'rect', x: number, y: number, w: number, h: number, gray: GrayLevel }
  | { op: 'frame', x: number, y: number, w: number, h: number, gray: GrayLevel, line: number }
  | { op: 'dot', cx: number, cy: number, r: number, gray: GrayLevel, line: number }

export interface SleepLayout {
  width: number
  height: number
  ops: DrawOp[]
}

export interface SleepInput {
  /** 畫這張圖的時間（毫秒）：角落「更新於 HH:MM」 */
  updatedAt: number
  texts: SleepTexts
  /** 今日簡報估計頁數（EPUB 產生器的 pages）；沒有就不寫頁數 */
  briefingPages?: number
  maxEvents?: number
}

// ---------- 字寬與斷行（估算，不量實際字型） ----------

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\uD840-\uD87F][\uDC00-\uDFFF]/

export function charWidth(char: string, font: FontSpec): number {
  if (WIDE.test(char)) return font.size * CHAR_WIDTH_EM.wide
  return font.size * (font.family === 'mono' ? CHAR_WIDTH_EM.mono : CHAR_WIDTH_EM.narrow)
}

export function textWidth(text: string, font: FontSpec): number {
  let width = 0
  for (const char of text) width += charWidth(char, font)
  return Math.ceil(width)
}

const ELLIPSIS = '…'

/** 截到 maxWidth 以內，截掉的加「…」。 */
export function truncate(text: string, maxWidth: number, font: FontSpec): string {
  if (textWidth(text, font) <= maxWidth) return text
  const chars = Array.from(text)
  const limit = maxWidth - charWidth(ELLIPSIS, font)
  let width = 0
  let out = ''
  for (const char of chars) {
    width += charWidth(char, font)
    if (width > limit) break
    out += char
  }
  return `${out.trimEnd()}${ELLIPSIS}`
}

/**
 * 斷行：中日韓字之間隨處可斷；拉丁文字盡量斷在空白（單字比一行長才硬切）。
 * 最多 maxLines 行，放不下的最後一行加「…」。
 */
export function wrap(text: string, maxWidth: number, font: FontSpec, maxLines: number): string[] {
  const tokens = text.replace(/\s+/g, ' ').trim().match(/[ᄀ-￿]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\sᄀ-￿]+|\s/g) ?? []
  const lines: string[] = []
  let line = ''
  const push = () => { lines.push(line.trimEnd()); line = '' }
  for (const token of tokens) {
    if (token === ' ' && !line) continue
    if (textWidth(line + token, font) <= maxWidth) { line += token; continue }
    if (line) push()
    if (token === ' ') continue
    if (textWidth(token, font) <= maxWidth) { line = token; continue }
    // 單字比一行長：逐字硬切
    for (const char of Array.from(token)) {
      if (textWidth(line + char, font) > maxWidth) push()
      line += char
    }
  }
  if (line) push()
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = truncate(`${kept[maxLines - 1]}${lines[maxLines]}`, maxWidth, font)
  return kept
}

// ---------- 時間格式 ----------

const pad = (n: number) => String(n).padStart(2, '0')

export function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 1h、30m、1h30 */
export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h}h${pad(m)}`
  return h ? `${h}h` : `${m}m`
}

function localDate(ms: number): { key: string, weekday: number } {
  const d = new Date(ms)
  return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, weekday: d.getDay() }
}

// ---------- 版面 ----------

const L = LAYOUT
const CONTENT_X = L.marginX
const CONTENT_W = SLEEP_WIDTH - L.marginX * 2
const FOOTER_TOP = SLEEP_HEIGHT - L.marginBottom - L.footerSize - 9

const font = (family: FontFamily, size: number, weight: 400 | 600 = 400): FontSpec => ({ family, size, weight })

class Canvas {
  ops: DrawOp[] = []

  text(x: number, y: number, text: string, f: FontSpec, gray: GrayLevel, maxWidth: number, align: 'left' | 'right' = 'left') {
    if (!text) return
    const fitted = truncate(text, maxWidth, f)
    this.ops.push({ op: 'text', x, y, text: fitted, font: f, gray, maxWidth, ...(align === 'right' ? { align } : {}) })
  }

  hline(x: number, y: number, w: number, gray: GrayLevel = 0) {
    this.ops.push({ op: 'rect', x, y, w, h: 1, gray })
  }

  rect(x: number, y: number, w: number, h: number, gray: GrayLevel) {
    this.ops.push({ op: 'rect', x, y, w, h, gray })
  }
}

/** 區段標題「§01 天氣」，底下一條黑線。回傳下一個內容的 y。 */
function section(c: Canvas, y: number, no: number, title: string): number {
  const label = `§${pad(no)}`
  const labelFont = font('mono', L.sectionSize, 600)
  const baseline = y + L.sectionSize
  c.text(CONTENT_X, baseline, label, labelFont, 0, 40)
  const titleX = CONTENT_X + textWidth(label, labelFont) + 8
  c.text(titleX, baseline, title, font('sans', L.sectionSize, 600), 0, CONTENT_W - (titleX - CONTENT_X))
  c.hline(CONTENT_X, baseline + 4, CONTENT_W)
  return baseline + 4 + 1
}

function drawWeather(c: Canvas, y: number, no: number, chapter: WeatherChapter, texts: SleepTexts): number {
  y = section(c, y, no, texts.weatherTitle)
  const weather = chapter.weather
  if (!weather || weather.parts.length === 0) {
    c.text(CONTENT_X, y + 22, chapter.note ?? '', font('sans', L.eventTitleSize), 1, CONTENT_W)
    return y + 32
  }
  const cellW = Math.floor(CONTENT_W / 4)
  const top = y + 6
  weather.parts.slice(0, 4).forEach((part, i) => {
    const x = CONTENT_X + i * cellW
    if (i > 0) c.rect(x - 1, top + 2, 1, 62, 2)
    const pad = i === 0 ? 0 : 10
    c.text(x + pad, top + 16, texts.dayParts[part.part], font('sans', L.metaSize), 1, cellW - pad - 4)
    c.text(x + pad, top + 44, `${part.temperature}°`, font('mono', L.weatherTempSize, 600), 0, cellW - pad - 4)
    c.text(x + pad, top + 62, fill(texts.precipitation, { value: part.precipitationProbability }), font('sans', L.metaSize), 1, cellW - pad - 4)
  })
  return top + 72
}

interface EventRow {
  time: string
  title: string[]
  meta: string
  muted: boolean
}

function eventRows(items: ScheduleItem[], texts: SleepTexts, titleLines: number): EventRow[] {
  const contentW = CONTENT_W - L.timeColumn - L.dotColumn - L.columnGap * 2
  return items.map(item => {
    const range = item.end > item.start ? `${hhmm(item.start)}–${hhmm(item.end)} · ${duration(item.end - item.start)}` : ''
    // 私人行程只留「私人行程」和時間（不顯示標題、地點、來源）
    const meta = item.private ? range : [range, item.location].filter(Boolean).join(' · ')
    const title = item.private ? texts.privateLabel : item.title
    return { time: hhmm(item.start), title: wrap(title, contentW, font('sans', L.eventTitleSize), titleLines), meta, muted: item.private }
  })
}

function rowHeight(row: EventRow): number {
  return row.title.length * L.titleLineHeight + (row.meta ? L.metaLineHeight : 0) + L.rowPadding
}

function drawSchedule(c: Canvas, y: number, no: number, chapter: ScheduleChapter | null, review: ReviewCard | null, texts: SleepTexts, maxEvents: number): number {
  y = section(c, y, no, texts.scheduleTitle) + 6
  const items = chapter?.items ?? []
  const allDay = items.filter(item => item.allDay)
  const timed = items.filter(item => !item.allDay)

  // 全天行程：最上面一條，不算在 maxEvents 裡
  if (allDay.length) {
    const label = texts.allDay
    const labelFont = font('sans', L.metaSize, 600)
    const labelW = textWidth(label, labelFont) + 10
    c.rect(CONTENT_X, y, labelW, 24, 0)
    c.text(CONTENT_X + 5, y + 17, label, labelFont, 3, labelW - 6)
    c.ops.push({ op: 'frame', x: CONTENT_X, y, w: CONTENT_W, h: 24, gray: 0, line: 1 })
    const titles = allDay.map(item => (item.private ? texts.privateLabel : item.title)).join(' · ')
    c.text(CONTENT_X + labelW + 8, y + 17, titles, font('sans', L.eventTitleSize), 0, CONTENT_W - labelW - 14)
    y += 24 + 8
  }

  if (timed.length === 0) {
    // 沒有行程的日子：時間軸的位置改放一張每日回顧卡
    if (chapter?.note) {
      c.text(CONTENT_X, y + 16, chapter.note, font('sans', L.eventTitleSize), 1, CONTENT_W)
      y += 28
    }
    if (review) y = drawReviewCard(c, y + 4, review, texts)
    return y
  }

  const shown = timed.slice(0, maxEvents)
  const hidden = timed.length - shown.length
  const moreH = hidden > 0 ? 26 : 0
  const available = FOOTER_TOP - 8 - y - moreH
  // 先試標題最多兩行，放不下就全部改一行
  let rows = eventRows(shown, texts, 2)
  if (rows.reduce((sum, row) => sum + rowHeight(row), 0) > available) rows = eventRows(shown, texts, 1)

  const timeX = CONTENT_X
  const dotX = CONTENT_X + L.timeColumn + L.columnGap
  const lineX = dotX + Math.floor(L.dotColumn / 2)
  const contentX = dotX + L.dotColumn + L.columnGap
  const contentW = CONTENT_W - (contentX - CONTENT_X)
  rows.forEach((row, i) => {
    const h = rowHeight(row)
    const baseline = y + 5 + L.eventTitleSize
    const cy = baseline - 5
    // 時間軸的直線：第一件從圓點開始、最後一件到圓點為止
    const lineTop = i === 0 ? cy : y
    const lineBottom = i === rows.length - 1 ? cy : y + h
    if (lineBottom > lineTop) c.rect(lineX, lineTop, 1, lineBottom - lineTop, 0)
    c.ops.push({ op: 'dot', cx: lineX + 0.5, cy, r: 4.5, gray: 0, line: 1.5 })
    c.text(timeX, baseline, row.time, font('mono', L.eventTimeSize), 0, L.timeColumn)
    row.title.forEach((line, j) => c.text(contentX, baseline + j * L.titleLineHeight, line, font('sans', L.eventTitleSize), row.muted ? 1 : 0, contentW))
    if (row.meta) c.text(contentX, baseline + (row.title.length - 1) * L.titleLineHeight + L.metaLineHeight, row.meta, font('sans', L.eventMetaSize), 1, contentW)
    y += h
  })
  if (hidden > 0) {
    c.text(contentX, y + 16, fill(texts.more, { count: hidden }), font('sans', L.eventMetaSize, 600), 0, contentW)
    y += moreH
  }
  return y
}

function drawReviewCard(c: Canvas, y: number, card: ReviewCard, texts: SleepTexts): number {
  const pad = 14
  const innerW = CONTENT_W - pad * 2
  const maxBottom = FOOTER_TOP - 12
  const titleFont = font('sans', L.cardTitleSize, 600)
  const bodyFont = font('sans', L.cardBodySize)
  const labelFont = font('sans', L.metaSize, 600)
  const title = wrap(card.title, innerW, titleFont, 2)
  const fixed = pad + 18 + 8 + title.length * 24 + 6 + L.cardLineHeight /* 出處 */ + pad
  const bodyLines = Math.max(1, Math.min(12, Math.floor((maxBottom - y - fixed) / L.cardLineHeight)))
  const body = wrap(card.excerpt, innerW, bodyFont, bodyLines)
  const h = fixed + body.length * L.cardLineHeight
  c.ops.push({ op: 'frame', x: CONTENT_X, y, w: CONTENT_W, h, gray: 0, line: 1 })
  let cy = y + pad + 13
  c.text(CONTENT_X + pad, cy, texts.reviewTitle, labelFont, 1, innerW)
  cy += 8
  title.forEach(line => { cy += 24; c.text(CONTENT_X + pad, cy, line, titleFont, 0, innerW) })
  cy += 6
  body.forEach(line => { cy += L.cardLineHeight; c.text(CONTENT_X + pad, cy, line, bodyFont, 0, innerW) })
  cy += L.cardLineHeight
  c.text(CONTENT_X + pad, cy, card.path, font('sans', L.metaSize), 1, innerW)
  return y + h
}

/** 底部提示：今日簡報頁數與新內容（精選文章、當天全文的釘選、回顧卡、知識報告）。 */
export function briefingHint(briefing: Briefing, texts: SleepTexts, pages?: number): string {
  const parts: string[] = []
  for (const chapter of briefing.chapters) {
    if (chapter.kind === 'articles' && chapter.items.length) parts.push(fill(texts.hintArticles, { count: chapter.items.length }))
    if (chapter.kind === 'pinned') {
      const fresh = chapter.items.filter(item => item.mode === 'full').length
      if (fresh) parts.push(fill(texts.hintPinned, { count: fresh }))
    }
    if (chapter.kind === 'review' && chapter.items.length) parts.push(fill(texts.hintReview, { count: chapter.items.length }))
    if (chapter.kind === 'report' && chapter.report) parts.push(texts.hintReport)
  }
  const head = pages ? fill(texts.hintPages, { pages }) : texts.hintNone
  return parts.length ? `${head} · ${fill(texts.hintNew, { items: parts.join(' · ') })}` : head
}

export function layoutSleepScreen(briefing: Briefing, input: SleepInput): SleepLayout {
  const { texts } = input
  const c = new Canvas()
  c.rect(0, 0, SLEEP_WIDTH, SLEEP_HEIGHT, 3)

  // 頂端一行：ALMANAC、地點；右上角「更新於 HH:MM」
  const weather = briefing.chapters.find((ch): ch is WeatherChapter => ch.kind === 'weather') ?? null
  const schedule = briefing.chapters.find((ch): ch is ScheduleChapter => ch.kind === 'schedule') ?? null
  const review = briefing.chapters.find(ch => ch.kind === 'review')
  const reviewCard = review && review.kind === 'review' ? review.items[0] ?? null : null

  let y = L.marginTop
  const stripBase = y + L.stripSize
  const updated = fill(texts.updatedAt, { time: hhmm(input.updatedAt) })
  const updatedFont = font('sans', L.stripSize)
  const updatedW = textWidth(updated, updatedFont)
  c.text(SLEEP_WIDTH - L.marginX, stripBase, updated, updatedFont, 1, updatedW + 2, 'right')
  const brandFont = font('mono', L.stripSize, 600)
  c.text(CONTENT_X, stripBase, 'ALMANAC', brandFont, 0, 80)
  if (weather?.weather?.location) {
    const x = CONTENT_X + textWidth('ALMANAC', brandFont) + 14
    c.text(x, stripBase, weather.weather.location, font('sans', L.stripSize), 1, SLEEP_WIDTH - L.marginX - updatedW - 14 - x)
  }
  c.hline(CONTENT_X, stripBase + 6, CONTENT_W)
  y = stripBase + 7

  // 日期、星期
  const day = localDate(new Date(`${briefing.date}T12:00:00`).getTime())
  const dateFont = font('mono', L.dateSize, 600)
  const dateBase = y + 12 + L.dateSize
  c.text(CONTENT_X, dateBase, day.key, dateFont, 0, CONTENT_W)
  const weekdayX = CONTENT_X + textWidth(day.key, dateFont) + 12
  c.text(weekdayX, dateBase, texts.weekdays[day.weekday] ?? '', font('sans', L.dateSize, 600), 0, CONTENT_W - (weekdayX - CONTENT_X))
  y = dateBase + 6
  if (weather?.weather) {
    const w = weather.weather
    const meta = `${fill(texts.highLow, { high: w.high, low: w.low })} · ${fill(texts.precipitation, { value: w.precipitationProbability })}`
    c.text(CONTENT_X, y + 16, meta, font('sans', L.metaSize), 1, CONTENT_W)
    y += 20
  }
  y += 12

  let no = 1
  if (weather) {
    y = drawWeather(c, y, no, weather, texts) + 10
    no += 1
  }
  drawSchedule(c, y, no, schedule, reviewCard, texts, input.maxEvents ?? SLEEP_MAX_EVENTS)

  // 底部提示
  c.hline(CONTENT_X, FOOTER_TOP, CONTENT_W)
  c.text(CONTENT_X, SLEEP_HEIGHT - L.marginBottom, briefingHint(briefing, texts, input.briefingPages), font('sans', L.footerSize), 1, CONTENT_W)

  return { width: SLEEP_WIDTH, height: SLEEP_HEIGHT, ops: c.ops }
}

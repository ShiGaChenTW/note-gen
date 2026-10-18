// D5 重複任務：勾掉帶 `🔁 every …` 的任務時，回傳「標上 ✅ 的原行」與「下一次的新行」。純函式、無 I/O。
// 規則對齊 Obsidian Tasks（https://publish.obsidian.md/tasks/Getting+Started/Recurring+Tasks）：
// - 基準日：📅 due，沒有就 ⏳ scheduled，再沒有就 🛫 start；`when done` 時改以完成日（today）為基準
// - 下一次的基準日依規則從基準日往後算；其他日期維持與基準日的天數差
// - 每月 / 每年遇到不存在的日子（1/31 → 2 月、2/29 → 平年）取該月最後一天，不跳月
// - 新行狀態重設為 `[ ]`，移除 ✅ / ❌ 日期；有 ➕ 建立日的話改成 today
import { TASK_CHECKBOX_RE, setTaskDone } from './tasks'

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year' | 'weekday'

export interface Recurrence {
  interval: number
  unit: RecurrenceUnit
  whenDone: boolean
  // 🔁 後的原始規則文字
  text: string
}

export interface CompletedTask {
  // 標上 ✅ 的原行
  completed: string
  // 下一次的新行；沒有 🔁 或規則不支援時為 null
  next: string | null
  // 要寫回筆記、取代原行的內容：[completed, next]（新行在下一行）
  lines: string[]
}

// Tasks 的規則文字只含英數、逗號、空白與 !；遇到下一個 emoji、#標籤、^block id 就結束
const RECURRENCE_RE = /🔁️?\s*([a-zA-Z0-9, !]+)/u
const RULE_RE = /^every\s+(?:(\d+)\s+)?(day|week|month|year|weekday)s?(\s+when\s+done)?$/i

const DATE_FIELDS = {
  due: [/(📅️?\s*)(\d{4}-\d{2}-\d{2})/u, /((?<![\p{L}\p{N}_-])due::\s*)(\d{4}-\d{2}-\d{2})/u],
  scheduled: [/(⏳️?\s*)(\d{4}-\d{2}-\d{2})/u, /((?<![\p{L}\p{N}_-])scheduled::\s*)(\d{4}-\d{2}-\d{2})/u],
  start: [/(🛫️?\s*)(\d{4}-\d{2}-\d{2})/u, /((?<![\p{L}\p{N}_-])start::\s*)(\d{4}-\d{2}-\d{2})/u],
} as const
type DateField = keyof typeof DATE_FIELDS
const REFERENCE_ORDER: DateField[] = ['due', 'scheduled', 'start']

const CREATED_RE = /(➕️?\s*)(\d{4}-\d{2}-\d{2})/u
const DONE_OR_CANCELLED_RE = /\s*[✅❌]️?\s*\d{4}-\d{2}-\d{2}/gu

export function parseRecurrence(text: string): Recurrence | null {
  const m = text.trim().replace(/\s+/g, ' ').match(RULE_RE)
  if (!m) return null
  const unit = m[2].toLowerCase() as RecurrenceUnit
  const interval = m[1] ? Number(m[1]) : 1
  if (interval < 1) return null
  // `every 2 weekdays` 不是 Tasks 支援的寫法
  if (unit === 'weekday' && m[1]) return null
  return { interval, unit, whenDone: !!m[3], text: text.trim() }
}

/** 從任務行取出 🔁 規則；沒有或不支援時回傳 null。 */
export function recurrenceOf(line: string): Recurrence | null {
  const m = line.match(RECURRENCE_RE)
  return m ? parseRecurrence(m[1]) : null
}

/** 依規則算出基準日（YYYY-MM-DD）之後的下一次。 */
export function nextOccurrence(rule: Recurrence, reference: string): string {
  const ref = parseYmd(reference)
  if (!ref) throw new Error(`無效日期：${reference}`)
  switch (rule.unit) {
    case 'day': return formatYmd(addDays(ref, rule.interval))
    case 'week': return formatYmd(addDays(ref, rule.interval * 7))
    case 'month': return formatYmd(addMonthsClamped(ref, rule.interval))
    case 'year': return formatYmd(addMonthsClamped(ref, rule.interval * 12))
    case 'weekday': {
      let d = addDays(ref, 1)
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = addDays(d, 1)
      return formatYmd(d)
    }
  }
}

/**
 * 把未完成的任務行標成完成；若帶有支援的 🔁 規則，一併產生下一次的新行（同樣的縮排）。
 * 不是任務行或已完成時回傳 null。保留行尾 `\r`。
 */
export function completeTaskLine(line: string, today: Date): CompletedTask | null {
  const cr = line.endsWith('\r') ? '\r' : ''
  const bare = line.replace(/\r$/, '')
  const m = bare.match(TASK_CHECKBOX_RE)
  if (!m || m[2].toLowerCase() === 'x') return null

  const completed = setTaskDone(line, true, { today })!
  const rule = recurrenceOf(bare)
  if (!rule) return { completed, next: null, lines: [completed] }

  const next = buildNextOccurrence(bare, rule, today) + cr
  return { completed, next, lines: [completed, next] }
}

/**
 * 在整份筆記中完成第 lineNo 行（0 起算），有重複規則時在下一行插入下一次；其他行逐字不變。
 * 該行不是未完成任務時回傳 null。
 */
export function completeTaskInContent(content: string, lineNo: number, today: Date): string | null {
  const lines = content.split('\n')
  if (lineNo < 0 || lineNo >= lines.length) return null
  const result = completeTaskLine(lines[lineNo], today)
  if (!result) return null
  lines.splice(lineNo, 1, ...result.lines)
  return lines.join('\n')
}

/**
 * 編輯器用：輸入任務項目的文字（不含 `- [ ] `），回傳完成後的文字（加上 ✅ 日期）與下一次的文字。
 * 沒有支援的 🔁 規則時回傳 null。
 */
export function completeRecurringText(text: string, today: Date): { completed: string, next: string } | null {
  if (!recurrenceOf(text)) return null
  const result = completeTaskLine(`- [ ] ${text}`, today)
  if (!result?.next) return null
  return {
    completed: result.completed.replace(/^- \[[xX]\] ?/, ''),
    next: result.next.replace(/^- \[ \] ?/, ''),
  }
}

/** 依 🔁 規則產生下一次的任務行（未完成、日期依參考日平移；不含行尾 `\r`）。 */
function buildNextOccurrence(bare: string, rule: Recurrence, today: Date): string {
  const todayStr = formatYmd(localDay(today))
  const dates = readDates(bare)
  const referenceField = REFERENCE_ORDER.find(f => dates[f])
  const reference = referenceField ? dates[referenceField]! : null

  let next = bare
    .replace(TASK_CHECKBOX_RE, (_, open: string, _status: string, rest: string) => `${open} ${rest}`)
    .replace(DONE_OR_CANCELLED_RE, '')
    .replace(CREATED_RE, (_, prefix: string) => `${prefix}${todayStr}`)

  // 沒有任何日期時（不論是否 when done），Tasks 產生不帶日期的新任務
  if (!reference) return next
  const nextRef = nextOccurrence(rule, rule.whenDone ? todayStr : reference)
  for (const field of REFERENCE_ORDER) {
    const value = dates[field]
    if (!value) continue
    const shifted = formatYmd(addDays(parseYmd(nextRef)!, diffDays(value, reference)))
    next = replaceDate(next, field, shifted)
  }
  return next
}

function readDates(line: string): Partial<Record<DateField, string>> {
  const out: Partial<Record<DateField, string>> = {}
  for (const field of REFERENCE_ORDER) {
    for (const re of DATE_FIELDS[field]) {
      const m = line.match(re)
      if (m && parseYmd(m[2])) { out[field] = m[2]; break }
    }
  }
  return out
}

function replaceDate(line: string, field: DateField, value: string): string {
  for (const re of DATE_FIELDS[field]) {
    const m = line.match(re)
    if (m && parseYmd(m[2])) return line.replace(re, (_, prefix: string) => `${prefix}${value}`)
  }
  return line
}

// ---------- 日期小工具：以 UTC 午夜表示「日曆日」；之後改用軌道 B 的 format.ts ----------
function localDay(now: Date): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

function parseYmd(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null
}

function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * 86_400_000)
}

function diffDays(a: string, b: string): number {
  return Math.round((parseYmd(a)!.getTime() - parseYmd(b)!.getTime()) / 86_400_000)
}

function addMonthsClamped(date: Date, n: number): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + n
  const y = Math.floor(total / 12)
  const m = total % 12
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), last)))
}

const pad = (n: number) => String(n).padStart(2, '0')
const formatYmd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

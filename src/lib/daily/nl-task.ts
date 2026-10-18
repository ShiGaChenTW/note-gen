// D4 自然語言快速新增：`買菜 @明天 9am !high #家` → `- [ ] 買菜 📅 2026-10-18 ⏰ 09:00 ⏫ #家`
// 純函式、無 I/O；所有相對日期都以注入的 now（本地時間）為準。

export type NlPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest'

export interface NaturalTask {
  title: string
  // YYYY-MM-DD；沒有日期時為空字串
  due: string
  // HH:mm；沒有時間時為空字串
  time: string
  priority: NlPriority | ''
  tags: string[]
  line: string
}

// Obsidian Tasks 的優先序 emoji
export const PRIORITY_EMOJI: Record<NlPriority, string> = {
  highest: '🔺',
  high: '⏫',
  medium: '🔼',
  low: '🔽',
  lowest: '⏬',
}

const PRIORITY_ALIASES: Record<string, NlPriority> = {
  highest: 'highest', 最高: 'highest',
  high: 'high', 高: 'high',
  medium: 'medium', mid: 'medium', 中: 'medium',
  low: 'low', 低: 'low',
  lowest: 'lowest', 最低: 'lowest',
}

const RELATIVE_DAYS: Record<string, number> = {
  今天: 0, 今日: 0, today: 0,
  明天: 1, 明日: 1, tomorrow: 1,
  後天: 2, 后天: 2,
  大後天: 3, 大后天: 3,
}

// 週一 = 1 … 週日 = 7（ISO）
const CN_WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }
const EN_WEEKDAY: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
}

const TAG_RE = /^#(?=[\p{L}\p{N}_/-]*[\p{L}_/-])[\p{L}\p{N}_/-]+$/u

/**
 * 解析一行快速輸入。規則（以空白分詞）：
 * - `@日期`：今天／明天／後天／大後天、週X／下週X／下下週X（亦接受 周、星期、禮拜）、X號／X日、M月D號、M/D、YYYY-MM-DD、
 *   英文 today／tomorrow／mon…sun／next mon…；認不得的 `@xxx` 原樣留在標題
 * - 時間：`9am`、`9:30pm`、`21:00`、`下午3點`、`9點半`（也可寫成 `@9am`）；只有時間沒有日期時，日期為今天
 * - `!high` 等優先序（highest/high/medium/mid/low/lowest，或 最高/高/中/低/最低）
 * - `#標籤` 移到行尾，保留原順序
 */
export function parseNaturalTask(input: string, now: Date): NaturalTask {
  const words: string[] = []
  const tags: string[] = []
  let due = ''
  let time = ''
  let priority: NlPriority | '' = ''

  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith('@') && token.length > 1) {
      const body = token.slice(1)
      const d = due ? null : resolveDate(body, now)
      if (d) { due = d; continue }
      const t = time ? null : parseTime(body)
      if (t) { time = t; continue }
    } else if (token.startsWith('!') && token.length > 1) {
      const p = PRIORITY_ALIASES[token.slice(1).toLowerCase()]
      if (p && !priority) { priority = p; continue }
    } else if (TAG_RE.test(token)) {
      tags.push(token)
      continue
    } else if (!time) {
      const t = parseTime(token)
      if (t) { time = t; continue }
    }
    words.push(token)
  }

  if (time && !due) due = formatYmd(localDay(now))
  const title = words.join(' ')
  const parts = ['- [ ]', title]
  if (due) parts.push(`📅 ${due}`)
  if (time) parts.push(`⏰ ${time}`)
  if (priority) parts.push(PRIORITY_EMOJI[priority])
  parts.push(...tags)
  return { title, due, time, priority, tags, line: parts.filter(Boolean).join(' ') }
}

/** 把日期詞轉成 YYYY-MM-DD；認不得回傳 null。 */
export function resolveDate(word: string, now: Date): string | null {
  const today = localDay(now)
  const w = word.toLowerCase()

  if (w in RELATIVE_DAYS) return formatYmd(addDays(today, RELATIVE_DAYS[w]))

  // 週X = 本週還沒過完的那一天（今天算數）；下週X = 下一個日曆週（週一起算）的那一天
  const cn = word.match(/^((?:下)*)(?:週|周|星期|禮拜|礼拜)([一二三四五六日天])$/)
  if (cn) return formatYmd(weekdayDate(today, CN_WEEKDAY[cn[2]], cn[1].length))
  const en = w.match(/^((?:next-?)*)([a-z]+)$/)
  if (en && en[2] in EN_WEEKDAY) return formatYmd(weekdayDate(today, EN_WEEKDAY[en[2]], en[1] ? en[1].split(/next-?/).length - 1 : 0))

  // X號：本月還沒過的 X 號，否則下一個有 X 號的月份（31 號會跳過小月）
  const dayOnly = word.match(/^(\d{1,2})[號号日]$/)
  if (dayOnly) {
    const day = Number(dayOnly[1])
    if (day < 1 || day > 31) return null
    let y = today.getUTCFullYear()
    let m = today.getUTCMonth() + 1
    for (let i = 0; i < 13; i++) {
      const c = makeDay(y, m, day)
      if (c && c >= today) return formatYmd(c)
      m += 1
      if (m > 12) { m = 1; y += 1 }
    }
    return null
  }

  // M月D號、M/D：今年還沒過就用今年，否則明年；2/29 會找下一個閏年
  const md = word.match(/^(\d{1,2})月(\d{1,2})[號号日]?$/) ?? word.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (md) {
    const month = Number(md[1])
    const day = Number(md[2])
    for (let y = today.getUTCFullYear(); y <= today.getUTCFullYear() + 8; y++) {
      const c = makeDay(y, month, day)
      if (c && c >= today) return formatYmd(c)
    }
    return null
  }

  const iso = word.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const c = makeDay(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    return c ? formatYmd(c) : null
  }

  return null
}

/** 把時間詞轉成 HH:mm；認不得回傳 null。 */
export function parseTime(word: string): string | null {
  const ampm = word.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i)
  if (ampm) {
    let h = Number(ampm[1])
    const min = Number(ampm[2] ?? 0)
    if (h < 1 || h > 12 || min > 59) return null
    if (ampm[3].toLowerCase() === 'am') h = h === 12 ? 0 : h
    else h = h === 12 ? 12 : h + 12
    return hhmm(h, min)
  }

  const clock = word.match(/^(\d{1,2}):(\d{2})$/)
  if (clock) {
    const h = Number(clock[1])
    const min = Number(clock[2])
    return h < 24 && min < 60 ? hhmm(h, min) : null
  }

  const cn = word.match(/^(凌晨|早上|上午|中午|下午|傍晚|晚上)?(\d{1,2})[點点](?:(半)|(\d{1,2})分?)?$/)
  if (cn) {
    let h = Number(cn[2])
    const min = cn[3] ? 30 : Number(cn[4] ?? 0)
    if (h > 23 || min > 59) return null
    const period = cn[1]
    if (period && h > 12) return null
    if ((period === '下午' || period === '傍晚' || period === '晚上') && h < 12) h += 12
    if (period === '中午' && h < 11) h += 12
    if ((period === '凌晨' || period === '早上' || period === '上午') && h === 12) h = 0
    return hhmm(h, min)
  }

  return null
}

function weekdayDate(today: Date, target: number, weeksAhead: number): Date {
  const cur = isoWeekday(today)
  if (weeksAhead === 0) return addDays(today, (target - cur + 7) % 7)
  const nextMonday = addDays(today, 8 - cur)
  return addDays(nextMonday, (weeksAhead - 1) * 7 + target - 1)
}

// ---------- 日期小工具：以 UTC 午夜表示「日曆日」，避免時區與夏令時間誤差；之後改用軌道 B 的 format.ts ----------
function localDay(now: Date): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

function makeDay(y: number, m: number, d: number): Date | null {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null
}

function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * 86_400_000)
}

function isoWeekday(date: Date): number {
  return date.getUTCDay() || 7
}

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`
const formatYmd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

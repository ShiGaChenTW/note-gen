/**
 * 日記路徑與日期模組（F2）
 *
 * 用同一張 token 表做「日期→檔名」與「檔名→日期」雙向轉換。
 * 支援 YYYY MM DD ddd dddd，`/` 表示子資料夾，`[...]` 內為原樣文字。
 * 星期名稱固定英文，避免切換介面語言後檔名解析失敗。
 * 純函式，不碰檔案 I/O，日期一律由參數傳入。
 */

/** 日記相關設定的預設值（沿用 NoteGen Today 外掛） */
export const DEFAULT_DAILY_FOLDER = '20 Journal/21 Daily'
export const DEFAULT_DAILY_PATTERN = 'YYYYMMDD'
export const DEFAULT_INBOX_FOLDER = '10 Inbox'
export const DEFAULT_STALE_DAYS = 3

export const DAILY_DEFAULTS = {
  dailyFolder: DEFAULT_DAILY_FOLDER,
  dailyPattern: DEFAULT_DAILY_PATTERN,
  inboxFolder: DEFAULT_INBOX_FOLDER,
  staleDays: DEFAULT_STALE_DAYS,
} as const

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export const WEEKDAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

type TokenName = 'YYYY' | 'MM' | 'DD' | 'dddd' | 'ddd'

interface TokenDef {
  /** 解析時使用的正則片段（不含捕獲群組） */
  pattern: string
  format: (date: Date) => string
}

/** 唯一的 token 表；格式化與解析都由此產生。依長度由長到短比對 */
const TOKENS: Record<TokenName, TokenDef> = {
  YYYY: { pattern: '\\d{4}', format: (d) => String(d.getFullYear()).padStart(4, '0') },
  MM: { pattern: '\\d{2}', format: (d) => String(d.getMonth() + 1).padStart(2, '0') },
  DD: { pattern: '\\d{2}', format: (d) => String(d.getDate()).padStart(2, '0') },
  dddd: { pattern: WEEKDAY_NAMES.join('|'), format: (d) => WEEKDAY_NAMES[d.getDay()] },
  ddd: { pattern: WEEKDAY_SHORT_NAMES.join('|'), format: (d) => WEEKDAY_SHORT_NAMES[d.getDay()] },
}

const TOKEN_ORDER: TokenName[] = ['YYYY', 'dddd', 'ddd', 'MM', 'DD']

type Segment = { type: 'token'; token: TokenName } | { type: 'literal'; text: string }

/** 把格式字串切成 token 與原樣文字 */
function tokenize(pattern: string): Segment[] {
  const segments: Segment[] = []
  let literal = ''
  let i = 0

  const flush = () => {
    if (literal) {
      segments.push({ type: 'literal', text: literal })
      literal = ''
    }
  }

  while (i < pattern.length) {
    // [文字] 為跳脫區段，原樣輸出
    if (pattern[i] === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end !== -1) {
        literal += pattern.slice(i + 1, end)
        i = end + 1
        continue
      }
    }

    const token = TOKEN_ORDER.find((name) => pattern.startsWith(name, i))
    if (token) {
      flush()
      segments.push({ type: 'token', token })
      i += token.length
      continue
    }

    literal += pattern[i]
    i++
  }

  flush()
  return segments
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function trimSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/** 依格式字串把日期轉成文字，例如 `YYYY/YYYYMMDD` → `2026/20261017` */
export function formatDate(date: Date, pattern: string): string {
  return tokenize(pattern)
    .map((seg) => (seg.type === 'token' ? TOKENS[seg.token].format(date) : seg.text))
    .join('')
}

/**
 * 依格式字串把文字解析回日期（當地時間 00:00）
 * 不合法、日期不存在、星期與日期不符、重複 token 不一致時回傳 null
 */
export function parseDate(text: string, pattern: string): Date | null {
  const segments = tokenize(pattern)
  const tokens: TokenName[] = []
  const source = segments
    .map((seg) => {
      if (seg.type === 'literal') return escapeRegExp(seg.text)
      tokens.push(seg.token)
      return `(${TOKENS[seg.token].pattern})`
    })
    .join('')

  const match = new RegExp(`^${source}$`).exec(text)
  if (!match) return null

  const values: Partial<Record<TokenName, string>> = {}
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const value = match[i + 1]
    if (values[token] !== undefined && values[token] !== value) return null
    values[token] = value
  }

  if (!values.YYYY || !values.MM || !values.DD) return null

  const year = Number(values.YYYY)
  const month = Number(values.MM)
  const day = Number(values.DD)
  const date = new Date(year, month - 1, day)
  date.setFullYear(year) // 避免 0~99 年被 Date 建構子當成 19xx

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  if (values.dddd && values.dddd !== WEEKDAY_NAMES[date.getDay()]) return null
  if (values.ddd && values.ddd !== WEEKDAY_SHORT_NAMES[date.getDay()]) return null

  return date
}

/** 格式能否唯一還原日期：必須含 YYYY、MM、DD，且不能是空字串或以 `/` 開頭結尾 */
export function isValidDailyPattern(pattern: string): boolean {
  if (!pattern.trim() || pattern.startsWith('/') || pattern.endsWith('/') || pattern.includes('//')) return false
  const tokens = new Set(
    tokenize(pattern).flatMap((seg) => (seg.type === 'token' ? [seg.token] : []))
  )
  return tokens.has('YYYY') && tokens.has('MM') && tokens.has('DD')
}

/** 日期 → 日記相對路徑（含 `.md`），例如 `20 Journal/21 Daily/20261017.md` */
export function dailyNotePath(
  date: Date,
  folder: string = DEFAULT_DAILY_FOLDER,
  pattern: string = DEFAULT_DAILY_PATTERN
): string {
  const dir = trimSlashes(folder)
  const name = `${formatDate(date, pattern)}.md`
  return dir ? `${dir}/${name}` : name
}

/**
 * 日記相對路徑 → 日期；不在日記資料夾內或檔名不符格式時回傳 null
 * `.md` 副檔名可有可無
 */
export function parseDailyNotePath(
  path: string,
  folder: string = DEFAULT_DAILY_FOLDER,
  pattern: string = DEFAULT_DAILY_PATTERN
): Date | null {
  let rest = trimSlashes(path)
  const dir = trimSlashes(folder)

  if (dir) {
    if (!rest.startsWith(`${dir}/`)) return null
    rest = rest.slice(dir.length + 1)
  }

  rest = rest.replace(/\.md$/i, '')
  return parseDate(rest, pattern)
}

/** 日期 → `YYYY-MM-DD`，與 Obsidian Tasks 的 `📅` 日期同格式 */
export function toDateKey(date: Date): string {
  return formatDate(date, 'YYYY-MM-DD')
}

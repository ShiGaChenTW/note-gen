/**
 * 日記模板引擎（D1）
 *
 * 純函式，不碰檔案 I/O：模板內容、時間、隨機行來源都由呼叫端注入。
 * 支援的 token：
 * - `{{date}}`、`{{date:FORMAT}}`：FORMAT 用 format.ts 的 token 表，預設 `YYYY-MM-DD`
 * - `{{time}}`：`HH:mm`
 * - `{{weekday}}`：英文星期全名，例如 `Saturday`
 * - `{{title}}`：筆記標題
 * - `{{random:筆記路徑}}`：從指定筆記隨機抽一行
 * 不認得的 token 原樣保留。
 */

import { formatDate, WEEKDAY_NAMES } from './format'

/** 依路徑取一行隨機內容；回傳 null/undefined 代表沒有可用的行 */
export type RandomLineSource = (notePath: string) => string | null | undefined

export interface TemplateContext {
  now: Date
  title?: string
  randomLine?: RandomLineSource
}

const TOKEN_RE = /\{\{\s*(\w+)(?:\s*:\s*([^}]*?))?\s*\}\}/g

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 套用模板，回傳展開後的內容 */
export function renderTemplate(template: string, context: TemplateContext): string {
  const { now, title = '', randomLine } = context

  return template.replace(TOKEN_RE, (raw, name: string, arg: string | undefined) => {
    switch (name) {
      case 'date':
        return formatDate(now, arg || 'YYYY-MM-DD')
      case 'time':
        return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
      case 'weekday':
        return WEEKDAY_NAMES[now.getDay()]
      case 'title':
        return title
      case 'random':
        if (!arg) return raw
        return randomLine?.(arg) ?? ''
      default:
        return raw
    }
  })
}

/** 列出模板中 `{{random:...}}` 用到的筆記路徑（去重），讓呼叫端先讀檔 */
export function collectRandomSources(template: string): string[] {
  const paths = new Set<string>()
  for (const match of template.matchAll(TOKEN_RE)) {
    if (match[1] === 'random' && match[2]) paths.add(match[2])
  }
  return [...paths]
}

/**
 * 從筆記內容隨機抽一行：略過 frontmatter 與空白行，回傳去頭尾空白的文字
 * @param random 回傳 [0, 1) 的亂數函式，測試時注入
 */
export function pickRandomLine(content: string, random: () => number = Math.random): string | null {
  let body = content
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(body)
  if (frontmatter) body = body.slice(frontmatter[0].length)

  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return null

  const index = Math.min(Math.floor(random() * lines.length), lines.length - 1)
  return lines[index]
}

export type WeekdayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'

export const WEEKDAY_KEYS: readonly WeekdayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** 模板設定：值為模板筆記的路徑，空字串視為未設定 */
export interface DailyTemplateSettings {
  defaultTemplate?: string
  weekdayTemplates?: Partial<Record<WeekdayKey, string>>
}

/**
 * 依星期幾列出候選模板路徑：星期專屬的優先，其次是預設模板
 * 呼叫端可依序嘗試，遇到檔案不存在時再換下一個
 */
export function dailyTemplateCandidates(date: Date, settings: DailyTemplateSettings): string[] {
  const weekday = settings.weekdayTemplates?.[WEEKDAY_KEYS[date.getDay()]]?.trim()
  const fallback = settings.defaultTemplate?.trim()
  return [...new Set([weekday, fallback].filter((path): path is string => !!path))]
}

/** 選出要使用的模板路徑；都沒有設定時回傳 null，代表建立空白筆記 */
export function selectDailyTemplate(date: Date, settings: DailyTemplateSettings): string | null {
  return dailyTemplateCandidates(date, settings)[0] ?? null
}

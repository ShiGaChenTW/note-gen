/**
 * 今日筆記的初始內容（D1）：依星期挑模板、展開 token。
 * 純函式加注入的讀檔函式，不碰 Tauri，方便測試。
 */

import {
  collectRandomSources,
  dailyTemplateCandidates,
  pickRandomLine,
  renderTemplate,
  type DailyTemplateSettings,
} from './template'

/** 讀 vault 內的筆記；檔案不存在時回傳 null */
export type NoteReader = (relativePath: string) => Promise<string | null>

/** 使用者可省略 `.md`，也可能前後多打斜線 */
export function normalizeNotePath(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return ''
  return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`
}

export interface DailyNoteContentOptions {
  now: Date
  /** 今日筆記的相對路徑，用來產生 `{{title}}` */
  notePath: string
  templates: DailyTemplateSettings
  readNote: NoteReader
  random?: () => number
}

/**
 * 依序嘗試星期專屬模板、預設模板；第一個讀得到的就用。
 * 都沒有設定或都讀不到時回傳空字串（建立空白筆記）。
 */
export async function buildDailyNoteContent(options: DailyNoteContentOptions): Promise<string> {
  const { now, notePath, templates, readNote, random } = options

  let template: string | null = null
  for (const candidate of dailyTemplateCandidates(now, templates)) {
    template = await readNote(normalizeNotePath(candidate))
    if (template !== null) break
  }
  if (template === null) return ''

  const randomLines = new Map<string, string | null>()
  for (const source of collectRandomSources(template)) {
    const content = await readNote(normalizeNotePath(source))
    randomLines.set(source, content === null ? null : pickRandomLine(content, random))
  }

  const title = notePath.split('/').pop()?.replace(/\.md$/i, '') ?? ''
  return renderTemplate(template, {
    now,
    title,
    randomLine: (path) => randomLines.get(path) ?? null,
  })
}

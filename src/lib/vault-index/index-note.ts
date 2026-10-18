/**
 * F3 vault 索引：把單一筆記轉成索引項目。純函式、無 I/O。
 * 索引任務、frontmatter、連結、別名與標籤。
 */

import { parse as parseYaml } from 'yaml'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { isTaskSource, parseTaskLine, type TaskPriority } from '@/lib/daily/tasks'
import { findWikilinks } from '@/lib/markdown/wikilink'
import { recurrenceOf } from '@/lib/daily/recurrence'

/** 快取格式版本；欄位或解析規則改變時加一，舊快取會整份重建。 */
export const INDEX_SCHEMA_VERSION = 2

export interface IndexedTask {
  /** 0 起算的行號（對應 split('\n') 後的位置） */
  line: number
  done: boolean
  title: string
  /** `YYYY-MM-DD` 或空字串 */
  due: string
  /** `HH:mm` 或空字串 */
  time: string
  priority: TaskPriority
  /** 🔁 後的規則文字，例如 `every week when done`；不支援或沒有時為空字串 */
  recurrence: string
  /** 原始行（不含行尾 `\r`），寫回時用來確認行沒被改過 */
  raw: string
}

export interface IndexedLink {
  kind: 'wikilink' | 'markdown'
  /** wikilink 的目標，或換算後的 vault 相對 Markdown 路徑 */
  target: string
  alias: string
  heading: string
  embed: boolean
  /** 對整份檔案的 0 起算行號 */
  line: number
  /** 去頭尾空白、以連結為中心的最多 160 字上下文 */
  context: string
}

export interface IndexedNote {
  path: string
  /** 毫秒；取不到時為 0 */
  mtime: number
  frontmatter: Record<string, unknown> | null
  tasks: IndexedTask[]
  links: IndexedLink[]
  aliases: string[]
  tags: string[]
}

const TIME_RE = /⏰️?\s*(\d{1,2}):(\d{2})/u
// parseTaskLine 只去掉 emoji 本身，⏰ 時間與 ✅ / ❌ / ⏳ / 🛫 / ➕ 後的日期會留在標題裡
const TITLE_META_RE = /(?:⏰️?\s*\d{1,2}:\d{2}|[✅❌⏳🛫➕]️?\s*\d{4}-\d{2}-\d{2})/gu

function taskTime(line: string): string {
  const m = line.match(TIME_RE)
  if (!m) return ''
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours > 23 || minutes > 59) return ''
  return `${String(hours).padStart(2, '0')}:${m[2]}`
}

// Obsidian Tasks 的優先度 emoji；dataview 的 `priority::` 由 parseTaskLine 處理，兩者並存時以 dataview 為準
function emojiPriority(line: string): TaskPriority | null {
  if (/[🔺⏫]/u.test(line)) return 'high'
  if (/🔼/u.test(line)) return 'mid'
  if (/[🔽⏬]/u.test(line)) return 'low'
  return null
}

export function parseFrontmatterData(block: string): Record<string, unknown> | null {
  if (!block) return null
  const yaml = block
    .replace(/^﻿/, '')
    .replace(/^---[^\r\n]*(?:\r\n|\r|\n)/, '')
    .replace(/(?:\r\n|\r|\n)?(?:---|\.\.\.)[ \t]*(?:\r\n|\r|\n)?$/, '')
  try {
    const data: unknown = parseYaml(yaml)
    return data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : null
  } catch {
    // YAML 寫壞時照樣索引任務，只是沒有 frontmatter
    return null
  }
}

export function indexTasks(content: string): IndexedTask[] {
  const tasks: IndexedTask[] = []
  let fence: string | null = null
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '')
    // 程式碼區塊裡的 `- [ ]` 不是任務
    const fenceMatch = raw.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fence !== null) continue

    const parsed = parseTaskLine(raw)
    if (!parsed) continue
    const title = parseTaskLine(raw.replace(TITLE_META_RE, ''))?.title ?? parsed.title
    const hasDataviewPriority = /priority::/i.test(raw)
    tasks.push({
      line: i,
      done: parsed.done,
      title,
      due: parsed.due,
      time: taskTime(raw),
      priority: hasDataviewPriority ? parsed.priority : emojiPriority(raw) ?? parsed.priority,
      recurrence: recurrenceOf(raw)?.text ?? '',
      raw,
    })
  }
  return tasks
}

/** 遮住程式碼但保留字元位置與換行，供連結與標籤共用。 */
function withoutCode(content: string): string {
  let fence: string | null = null
  const masked = content.split('\n').map(line => {
    const match = line.match(/^\s*(`{3,}|~{3,})/)
    if (match) {
      if (!fence) fence = match[1]
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null
      return ' '.repeat(line.length)
    }
    // 只遮 fenced code；4 空白縮排在清單裡是巢狀項目，不是縮排程式碼
    return fence ? ' '.repeat(line.length) : line
  }).join('\n')
  return masked.replace(/(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g, match => match.replace(/[^\n]/g, ' '))
}

function linkContext(line: string, column: number, length: number): string {
  const start = Math.max(0, Math.min(column - Math.floor((160 - Math.min(length, 160)) / 2), line.length - 160))
  return line.slice(start, start + 160).trim()
}

function metadataStrings(value: unknown, split = false): string[] {
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap(item => typeof item === 'string' ? (split ? item.split(/[,\s]+/) : [item]) : [])
    .map(item => item.trim()).filter(Boolean)
}

function markdownTarget(href: string, sourcePath: string): { target: string, heading: string } | null {
  if (/^(?:[a-z][a-z0-9+.-]*:|[/#])/i.test(href)) return null
  const hash = href.indexOf('#')
  let decoded: string
  let heading: string
  try {
    decoded = decodeURIComponent(hash < 0 ? href : href.slice(0, hash))
    heading = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1))
  } catch { return null }
  if (!/\.md$/i.test(decoded) || /^(?:[a-z][a-z0-9+.-]*:|[/\\])/i.test(decoded)) return null
  const parts = sourcePath.split('/').slice(0, -1)
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  return { target: parts.join('/'), heading }
}

export function indexLinks(path: string, content: string): IndexedLink[] {
  const lines = content.split('\n')
  const links: Array<IndexedLink & { column: number }> = findWikilinks(content).map(link => ({
    kind: 'wikilink', target: link.target, alias: link.alias, heading: link.heading,
    embed: link.embed, line: link.line, column: link.column,
    context: linkContext(lines[link.line], link.column, link.raw.length),
  }))
  withoutCode(content).split('\n').forEach((line, lineNo) => {
    // 行內 Markdown 連結；不收圖片、外部 URL 或錨點。
    const re = /(?<!!)\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g
    for (const match of line.matchAll(re)) {
      const resolved = markdownTarget(match[2] ?? match[3], path)
      if (!resolved) continue
      links.push({ kind: 'markdown', ...resolved, alias: match[1], embed: false, line: lineNo,
        column: match.index, context: linkContext(lines[lineNo], match.index, match[0].length) })
    }
  })
  return links.sort((a, b) => a.line - b.line || a.column - b.column).map(({ column, ...link }) => {
    void column
    return link
  })
}

/** 建立筆記索引；非任務來源（NOT_TASK_PREFIXES）仍索引連結與中繼資料。 */
export function indexNote(path: string, content: string, mtime: number): IndexedNote {
  const { block, body } = splitFrontmatter(content)
  const frontmatterLines = block ? block.split('\n').length - 1 : 0
  const tasks = isTaskSource(path)
    // 行號對整份檔案計算，所以要補上 frontmatter 佔的行數
    ? indexTasks(body).map(task => ({ ...task, line: task.line + frontmatterLines }))
    : []
  const frontmatter = parseFrontmatterData(block)
  const aliases = metadataStrings(frontmatter?.aliases ?? frontmatter?.alias)
  const tags = metadataStrings(frontmatter?.tags ?? frontmatter?.tag, true).map(tag => tag.replace(/^#/, ''))
  for (const match of withoutCode(body).matchAll(/(?:^|[\s(（])#((?:[^\s\p{P}\p{S}]|[-_])+(?:\/(?:[^\s\p{P}\p{S}]|[-_])+)*)/gmu)) tags.push(match[1])
  return {
    path,
    mtime,
    frontmatter,
    tasks,
    links: indexLinks(path, content),
    aliases: [...new Set(aliases)],
    tags: [...new Set(tags.filter(Boolean))],
  }
}

/**
 * F3 vault 索引：把單一筆記轉成索引項目。純函式、無 I/O。
 * Phase 1 索引任務行、frontmatter、修改時間；links / aliases / tags 先預留欄位（Phase 2 填入）。
 */

import { parse as parseYaml } from 'yaml'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { isTaskSource, parseTaskLine, type TaskPriority } from '@/lib/daily/tasks'
import { recurrenceOf } from '@/lib/daily/recurrence'

/** 快取格式版本；欄位或解析規則改變時加一，舊快取會整份重建。 */
export const INDEX_SCHEMA_VERSION = 1

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

export interface IndexedNote {
  path: string
  /** 毫秒；取不到時為 0 */
  mtime: number
  frontmatter: Record<string, unknown> | null
  tasks: IndexedTask[]
  // Phase 2（L1–L6）預留
  links: string[]
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

/** 建立一則筆記的索引項目。非任務來源（NOT_TASK_PREFIXES）只記 frontmatter。 */
export function indexNote(path: string, content: string, mtime: number): IndexedNote {
  const { block, body } = splitFrontmatter(content)
  const frontmatterLines = block ? block.split('\n').length - 1 : 0
  const tasks = isTaskSource(path)
    // 行號對整份檔案計算，所以要補上 frontmatter 佔的行數
    ? indexTasks(body).map(task => ({ ...task, line: task.line + frontmatterLines }))
    : []
  return {
    path,
    mtime,
    frontmatter: parseFrontmatterData(block),
    tasks,
    links: [],
    aliases: [],
    tags: [],
  }
}

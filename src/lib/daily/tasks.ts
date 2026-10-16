// 任務行解析（Obsidian Tasks / dataview 格式），純函式、無 I/O；now / today 由參數注入。
// 移植自 personal/plugin-skeleton/notegen-today/entry.js，該檔再移植自 command-center_v2；來源以註解標示。

export type TaskPriority = 'high' | 'mid' | 'low'
export type TaskBucket = 'overdue' | 'today' | 'other'

export interface ParsedTask {
  done: boolean
  title: string
  text: string
  due: string
  priority: TaskPriority
}

// taskLine.ts:13-31
export const TASK_CHECKBOX_RE = /^(\s*[-*+]\s+\[)([ xX/\-?])(\](?:\s+.*)?)$/
const TASK_DUE_RE = /(?<![\p{L}\p{N}_-])(due::\s*)(\d{4}-\d{2}-\d{2})/u
const TASK_DUE_EMOJI_RE = /(📅️?\s*)(\d{4}-\d{2}-\d{2})/u
const stripCR = (line: string) => line.replace(/\r$/, '')

// taskScan.ts:26-52
export function parseTaskLine(line: string): ParsedTask | null {
  const m = stripCR(line).match(TASK_CHECKBOX_RE)
  if (!m) return null
  const done = m[2].toLowerCase() === 'x'
  const body = m[3].replace(/^\]\s*/, '')
  const due = body.match(TASK_DUE_RE)?.[2] ?? body.match(TASK_DUE_EMOJI_RE)?.[2] ?? ''
  const rawPri = body.match(/priority::\s*(high|medium|mid|low)/i)?.[1]?.toLowerCase() ?? ''
  const priority: TaskPriority = rawPri === 'high' ? 'high' : rawPri === 'low' ? 'low' : 'mid'
  const title = body
    .replace(/🔁.*$/u, '')
    .replace(new RegExp(TASK_DUE_EMOJI_RE.source, 'gu'), '')
    .replace(/[[（(]\s*\w+::[^\]）)]*[\]）)]/g, '')
    .replace(/\w+::\s*\S+/g, '')
    .replace(/(^|\s)#(?=[\p{L}\p{N}_/-]*[\p{L}_/-])[\p{L}\p{N}_/-]+/gu, '$1')
    .replace(/[✅🔼⏫🔽🔺⏬🛫⏳📅🔁➕❌]️?/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { done, title, text: title, due, priority }
}

// taskScan.ts:59-64：overdue = 未完成且到期日 < 今天；today = 到期日 = 今天（含已完成）；其餘 other
export function bucketFor(t: Pick<ParsedTask, 'done' | 'due'>, now: Date): TaskBucket {
  const todayStr = ymd(now)
  if (!t.due) return 'other'
  if (t.due < todayStr) return t.done ? 'other' : 'overdue'
  if (t.due === todayStr) return 'today'
  return 'other'
}

// paths.ts:44 taskExcludePrefixes + :54 NOT_TASK_PREFIXES
export const NOT_TASK_PREFIXES = ['00 System/07 dev/', 'temp/', 'copilot/', 'plans/', 'openspec/', '10 Inbox/', '00.Inbox/', 'inbox/', '00 System/05 templates/']
export const isTaskSource = (path: string) => !NOT_TASK_PREFIXES.some(p => path.startsWith(p))

// ---------- 勾選並回寫（D2 新增，非 entry.js 原有） ----------

export interface SetTaskDoneOptions {
  // 有值時：完成會補上 `✅ YYYY-MM-DD`，取消完成會移除 ✅ 日期（對齊 Obsidian Tasks 的 done date）
  today?: Date
}

const DONE_DATE_RE = /\s*✅️?\s*\d{4}-\d{2}-\d{2}/u
const BLOCK_ID_RE = /\s\^[\w-]+$/

/**
 * 把任務行設成完成 / 未完成，只動 `[ ]` 內的字元（以及選擇性的 ✅ 日期），其餘逐字保留，含行尾 `\r`。
 * 不是任務行時回傳 null；狀態已相同時回傳原行。
 */
export function setTaskDone(line: string, done: boolean, options: SetTaskDoneOptions = {}): string | null {
  const cr = line.endsWith('\r') ? '\r' : ''
  const m = stripCR(line).match(TASK_CHECKBOX_RE)
  if (!m) return null
  const wasDone = m[2].toLowerCase() === 'x'
  if (wasDone === done) return line
  let rest = m[3]
  if (options.today) rest = done ? appendDoneDate(rest, ymd(options.today)) : rest.replace(DONE_DATE_RE, '')
  return `${m[1]}${done ? 'x' : ' '}${rest}${cr}`
}

export function toggleTaskLine(line: string, options: SetTaskDoneOptions = {}): string | null {
  const t = parseTaskLine(line)
  if (!t) return null
  return setTaskDone(line, !t.done, options)
}

/**
 * 切換整份筆記第 lineNo 行（0 起算）的完成狀態並回傳新內容；其他行逐字不變（含 CRLF、結尾換行）。
 * 該行不是任務時回傳 null。
 */
export function toggleTaskInContent(content: string, lineNo: number, options: SetTaskDoneOptions = {}): string | null {
  const lines = content.split('\n')
  if (lineNo < 0 || lineNo >= lines.length) return null
  const next = toggleTaskLine(lines[lineNo], options)
  if (next === null) return null
  lines[lineNo] = next
  return lines.join('\n')
}

// ✅ 放在描述與其他欄位之後、block id（` ^abc`）之前；尾端空白保留在最後，讓取消完成能完全還原
function appendDoneDate(rest: string, date: string): string {
  const trailing = rest.match(/\s*$/)?.[0] ?? ''
  let body = rest.slice(0, rest.length - trailing.length)
  let blockId = ''
  const b = body.match(BLOCK_ID_RE)
  if (b) {
    blockId = b[0]
    body = body.slice(0, body.length - blockId.length)
  }
  return `${body} ✅ ${date}${blockId}${trailing}`
}

// 之後改用軌道 B 的 src/lib/daily/format.ts
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

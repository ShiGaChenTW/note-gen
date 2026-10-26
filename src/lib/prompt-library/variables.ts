/**
 * 提示詞變數解析（#53）：純函式、不碰檔案 I/O，供 #55、#57 重用。
 *
 * Token 語法：`{{名稱}}`。`\{{名稱}}` 是跳脫，原樣輸出（去掉反斜線）；
 * fenced code block 與行內 code 裡的 `{{...}}` 原樣輸出，不算變數。
 * 內建變數：`date`（可選 `{{date:FORMAT}}`，格式沿用 daily/format.ts）、`time`、
 * `clipboard`、`note:檔名`（嵌入另一篇筆記的內文）。其餘 token 都是使用者變數。
 *
 * 「宣告」指的是提示詞 frontmatter 的 `variables: [...]` 扁平清單；內文「## 變數」
 * 段落的格式見 parseVariablesSection 的文件注解。未宣告的使用者變數＝必填自由文字。
 */

import { formatDate } from '@/lib/daily/format'

export type BuiltinVariableName = 'date' | 'time' | 'clipboard' | 'note'

export type VariableUsage =
  | { kind: 'builtin'; token: string; builtin: BuiltinVariableName; arg?: string }
  | { kind: 'user'; token: string; name: string }

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g
const BUILTIN_NAMES = new Set<BuiltinVariableName>(['date', 'time', 'clipboard', 'note'])

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 把 fenced code block 與行內 code 遮成等長空白；保留換行與字元位置，供 TOKEN_RE 比對。 */
export function maskCode(text: string): string {
  let fence: string | null = null
  const masked = text.split('\n').map(line => {
    const match = line.match(/^\s*(`{3,}|~{3,})/)
    if (match) {
      if (!fence) fence = match[1]
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null
      return ' '.repeat(line.length)
    }
    return fence ? ' '.repeat(line.length) : line
  }).join('\n')
  return masked.replace(/(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g, match => match.replace(/[^\n]/g, ' '))
}

/** token（`{{` 與 `}}` 之間、已去頭尾空白的文字）前面若有單一反斜線，視為跳脫。 */
function isEscaped(original: string, matchIndex: number): boolean {
  return original[matchIndex - 1] === '\\'
}

function parseToken(token: string): VariableUsage {
  const colon = token.indexOf(':')
  const head = (colon < 0 ? token : token.slice(0, colon)).trim()
  if (BUILTIN_NAMES.has(head as BuiltinVariableName)) {
    const builtin = head as BuiltinVariableName
    const arg = colon < 0 ? undefined : token.slice(colon + 1).trim()
    if (builtin === 'note') {
      // note 一定要帶檔名，沒帶就不是內建變數，當成使用者變數處理
      return arg ? { kind: 'builtin', token, builtin, arg } : { kind: 'user', token, name: token }
    }
    if (builtin === 'date') return { kind: 'builtin', token, builtin, arg }
    // time、clipboard 不支援參數；帶了冒號就不認得，當使用者變數
    return colon < 0 ? { kind: 'builtin', token, builtin } : { kind: 'user', token, name: token }
  }
  return { kind: 'user', token, name: token }
}

/** 依出現順序列出用到的變數（含內建），跳過跳脫與 code 內的 token；同一個 token 只列一次。 */
export function extractVariableUsages(body: string): VariableUsage[] {
  const masked = maskCode(body)
  const seen = new Set<string>()
  const usages: VariableUsage[] = []
  for (const match of masked.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0
    if (isEscaped(body, index)) continue
    const token = match[1]
    if (seen.has(token)) continue
    seen.add(token)
    usages.push(parseToken(token))
  }
  return usages
}

export interface VariableDeclaration {
  name: string
  description: string
  defaultValue: string
  options: string[]
}

const VARIABLES_HEADING = '變數'

/** 找「## 變數」整節（含標題行）在 body 裡的字元範圍；找不到回傳 null。 */
function findVariablesSectionRange(body: string): { start: number, end: number } | null {
  const lines = body.split('\n')
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }
  const startLine = lines.findIndex(line => /^##\s+/.test(line) && line.replace(/^##\s+/, '').trim() === VARIABLES_HEADING)
  if (startLine < 0) return null
  let endLine = lines.length
  for (let i = startLine + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { endLine = i; break }
  }
  return { start: offsets[startLine], end: endLine >= lines.length ? body.length : offsets[endLine] }
}

/** 拿掉「## 變數」整節，供預覽／複製使用——那一節是變數文件，不是提示詞本文。 */
export function stripVariablesSection(body: string): string {
  const range = findVariablesSectionRange(body)
  if (!range) return body
  return body.slice(0, range.start) + body.slice(range.end)
}

/**
 * 解析「## 變數」段落。格式：
 * ```
 * ## 變數
 *
 * ### 名稱
 * 說明文字（可留白、可多行）
 * - 預設值：abc
 * - 選項：A, B, C
 * ```
 * 每個變數是一個 `###` 子標題；說明文字是子標題下、非列表的段落；
 * `- 預設值：` / `- default:` 給預設值；`- 選項：` / `- options:` 給候選選項（用 `,` 或 `、` 分隔）。
 * 只是補充文件，不是「宣告」本身——宣告看 frontmatter 的 `variables: [...]`。
 */
export function parseVariablesSection(body: string): Map<string, VariableDeclaration> {
  const map = new Map<string, VariableDeclaration>()
  const range = findVariablesSectionRange(body)
  if (!range) return map

  const lines = body.slice(range.start, range.end).split('\n').slice(1)
  let current: VariableDeclaration | null = null
  let descLines: string[] = []

  const flush = () => {
    if (current) {
      current.description = descLines.join('\n').trim()
      map.set(current.name, current)
    }
    descLines = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const sub = /^###\s+(.+)$/.exec(trimmed)
    if (sub) {
      flush()
      current = { name: sub[1].trim(), description: '', defaultValue: '', options: [] }
      continue
    }
    if (!current) continue
    const defaultMatch = /^-\s*(?:預設值|default)\s*[:：]\s*(.*)$/i.exec(trimmed)
    const optionsMatch = /^-\s*(?:選項|options)\s*[:：]\s*(.*)$/i.exec(trimmed)
    if (defaultMatch) { current.defaultValue = defaultMatch[1].trim(); continue }
    if (optionsMatch) {
      current.options = optionsMatch[1].split(/[,、]/).map(item => item.trim()).filter(Boolean)
      continue
    }
    if (trimmed) descLines.push(trimmed)
  }
  flush()
  return map
}

/** frontmatter 的 `variables` 欄位→已宣告的變數名稱集合；格式不對就當作沒宣告。 */
export function declaredVariableNames(frontmatterVariables: unknown): Set<string> {
  if (!Array.isArray(frontmatterVariables)) return new Set()
  return new Set(frontmatterVariables.filter((item): item is string => typeof item === 'string'))
}

export interface PromptVariableField {
  name: string
  declared: boolean
  /** 未宣告的變數＝必填自由文字 */
  required: boolean
  description: string
  defaultValue: string
  options: string[]
}

/** 提示詞本文用到的「使用者變數」表單欄位，依出現順序、不重複。 */
export function resolvePromptFields(body: string, frontmatterVariables: unknown): PromptVariableField[] {
  const usages = extractVariableUsages(body)
  const declarations = parseVariablesSection(body)
  const declared = declaredVariableNames(frontmatterVariables)
  return usages
    .filter((usage): usage is { kind: 'user', token: string, name: string } => usage.kind === 'user')
    .map(usage => {
      const isDeclared = declared.has(usage.name)
      const decl = declarations.get(usage.name)
      return {
        name: usage.name,
        declared: isDeclared,
        required: !isDeclared,
        description: decl?.description ?? '',
        defaultValue: decl?.defaultValue ?? '',
        options: decl?.options ?? [],
      }
    })
}

export interface RenderContext {
  now: Date
  clipboardText?: string
  /** 回傳 `note:檔名` 要嵌入的內文；找不到回傳 null/undefined。 */
  readNote?: (name: string) => string | null | undefined
  /** 使用者變數的填值，key 是變數名稱。 */
  values: Record<string, string>
}

function renderBuiltin(usage: { builtin: BuiltinVariableName, arg?: string }, context: RenderContext): string {
  switch (usage.builtin) {
    case 'date':
      return formatDate(context.now, usage.arg || 'YYYY-MM-DD')
    case 'time':
      return `${pad2(context.now.getHours())}:${pad2(context.now.getMinutes())}`
    case 'clipboard':
      return context.clipboardText ?? ''
    case 'note':
      return context.readNote?.(usage.arg ?? '') ?? ''
  }
}

/** 套用變數後的本文：跳脫還原、code 內原樣保留、內建與使用者變數依 context 代入。 */
export function renderPromptBody(body: string, context: RenderContext): string {
  const masked = maskCode(body)
  let result = ''
  let cursor = 0
  for (const match of masked.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0
    const full = match[0]
    const token = match[1]
    if (isEscaped(body, index)) {
      // 保留跳脫前的原文，再補 token 本身（原樣輸出），略過反斜線
      result += body.slice(cursor, index - 1) + full
      cursor = index + full.length
      continue
    }
    result += body.slice(cursor, index)
    const usage = parseToken(token)
    result += usage.kind === 'builtin' ? renderBuiltin(usage, context) : (context.values[usage.name] ?? '')
    cursor = index + full.length
  }
  result += body.slice(cursor)
  return result
}

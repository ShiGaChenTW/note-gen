/**
 * Phase 2-3a（軌道 A）共用：從一篇筆記的原文取出 `[[Note#標題]]` 的段落與 `[[Note#^id]]` 的區塊。
 * 純函式、無 I/O；嵌入轉入（A-1）與跳轉比對（A-2）共用同一套標題正規化。
 *
 * 規則照 Obsidian：
 * - 標題比對不分大小寫、去頭尾空白、連續空白視為一個；只認 ATX 標題（`#`～`######`），
 *   行尾的 `#` 會去掉；fenced code 與 frontmatter 內的 `#` 不算。
 * - `#標題` 的段落從該標題行開始，到下一個同級或更高級標題之前為止。
 * - 區塊 id 是行尾的 ` ^id`（`[A-Za-z0-9-]`，不分大小寫）。id 在段落行尾 → 整個段落；
 *   在清單項行尾 → 該清單項（含縮排的子行）；在表格列 → 整個表格；單獨一行（`^id` 在表格或
 *   清單後面自己一行）→ 它前面的那個區塊。回傳的文字已去掉 ` ^id` 標記。
 */

import { splitFrontmatter } from './frontmatter-split'

const FENCE_RE = /^\s*(`{3,}|~{3,})/
const ATX_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/
const ATX_EMPTY_RE = /^ {0,3}(#{1,6})[ \t]*$/
// 行尾的 `^id`；表格列允許後面還有關閉的 `|`
const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*(?:\|\s*)?$/
const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/
const TABLE_LINE_RE = /^\s*\|/

export interface HeadingLine {
  level: number
  text: string
  /** 0 起算的行號 */
  line: number
}

/** 去掉 frontmatter 與它後面的空行。 */
export function stripFrontmatter(content: string): string {
  const { block, body } = splitFrontmatter(content)
  if (!block) return content
  return body.replace(/^(?:\r?\n)+/, '')
}

/** 標題比對用的正規化：trim、連續空白合一、不分大小寫。 */
export function normalizeHeadingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** ATX 標題行的文字（去掉前導 `#` 與行尾 `#`）；不是標題時 null。 */
export function parseAtxHeading(line: string): { level: number, text: string } | null {
  const clean = line.replace(/\r$/, '')
  const m = ATX_RE.exec(clean)
  if (m) {
    // 行尾的關閉 `#`（前面要有空白）去掉
    const text = m[2].replace(/(?:^|\s)#+$/, '').trim()
    return { level: m[1].length, text }
  }
  const empty = ATX_EMPTY_RE.exec(clean)
  if (empty) return { level: empty[1].length, text: '' }
  return null
}

function splitLines(content: string): string[] {
  return content.split('\n')
}

/** 逐行走訪，告訴呼叫者這一行是不是在 fenced code 裡。 */
function* walkLines(lines: string[]): Generator<{ index: number, line: string, inFence: boolean }> {
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '')
    const fenceMatch = FENCE_RE.exec(line)
    if (fenceMatch) {
      if (fence === null) {
        fence = fenceMatch[1]
        yield { index: i, line, inFence: true }
        continue
      }
      if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null
        yield { index: i, line, inFence: true }
        continue
      }
    }
    yield { index: i, line, inFence: fence !== null }
  }
}

/** 內文（已去 frontmatter）裡所有 ATX 標題。 */
export function listHeadings(content: string): HeadingLine[] {
  const out: HeadingLine[] = []
  for (const { index, line, inFence } of walkLines(splitLines(content))) {
    if (inFence) continue
    const heading = parseAtxHeading(line)
    if (heading) out.push({ level: heading.level, text: heading.text, line: index })
  }
  return out
}

/**
 * `[[Note#標題]]` 的段落：從該標題行到下一個同級或更高級標題之前（含標題行）。
 * 找不到回傳 null。`content` 可含 frontmatter（會先去掉）。
 */
export function extractSection(content: string, heading: string): string | null {
  const wanted = normalizeHeadingText(heading)
  if (!wanted) return null
  const body = stripFrontmatter(content)
  const lines = splitLines(body)
  let start = -1
  let level = 0
  let end = lines.length
  for (const { index, line, inFence } of walkLines(lines)) {
    if (inFence) continue
    const parsed = parseAtxHeading(line)
    if (!parsed) continue
    if (start < 0) {
      if (normalizeHeadingText(parsed.text) === wanted) {
        start = index
        level = parsed.level
      }
      continue
    }
    if (parsed.level <= level) {
      end = index
      break
    }
  }
  if (start < 0) return null
  return trimBlankEdges(lines.slice(start, end).map(l => l.replace(/\r$/, ''))).join('\n')
}

function trimBlankEdges(lines: string[]): string[] {
  let a = 0
  let b = lines.length
  while (a < b && lines[a].trim() === '') a++
  while (b > a && lines[b - 1].trim() === '') b--
  return lines.slice(a, b)
}

function stripBlockIdMarker(line: string): string {
  return line.replace(/\s*\^[A-Za-z0-9-]+(?=\s*\|?\s*$)/, '').replace(/\s+$/, '')
}

/**
 * 顯示用：隱藏行尾的區塊 id（` ^blk-1`）與單獨一行的 `^id`，像 Obsidian 閱讀模式。
 * 只用在渲染前，不動檔案；程式碼區塊裡的內容不處理，`x^2` 這種沒有空白的不算區塊 id。
 */
export function hideBlockIds(markdown: string): string {
  const lines = splitLines(markdown)
  const out: string[] = []
  for (const { line, inFence } of walkLines(lines)) {
    if (inFence) { out.push(line); continue }
    if (/^\^[A-Za-z0-9-]+$/.test(line.trim())) continue
    out.push(BLOCK_ID_RE.test(line) ? stripBlockIdMarker(line) : line)
  }
  return out.join('\n')
}

function indentOf(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0
}

/**
 * 從 `idLine` 往前找區塊起點：清單項含它後面縮排更深的行，表格是連續的 `|` 行，
 * 段落是連續的非空行。回傳 [start, end)（end 不含）。
 */
function blockRangeAround(lines: string[], idLine: number): [number, number] {
  const line = lines[idLine].replace(/\r$/, '')
  if (TABLE_LINE_RE.test(line)) {
    let start = idLine
    while (start > 0 && TABLE_LINE_RE.test(lines[start - 1])) start--
    let end = idLine + 1
    while (end < lines.length && TABLE_LINE_RE.test(lines[end])) end++
    return [start, end]
  }
  const item = LIST_ITEM_RE.exec(line)
  if (item) {
    const indent = item[1].length
    let end = idLine + 1
    while (end < lines.length) {
      const next = lines[end].replace(/\r$/, '')
      if (next.trim() === '') break
      if (indentOf(next) <= indent) break
      end++
    }
    return [idLine, end]
  }
  // 段落：往前到空行或區塊邊界
  let start = idLine
  while (start > 0) {
    const prev = lines[start - 1].replace(/\r$/, '')
    if (prev.trim() === '' || parseAtxHeading(prev) || LIST_ITEM_RE.test(prev) || TABLE_LINE_RE.test(prev)) break
    start--
  }
  return [start, idLine + 1]
}

/** `^id` 單獨一行時指的是它前面的那個區塊（表格、清單或段落）。 */
function blockRangeBefore(lines: string[], idLine: number): [number, number] | null {
  let end = idLine
  while (end > 0 && lines[end - 1].trim() === '') end--
  if (end === 0) return null
  const last = lines[end - 1].replace(/\r$/, '')
  if (TABLE_LINE_RE.test(last)) {
    let start = end - 1
    while (start > 0 && TABLE_LINE_RE.test(lines[start - 1])) start--
    return [start, end]
  }
  let start = end - 1
  while (start > 0 && lines[start - 1].trim() !== '' && !parseAtxHeading(lines[start - 1])) start--
  return [start, end]
}

/**
 * `[[Note#^id]]` 的區塊；找不到回傳 null。回傳的文字已去掉 ` ^id`。
 */
export function extractBlock(content: string, blockId: string): string | null {
  const wanted = blockId.trim().toLowerCase()
  if (!wanted) return null
  const body = stripFrontmatter(content)
  const lines = splitLines(body)
  let idLine = -1
  for (const { index, line, inFence } of walkLines(lines)) {
    if (inFence) continue
    const m = BLOCK_ID_RE.exec(line)
    if (m && m[1].toLowerCase() === wanted) {
      idLine = index
      break
    }
  }
  if (idLine < 0) return null

  const bare = lines[idLine].replace(/\r$/, '').trim()
  const standalone = /^\^[A-Za-z0-9-]+$/.test(bare)
  const range = standalone ? blockRangeBefore(lines, idLine) : blockRangeAround(lines, idLine)
  if (!range) return null
  const [start, end] = range
  const out = lines.slice(start, end).map(l => l.replace(/\r$/, ''))
  if (!standalone) out[idLine - start] = stripBlockIdMarker(out[idLine - start])
  return trimBlankEdges(out).join('\n')
}

/** 內文裡有沒有這個區塊 id（跳轉前的快速檢查）。 */
export function findBlockIdLine(content: string, blockId: string): number | null {
  const wanted = blockId.trim().toLowerCase()
  if (!wanted) return null
  for (const { index, line, inFence } of walkLines(splitLines(content))) {
    if (inFence) continue
    const m = BLOCK_ID_RE.exec(line)
    if (m && m[1].toLowerCase() === wanted) return index
  }
  return null
}

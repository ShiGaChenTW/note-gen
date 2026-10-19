/**
 * Phase 2-2 L4：未連結提及。純函式、無 I/O。
 * 在筆記全文找出「寫了目標筆記的名稱或別名、但沒有用 [[ ]] 連起來」的位置，並能把那一段換成 wikilink。
 *
 * 比對規則（照 Obsidian）：
 * - ASCII 不分大小寫；名稱首尾是 ASCII 字母／數字時，相鄰字元不可以是 ASCII 字母／數字／`_`（`Note` 不命中 `Notes`）；
 *   CJK 不套邊界（中文沒有空格）。
 * - 跳過 frontmatter、fenced／inline code、`[[...]]` 內、markdown 連結 `[文字](目標)` 整段、URL、`#tag`。標題行要算。
 * - 同一位置多個名稱命中取最長；重疊的只留前面那個。
 */

import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'

export interface Mention {
  /** 對整份檔案 0 起算的行號（以 `\n` 切行） */
  line: number
  /** 在該行的字元起點 */
  column: number
  length: number
  /** 命中的原文（保留大小寫） */
  text: string
  /** 該行去頭尾空白、最多 160 字、以命中為中心的上下文 */
  context: string
  /** 命中文字在 `context` 內的起點；用來正確標示（同一行可能出現多次） */
  contextOffset: number
}

const CONTEXT_WIDTH = 160

/** 只把 ASCII 大寫轉小寫，其他字元（含 CJK、重音字母）原樣，長度不變。 */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, ch => ch.toLowerCase())
}

function isAsciiWord(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch)
}

function isAsciiAlnum(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch)
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

let mentionPatternCache: { key: string, source: string } | null = null

/** 多個名稱合成一個 RegExp，由長到短，ASCII 大小寫已先折好。 */
function mentionPattern(names: string[]): RegExp {
  const key = `${names.length}\0${names.join('\0')}`
  if (!mentionPatternCache || mentionPatternCache.key !== key) {
    mentionPatternCache = { key, source: names.map(name => escapeRegExp(asciiLower(name))).join('|') }
  }
  return new RegExp(mentionPatternCache.source, 'g')
}

/** 名稱清單：去空白、長度 < 2 或純數字的略過、不分大小寫去重、長的在前。 */
export function normalizeMentionNames(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (name.length < 2 || /^\d+$/.test(name)) continue
    const key = asciiLower(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out.sort((a, b) => b.length - a.length)
}

/**
 * 回傳與 `content` 等長的遮罩字串：不能當提及的位置是空白，其餘保留原字元。
 * 遮掉 frontmatter、code、`[[ ]]`、markdown 連結、URL、`#tag`。
 */
function maskContent(content: string): string {
  const { block } = splitFrontmatter(content)
  const blank = (text: string) => text.replace(/[^\r\n]/g, ' ')
  let fence: string | null = null
  const lines = content.split('\n').map(line => {
    const bare = line.replace(/\r$/, '')
    const fenceMatch = bare.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
      return blank(line)
    }
    if (fence !== null) return blank(line)
    return line
      // inline code
      .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, blank)
      // wikilink 與嵌入
      .replace(/!?\[\[[^\]\n]*?\]\]/g, blank)
      // markdown 連結與圖片整段
      .replace(/!?\[[^\]\n]*\]\([^)\n]*\)/g, blank)
      // URL
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, blank)
      // 標籤（規則同索引）
      .replace(/(^|[\s(（])(#(?:[^\s\p{P}\p{S}]|[-_])+(?:\/(?:[^\s\p{P}\p{S}]|[-_])+)*)/gmu, (_m, lead: string, tag: string) => lead + blank(tag))
  })
  let masked = lines.join('\n')
  if (block) masked = blank(block) + masked.slice(block.length)
  return masked
}

function contextOf(line: string, column: number, length: number): { context: string, contextOffset: number } {
  const start = Math.max(0, Math.min(column - Math.floor((CONTEXT_WIDTH - Math.min(length, CONTEXT_WIDTH)) / 2), line.length - CONTEXT_WIDTH))
  const slice = line.slice(start, start + CONTEXT_WIDTH)
  const leading = slice.length - slice.trimStart().length
  return { context: slice.trim(), contextOffset: column - start - leading }
}

/**
 * 找出 `content` 內所有未連結的提及。
 * @param names 目標筆記的 `noteKeyOf(path)` 與 `aliases`
 */
export function findUnlinkedMentions(content: string, names: string[]): Mention[] {
  const wanted = normalizeMentionNames(names)
  if (wanted.length === 0 || !content) return []
  const masked = maskContent(content)
  const lines = content.split('\n')
  const maskedLines = masked.split('\n')
  const pattern = mentionPattern(wanted)
  const needles = wanted.map(name => asciiLower(name))
  const out: Mention[] = []

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].replace(/\r$/, '')
    const lowerMasked = asciiLower(maskedLines[lineNo])
    if (!line.trim()) continue
    const hits: Array<{ column: number, length: number }> = []
    pattern.lastIndex = 0
    while (pattern.lastIndex <= lowerMasked.length) {
      const found = pattern.exec(lowerMasked)
      if (!found) break
      const at = found.index
      const matched = found[0]
      if (matched.length === 0) {
        pattern.lastIndex = at + 1
        continue
      }
      // 最長名稱可能因邊界失敗，同一位置較短的前綴名稱仍要留下。
      let step = 1
      for (const needle of needles) {
        if (needle.length > matched.length || !matched.startsWith(needle)) continue
        const headBound = isAsciiAlnum(needle[0])
        const tailBound = isAsciiAlnum(needle[needle.length - 1])
        if (headBound && isAsciiWord(line[at - 1])) continue
        if (tailBound && isAsciiWord(line[at + needle.length])) continue
        hits.push({ column: at, length: needle.length })
        if (needle.length > step) step = needle.length
      }
      pattern.lastIndex = at + step
    }
    // 同一位置取最長，重疊的只留前面那個
    hits.sort((a, b) => a.column - b.column || b.length - a.length)
    let cursor = -1
    for (const hit of hits) {
      if (hit.column < cursor) continue
      cursor = hit.column + hit.length
      const text = line.slice(hit.column, cursor)
      out.push({ line: lineNo, column: hit.column, length: hit.length, text, ...contextOf(line, hit.column, hit.length) })
    }
  }
  return out
}

function lineStartOffset(content: string, line: number): number {
  let offset = 0
  for (let i = 0; i < line; i++) {
    const next = content.indexOf('\n', offset)
    if (next < 0) return content.length
    offset = next + 1
  }
  return offset
}

/**
 * 把一個提及換成 `[[target]]`；命中文字與 `target` 不同（大小寫或別名）時寫 `[[target|命中文字]]`。
 * 在表格列（行首 `|`）用 `\|`。位置上的文字已經不是 `mention.text` 時原樣回傳（檔案被改過）。
 * 同一篇多筆要由後往前呼叫（見 `linkMentions`）。
 */
export function linkMention(content: string, mention: Mention, target: string): string {
  const start = lineStartOffset(content, mention.line) + mention.column
  const end = start + mention.length
  if (content.slice(start, end) !== mention.text) return content
  const lineEnd = content.indexOf('\n', start)
  const line = content.slice(lineStartOffset(content, mention.line), lineEnd < 0 ? content.length : lineEnd)
  const pipe = /^\s*\|/.test(line) ? '\\|' : '|'
  const link = mention.text === target ? `[[${target}]]` : `[[${target}${pipe}${mention.text}]]`
  return `${content.slice(0, start)}${link}${content.slice(end)}`
}

/** 同一篇多筆：由後往前一次改完，避免位移。 */
export function linkMentions(content: string, mentions: Mention[], target: string): string {
  const ordered = [...mentions].sort((a, b) => b.line - a.line || b.column - a.column)
  let next = content
  for (const mention of ordered) next = linkMention(next, mention, target)
  return next
}

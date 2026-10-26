/**
 * 變數統一偵測（#55）：Prompt 素材整理成提示詞時，AI 不改寫原文的唯一例外——
 * 把 `[主題]`、`<topic>`、`{topic}`、`$TOPIC` 這類常見佔位符寫法統一成 `{{...}}`。
 *
 * 偵測是純規則（不靠 AI），好讓「原文除勾選的替換外完全不變」可以被測試保證；
 * AI 只負責在審核畫面幫忙描述每個變數的用途。偵測在遮掉 code 區塊後的文字上做
 * （沿用 variables.ts 的 maskCode），所以 fenced code block 與行內 code 裡的寫法不會被誤判。
 */

import { maskCode } from './variables'

export type VariableUnificationStyle = 'bracket' | 'angle' | 'brace' | 'dollar'

export interface VariableUnificationCandidate {
  id: string
  style: VariableUnificationStyle
  /** 原文裡被取代的完整字串，例如 `[主題]`。 */
  raw: string
  /** 統一後要用的變數名稱（`{{名稱}}` 的名稱）。 */
  variableName: string
  /** 完整的取代字串，`{{變數名稱}}`。 */
  replacement: string
  start: number
  end: number
}

export interface VariableUnificationGroup {
  variableName: string
  replacement: string
  /** 這個變數在原文裡用過的所有寫法，依出現順序、不重複。 */
  rawVariants: string[]
  occurrences: VariableUnificationCandidate[]
}

const BRACKET_RE = /\[([^[\]\n]{1,40})\]/g
const ANGLE_RE = /<([a-zA-Z_一-鿿][\w一-鿿-]{0,40})>/g
// 負向前後查找排除 `{{...}}`：已經是正式語法，不是要統一的對象。
const BRACE_RE = /(?<!\{)\{([^{}\n]{1,40})\}(?!\})/g
const DOLLAR_RE = /\$([A-Za-z_][A-Za-z0-9_]{0,40})\b/g

// <xxx> 常見是 HTML 標籤而不是佔位符，出現這些名字就不當候選。
const HTML_TAGS = new Set([
  'div', 'span', 'br', 'p', 'a', 'img', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'b', 'i', 'u', 's', 'small', 'blockquote', 'script', 'style', 'sub', 'sup', 'kbd',
  'mark', 'hr', 'video', 'audio', 'iframe', 'svg', 'path', 'button', 'input', 'label',
  'details', 'summary', 'figure', 'figcaption', 'nav', 'section', 'article', 'header', 'footer',
])

/** `$TOPIC` 這種全大寫底線風格統一轉小寫，貼近既有變數慣例（`{{topic}}`）；其餘原樣保留。 */
function normalizeVariableName(raw: string): string {
  const trimmed = raw.trim()
  return /^[A-Z_][A-Z0-9_]*$/.test(trimmed) ? trimmed.toLowerCase() : trimmed
}

function collect(
  masked: string,
  re: RegExp,
  style: VariableUnificationStyle,
  isValid: (match: RegExpMatchArray, masked: string) => boolean,
): VariableUnificationCandidate[] {
  const out: VariableUnificationCandidate[] = []
  for (const match of masked.matchAll(re)) {
    if (!isValid(match, masked)) continue
    const variableName = normalizeVariableName(match[1])
    if (!variableName) continue
    const start = match.index ?? 0
    const raw = match[0]
    out.push({
      id: `${style}:${start}`,
      style,
      raw,
      variableName,
      replacement: `{{${variableName}}}`,
      start,
      end: start + raw.length,
    })
  }
  return out
}

function isCheckboxBracket(inner: string): boolean {
  return /^[xX]?$/.test(inner.trim())
}

/** 依出現順序列出候選（已略過 code 區塊），不重疊；同一個變數名稱可能來自不同寫法。 */
export function findVariableUnificationCandidates(body: string): VariableUnificationCandidate[] {
  const masked = maskCode(body)

  const bracket = collect(masked, BRACKET_RE, 'bracket', (match, text) => {
    if (isCheckboxBracket(match[1])) return false // 待辦清單的「[ ]」「[x]」
    const next = text[(match.index ?? 0) + match[0].length]
    return next !== '(' // 排除 markdown 連結／圖片的 [text](url)
  })

  const angle = collect(masked, ANGLE_RE, 'angle', match => !HTML_TAGS.has(match[1].toLowerCase()))

  const brace = collect(masked, BRACE_RE, 'brace', () => true)

  const dollar = collect(masked, DOLLAR_RE, 'dollar', () => true)

  return [...bracket, ...angle, ...brace, ...dollar].sort((a, b) => a.start - b.start)
}

/** 把候選依變數名稱分組，供審核畫面「一個變數一組勾選」使用。 */
export function groupVariableUnificationCandidates(
  candidates: readonly VariableUnificationCandidate[],
): VariableUnificationGroup[] {
  const groups = new Map<string, VariableUnificationGroup>()
  for (const candidate of candidates) {
    let group = groups.get(candidate.variableName)
    if (!group) {
      group = {
        variableName: candidate.variableName,
        replacement: candidate.replacement,
        rawVariants: [],
        occurrences: [],
      }
      groups.set(candidate.variableName, group)
    }
    if (!group.rawVariants.includes(candidate.raw)) group.rawVariants.push(candidate.raw)
    group.occurrences.push(candidate)
  }
  return [...groups.values()].sort((a, b) => a.occurrences[0].start - b.occurrences[0].start)
}

/**
 * 套用勾選的統一；`accepted` 是要套用的 candidate id 集合。未勾選的字元完全不變——
 * 這是本功能唯一要保證的不變量，變動前請先確認 variable-unification.test.ts 全綠。
 */
export function applyVariableUnifications(
  body: string,
  candidates: readonly VariableUnificationCandidate[],
  accepted: ReadonlySet<string>,
): string {
  const toApply = [...candidates]
    .filter(candidate => accepted.has(candidate.id))
    .sort((a, b) => a.start - b.start)

  let result = ''
  let cursor = 0
  for (const candidate of toApply) {
    if (candidate.start < cursor) continue // 安全網：重疊就跳過，不動已經套用的範圍
    result += body.slice(cursor, candidate.start) + candidate.replacement
    cursor = candidate.end
  }
  result += body.slice(cursor)
  return result
}

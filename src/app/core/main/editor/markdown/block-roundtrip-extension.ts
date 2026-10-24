// Fork (Phase 2-4, Issue #18): 頂層區塊原文往返與區塊間空行。
//
// 上游 `@tiptap/markdown` 存檔時有兩個會改動檔案的習慣：
// 1. `doc` 節點一律用一個空行接頂層區塊，所以「標題緊接清單」會多出一個空行；
// 2. 每種區塊都重新排版（`*` 變 `-`、`1)` 變 `1.`、setext 標題變 ATX、tab 縮排變空白、
//    空清單項 `-` 變 `- &nbsp;`）。
//
// 做法沿用表格原文往返（table-raw-extension.ts）：
// - 載入時把 marked 給的 `token.raw` 與內容簽章存進頂層區塊節點（`rendered: false`，
//   不進 HTML 也不進剪貼簿）；存檔時簽章相同代表沒動過，直接輸出原文。
// - 同時從 token raw 的結尾換行數算出每個頂層區塊「前面有幾個空行」，存成 `gapBefore`；
//   存檔時由 `BlockRoundtripDocument` 依它決定區塊之間放幾個換行。0 個空行只在
//   CommonMark 不會因此改變結構時才採用（例如標題後可以緊接任何區塊，但段落後不能緊接
//   `---`，否則會變 setext 標題），其他情況回到上游的一個空行。
//
// 包法：`parse()` 走 marked 的 token 流一個一個丟給上游 `parseToken`，所以每個 token 的
// 解析結果與以前完全相同，只是多掛屬性。
import { Extension, Node, type JSONContent } from '@tiptap/core'
import type { MarkdownManager } from '@tiptap/markdown'
import { isTaskItem } from '@tiptap/markdown'
import type { Schema } from '@tiptap/pm/model'

export const BLOCK_GAP_ATTR = 'gapBefore'
export const BLOCK_RAW_ATTR = 'rawMarkdown'
export const BLOCK_SIGNATURE_ATTR = 'rawSignature'

/** 會記原文的頂層區塊。table、bases 區塊、frontmatter 各自有原文機制，不在內。 */
export const RAW_BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
] as const

/** 會記「前面幾個空行」的頂層區塊。 */
export const GAP_BLOCK_TYPES = [
  ...RAW_BLOCK_TYPES,
  'table',
  'basesBlock',
  'blockMath',
  'mermaidDiagram',
] as const

const RAW_TYPES = new Set<string>(RAW_BLOCK_TYPES)
const GAP_TYPES = new Set<string>(GAP_BLOCK_TYPES)
/** 以單行或圍欄結束、後面接任何區塊都不會被吃進去的區塊。 */
const SELF_TERMINATING = new Set(['heading', 'codeBlock', 'horizontalRule', 'frontmatter', 'basesBlock', 'mermaidDiagram'])
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])
/** 簽章要忽略的屬性：本模組自己的、載入後才非同步補上的（圖片 src）、連結的預設屬性。 */
const VOLATILE_ATTRS = new Set([
  BLOCK_GAP_ATTR,
  BLOCK_RAW_ATTR,
  BLOCK_SIGNATURE_ATTR,
  'src',
  'relativeSrc',
  'uploading',
  'target',
  'rel',
  'class',
])

type LooseToken = {
  type?: string
  raw?: string
  items?: LooseToken[]
  [key: string]: unknown
}

type ManagerInternals = {
  markedInstance?: { lexer: (src: string) => LooseToken[] }
  parseToken: (token: LooseToken) => JSONContent | JSONContent[] | null
}

function stableAttrs(node: JSONContent): Record<string, unknown> {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(attrs).sort()) {
    if (VOLATILE_ATTRS.has(key)) continue
    out[key] = attrs[key]
  }
  if (node.type === 'image') out.src = attrs.relativeSrc || attrs.src || ''
  return out
}

function markKey(mark: NonNullable<JSONContent['marks']>[number]): string {
  const attrs = (mark.attrs ?? {}) as Record<string, unknown>
  const kept = Object.keys(attrs)
    .filter(key => !VOLATILE_ATTRS.has(key) && attrs[key] !== null && attrs[key] !== undefined)
    .sort()
    .map(key => `${key}=${JSON.stringify(attrs[key])}`)
  return kept.length ? `${mark.type}(${kept.join(',')})` : mark.type
}

type SignatureNode =
  | { t: string, m: string }
  | { y: string, a: Record<string, unknown>, c: SignatureNode[] }

/** 相鄰且 mark 相同的文字節點先合併：marked 解析出的片段與 ProseMirror 載入後的切法不一定一樣。 */
function normalizeNodes(nodes: JSONContent[] | undefined): SignatureNode[] {
  const out: SignatureNode[] = []
  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      const marks = (node.marks ?? []).map(markKey).sort().join('+')
      const last = out[out.length - 1]
      if (last && 't' in last && last.m === marks) {
        last.t += node.text ?? ''
        continue
      }
      out.push({ t: node.text ?? '', m: marks })
      continue
    }
    out.push({ y: node.type ?? '', a: stableAttrs(node), c: normalizeNodes(node.content) })
  }
  return out
}

/** 一個區塊的內容簽章：型別、穩定屬性、合併後的子節點。 */
export function blockSignature(node: JSONContent): string {
  return JSON.stringify({ y: node.type ?? '', a: stableAttrs(node), c: normalizeNodes(node.content) })
}

/** 輸出用的原文：去掉結尾的換行，區塊之間的換行由 doc 節點放。 */
function normalizeRaw(raw: string): string {
  return raw.replace(/(?:\r?\n)+$/, '')
}

/** 節點沒被動過（簽章相同）時可以直接輸出的原文；否則 null。 */
export function rawBlockMarkdownIfUnchanged(node: JSONContent): string | null {
  if (!node.type || !RAW_TYPES.has(node.type)) return null
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  const raw = attrs[BLOCK_RAW_ATTR]
  if (typeof raw !== 'string' || !raw.trim()) return null
  if (attrs[BLOCK_SIGNATURE_ATTR] !== blockSignature(node)) return null
  return normalizeRaw(raw)
}

function countNewlines(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++
  return count
}

/** token 結尾的空白（含換行）；marked 的區塊 raw 常把後面的空行一起吃進來。 */
function trailingWhitespace(raw: string): string {
  return raw.slice(raw.replace(/\s+$/, '').length)
}

/**
 * 上游把混合了任務項與一般項的 list token 拆成多個節點（連續的同類項目一組）。
 * 回傳每一組的項目 raw 串接，順序與拆出來的節點相同；marked 的項目 raw 剛好拼成整個清單的 raw。
 */
function listGroupRaws(token: LooseToken): string[] {
  const items = token.items ?? []
  const groups: string[] = []
  let current: string | null = null
  let currentIsTask: boolean | null = null
  for (const item of items) {
    const isTask = isTaskItem(item as never).isTask
    const raw = typeof item.raw === 'string' ? item.raw : ''
    if (current !== null && isTask === currentIsTask) {
      current += raw
      continue
    }
    if (current !== null) groups.push(current)
    current = raw
    currentIsTask = isTask
  }
  if (current !== null) groups.push(current)
  return groups
}

/**
 * 取代 `MarkdownManager.parse`：同樣用 marked 分詞、同樣逐個 token 交給上游解析，
 * 只在頂層節點多掛 `gapBefore`（前面幾個空行）與原文／簽章。
 */
export function parseWithBlockRoundtrip(manager: MarkdownManager, getSchema: () => Schema, markdown: string): JSONContent {
  const internals = manager as unknown as ManagerInternals
  if (!internals.markedInstance) throw new Error('No marked instance available for parsing')
  const tokens = internals.markedInstance.lexer(markdown)
  // raw 必須剛好拼回整份原文，否則不信任由它算出來的空行數（自訂 tokenizer 若吃掉多餘字元會對不準）
  const normalized = markdown.replace(/\r\n|\r/g, '\n')
  const tiles = tokens.reduce((sum, token) => sum + (token.raw?.length ?? 0), 0) === normalized.length
  const content: JSONContent[] = []
  let pendingNewlines = 0
  let hasPrevious = false

  const attachRaw = (node: JSONContent, raw: string) => {
    if (!node.type || !RAW_TYPES.has(node.type) || !raw.trim()) return
    try {
      // 先經過 schema 補上預設屬性，簽章才跟存檔時 getJSON() 看到的一致
      const canonical = getSchema().nodeFromJSON(node).toJSON() as JSONContent
      node.attrs = {
        ...(node.attrs ?? {}),
        [BLOCK_RAW_ATTR]: raw,
        [BLOCK_SIGNATURE_ATTR]: blockSignature(canonical),
      }
    } catch {
      // 內容不合 schema 時交給上游照常處理，只是沒有原文可用
    }
  }
  const setGap = (node: JSONContent, newlines: number) => {
    if (!node.type || !GAP_TYPES.has(node.type)) return
    node.attrs = { ...(node.attrs ?? {}), [BLOCK_GAP_ATTR]: Math.max(0, newlines - 1) }
  }

  for (const token of tokens) {
    const raw = typeof token.raw === 'string' ? token.raw : ''
    if (token.type === 'space') {
      pendingNewlines += countNewlines(raw)
      continue
    }
    const parsed = internals.parseToken(token)
    const nodes = parsed === null || parsed === undefined ? [] : Array.isArray(parsed) ? parsed : [parsed]
    if (nodes.length === 0) {
      pendingNewlines += countNewlines(raw)
      continue
    }
    if (tiles) {
      if (hasPrevious) setGap(nodes[0], pendingNewlines)
      if (nodes.length === 1) {
        attachRaw(nodes[0], raw)
      } else if (token.type === 'list') {
        // 混合清單被拆成多個節點：每一段用自己那幾個項目的原文，段與段之間照項目結尾的換行數緊接
        const groupRaws = listGroupRaws(token)
        // 最後一個項目的 raw 常少了清單 raw 結尾的換行，比對時兩邊都去掉結尾空白
        if (groupRaws.length === nodes.length && groupRaws.join('').trimEnd() === raw.trimEnd()) {
          nodes.forEach((node, index) => {
            attachRaw(node, groupRaws[index])
            if (index > 0) setGap(node, countNewlines(trailingWhitespace(groupRaws[index - 1])))
          })
        }
      }
    }
    content.push(...nodes)
    hasPrevious = true
    pendingNewlines = countNewlines(trailingWhitespace(raw))
  }

  return { type: 'doc', content }
}

function firstListItemIsEmpty(list: JSONContent): boolean {
  const item = list.content?.[0]
  const blocks = item?.content ?? []
  if (blocks.length === 0) return true
  if (blocks.length > 1) return false
  return blocks[0].type === 'paragraph' && !(blocks[0].content?.length)
}

/** 兩個頂層區塊之間不放空行（只有一個換行）會不會改變 CommonMark 的解析結構。 */
export function canBeTight(prev: JSONContent, next: JSONContent): boolean {
  const prevType = prev.type ?? ''
  const nextType = next.type ?? ''
  if (!GAP_TYPES.has(nextType)) return false
  if (SELF_TERMINATING.has(prevType)) return true
  // 前一個是段落、引用、清單或表格：只有能「打斷」它們的區塊才能緊接
  if (!RAW_TYPES.has(prevType) && prevType !== 'table') return false
  switch (nextType) {
    case 'heading':
    case 'codeBlock':
    case 'blockquote':
    case 'basesBlock':
    case 'mermaidDiagram':
      return true
    case 'horizontalRule':
      return prevType !== 'paragraph' // 段落後的 --- 是 setext 標題
    case 'bulletList':
    case 'taskList':
      // 清單接清單：有沒有空行都會被 CommonMark 視為同一個清單（差別只在 loose／tight），
      // 載入時緊接的就照原樣緊接
      if (LIST_TYPES.has(prevType) || prevType === 'table') return true
      return !firstListItemIsEmpty(next) // 空項目打不斷段落
    case 'orderedList': {
      if (LIST_TYPES.has(prevType) || prevType === 'table') return true
      const start = (next.attrs as Record<string, unknown> | undefined)?.start
      return (start === undefined || start === null || start === 1) && !firstListItemIsEmpty(next)
    }
    default:
      // 段落、表格、數學區塊都會被前一個段落／清單／引用／表格吃成延續行
      return false
  }
}

/**
 * 在編輯器裡新建的空段落（沒有內容、也不是載入時帶著原文的）。
 * 載入時就存在的 `&nbsp;` 行有原文，仍原樣輸出，既有檔案不會被改動。
 */
function isNewEmptyParagraph(node: JSONContent): boolean {
  return node.type === 'paragraph' && !(node.content?.length) && rawBlockMarkdownIfUnchanged(node) === null
}

/** 區塊之間要放的換行：依 `gapBefore`，0 只在不改變結構時採用。 */
export function blockSeparator(prev: JSONContent, next: JSONContent): string {
  const gap = (next.attrs as Record<string, unknown> | undefined)?.[BLOCK_GAP_ATTR]
  if (typeof gap !== 'number' || !Number.isFinite(gap) || gap < 0) return '\n\n'
  if (gap === 0) return canBeTight(prev, next) ? '\n' : '\n\n'
  return '\n'.repeat(gap + 1)
}

/**
 * 取代 StarterKit 的 Document（`document: false`）：結構一樣，只有 renderMarkdown 不同——
 * 沒動過的頂層區塊輸出原文，區塊之間的空行數照載入時記的。
 */
export const BlockRoundtripDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',

  renderMarkdown: (node, helpers) => {
    const children = node.content ?? []
    let output = ''
    let previous: JSONContent | null = null
    // Fork (#17)：編輯器裡按 Enter 留下的空段落不再存成 `&nbsp;` 行，改成多一個空行
    // （Obsidian 開起來是單純的空行）。結尾的空段落直接省略。
    let extraBlankLines = 0
    for (const child of children) {
      if (isNewEmptyParagraph(child)) { extraBlankLines++; continue }
      const rendered = rawBlockMarkdownIfUnchanged(child) ?? helpers.renderChildren([child])
      if (previous) output += blockSeparator(previous, child) + '\n'.repeat(extraBlankLines)
      else output += '\n'.repeat(extraBlankLines)
      extraBlankLines = 0
      output += rendered
      previous = child
    }
    return output
  },
})

const PATCHED = Symbol.for('notegen.blockRoundtrip')

/** 掛上原文／簽章／空行數三個屬性，並在 Markdown 擴充建好 `editor.markdown` 之後把 `parse` 換掉。 */
export const BlockRoundtrip = Extension.create({
  name: 'blockRoundtrip',
  // 要排在 Markdown（預設 100）之後建立，onBeforeCreate 時 editor.markdown 才存在
  priority: 50,

  addGlobalAttributes() {
    const hidden = { default: null, rendered: false, keepOnSplit: false }
    return [
      { types: [...GAP_BLOCK_TYPES], attributes: { [BLOCK_GAP_ATTR]: hidden } },
      { types: [...RAW_BLOCK_TYPES], attributes: { [BLOCK_RAW_ATTR]: hidden, [BLOCK_SIGNATURE_ATTR]: hidden } },
    ]
  },

  onBeforeCreate() {
    const editor = this.editor
    const manager = editor.markdown as (MarkdownManager & { [PATCHED]?: boolean }) | undefined
    if (!manager || manager[PATCHED]) return
    manager[PATCHED] = true
    manager.parse = (markdown: string) => parseWithBlockRoundtrip(manager, () => editor.schema, markdown)
  },
})

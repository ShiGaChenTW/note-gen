// Fork (Phase 2-3a, A-3): 表格原文往返。
//
// 上游 `@tiptap/extension-table` 的 `renderTableToMarkdown` 會重排表格：`|---|---|`
// 補成 `| --- | --- |`、儲存格補空白到等寬、對齊列 `|:--|` 丟掉，而且輸出開頭固定多一個
// `\n`（再加上序列化器在區塊之間放的空行，就成了表前多一個空行）。
//
// 做法：載入時把 marked 給的 `token.raw`（原始表格文字）存進 table 節點的 `rawMarkdown`
// 屬性，另存一個由儲存格內容算出的簽章 `rawSignature`。存檔時重算簽章：相同代表使用者
// 沒動過這個表格，直接輸出原文；不同（改了格子、加減列欄、套粗體）就走原本的序列化器。
// 兩個屬性 `rendered: false`，不會出現在 HTML 或剪貼簿。
import type { JSONContent, MarkdownParseHelpers, MarkdownRendererHelpers, MarkdownToken, Node } from '@tiptap/core'

export const TABLE_RAW_ATTR = 'rawMarkdown'
export const TABLE_SIGNATURE_ATTR = 'rawSignature'

const CELL_SEP = '\u0001'
const ROW_SEP = '\u0002'

/** 非文字節點用來辨識的屬性：wikilink 的原文、數學的 latex、圖片的 src。 */
function atomKey(node: JSONContent): string {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  const key = attrs.raw ?? attrs.latex ?? attrs.src ?? ''
  return typeof key === 'string' ? key : JSON.stringify(key)
}

/**
 * 一串 inline／block 節點的簽章。相鄰且 mark 相同的文字節點會先合併，
 * 因為 marked 解析出來的 JSON 可能是多個片段，而 ProseMirror 載入後會合成一個。
 * mark 只看型別不看屬性（連結的 target、rel 等預設值在載入後才補上）。
 */
function contentSignature(nodes: JSONContent[] | undefined): string {
  if (!nodes || nodes.length === 0) return ''
  const parts: string[] = []
  let runMarks: string | null = null
  let runText = ''
  const flush = () => {
    if (runMarks === null) return
    parts.push(runMarks ? `${runMarks}{${runText}}` : runText)
    runMarks = null
    runText = ''
  }
  for (const node of nodes) {
    if (node.type === 'text') {
      const marks = (node.marks ?? []).map(mark => mark.type).sort().join('+')
      if (runMarks !== null && runMarks !== marks) flush()
      runMarks = marks
      runText += node.text ?? ''
      continue
    }
    flush()
    parts.push(`<${node.type ?? ''}:${atomKey(node)}>(${contentSignature(node.content)})`)
  }
  flush()
  return parts.join('')
}

/** 整個表格的簽章：每格內容以 \u0001 連接、每列以 \u0002 連接（含表頭列）。 */
export function tableSignature(table: JSONContent): string {
  const rows = table.content ?? []
  return rows
    .map(row => (row.content ?? []).map(cell => contentSignature(cell.content)).join(CELL_SEP))
    .join(ROW_SEP)
}

/** 輸出用的原文：去掉尾端換行，讓序列化器自己在區塊之間放空行。 */
export function normalizeRawTable(raw: string): string {
  return raw.replace(/(?:\r?\n)+$/, '')
}

/** 節點沒被動過（簽章相同）時可以直接輸出的原文；否則 null。 */
export function rawTableMarkdownIfUnchanged(node: JSONContent): string | null {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  const raw = attrs[TABLE_RAW_ATTR]
  if (typeof raw !== 'string' || !raw.trim()) return null
  if (attrs[TABLE_SIGNATURE_ATTR] !== tableSignature(node)) return null
  return normalizeRawTable(raw)
}

/**
 * 套在 Table 節點（或它的 extend 結果）上：載入時記住原文與簽章，存檔時沒動過就輸出原文。
 * 被包的節點自己的 `parseMarkdown`／`renderMarkdown` 都保留，作為原文不可用時的路徑。
 */
export function withRawTableRoundtrip<T extends Node<any, any>>(TableExtension: T): T {
  const baseParse = TableExtension.config.parseMarkdown as
    | ((token: MarkdownToken, helpers: MarkdownParseHelpers) => unknown)
    | undefined
  const baseRender = TableExtension.config.renderMarkdown as
    | ((node: JSONContent, helpers: MarkdownRendererHelpers, context: unknown) => string)
    | undefined

  const extended = (TableExtension as Node<any, any>).extend({
    addAttributes() {
      return {
        ...(this.parent?.() ?? {}),
        [TABLE_RAW_ATTR]: { default: null, rendered: false },
        [TABLE_SIGNATURE_ATTR]: { default: null, rendered: false },
      }
    },

    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) => {
      const parsed = baseParse ? baseParse(token, helpers) : undefined
      // marked 的 table token（含 2-1 的 WikilinkTable tokenizer 轉交的）都帶 raw
      if (!parsed || Array.isArray(parsed) || typeof token.raw !== 'string' || !token.raw) {
        return parsed as JSONContent
      }
      const node = parsed as JSONContent
      node.attrs = {
        ...(node.attrs ?? {}),
        [TABLE_RAW_ATTR]: token.raw,
        [TABLE_SIGNATURE_ATTR]: tableSignature(node),
      }
      return node
    },

    renderMarkdown: (node: JSONContent, helpers: MarkdownRendererHelpers, context: unknown) => {
      const raw = rawTableMarkdownIfUnchanged(node)
      if (raw !== null) return raw
      return baseRender ? baseRender(node, helpers, context) : ''
    },
  })
  return extended as T
}

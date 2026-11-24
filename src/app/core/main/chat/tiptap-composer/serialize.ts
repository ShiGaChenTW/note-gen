// Spike（almanac ALMNC-77）：TipTap 對話輸入框的文件 ↔ 送出文字轉換。純函式，不碰 DOM，方便單元測試。
import type { JSONContent } from '@tiptap/core'

export const COMPOSER_MENTION_NODE = 'composerMention'

export type ComposerMentionKind = 'file' | 'record' | 'canvas'

export interface ComposerMentionAttrs {
  /** 與 getMentionedContextKey() 相同的鍵，用來找回要附加的上下文。 */
  id: string
  kind: ComposerMentionKind
  /** 膠囊上顯示、也是送給模型的名稱。 */
  label: string
}

export interface SerializedComposer {
  /** 送給模型、存進對話紀錄的文字；提及留在原位，寫成 @名稱。 */
  text: string
  /** 文件裡出現的提及，依出現順序，同一個 id 只留第一個。 */
  mentions: ComposerMentionAttrs[]
}

export function normalizeMentionLabel(label: string, fallback: string) {
  const collapsed = label.replace(/\s+/g, ' ').trim()
  return collapsed || fallback
}

export function formatMentionToken(attrs: Pick<ComposerMentionAttrs, 'label'>) {
  return `@${attrs.label}`
}

function isMentionKind(value: unknown): value is ComposerMentionKind {
  return value === 'file' || value === 'record' || value === 'canvas'
}

export function readMentionAttrs(attrs: Record<string, unknown> | undefined): ComposerMentionAttrs | null {
  const id = typeof attrs?.id === 'string' ? attrs.id : ''
  if (!id) return null
  const label = typeof attrs?.label === 'string' ? attrs.label : ''
  return {
    id,
    kind: isMentionKind(attrs?.kind) ? attrs.kind : 'file',
    label: normalizeMentionLabel(label, id),
  }
}

function serializeNode(node: JSONContent, mentions: ComposerMentionAttrs[], seen: Set<string>): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === COMPOSER_MENTION_NODE) {
    const attrs = readMentionAttrs(node.attrs)
    if (!attrs) return ''
    if (!seen.has(attrs.id)) {
      seen.add(attrs.id)
      mentions.push(attrs)
    }
    return formatMentionToken(attrs)
  }
  return (node.content ?? []).map(child => serializeNode(child, mentions, seen)).join('')
}

/** 把編輯器文件轉成送出文字：段落之間、Shift+Enter 的換行都變成 \n。 */
export function serializeComposerDoc(doc: JSONContent | null | undefined): SerializedComposer {
  const mentions: ComposerMentionAttrs[] = []
  const seen = new Set<string>()
  const blocks = (doc?.content ?? []).map(block => serializeNode(block, mentions, seen))
  return { text: blocks.join('\n'), mentions }
}

/** 純文字 → 行內節點（文字與換行），給貼上、插入提示詞、還原歷史訊息用。 */
export function textToComposerInlineContent(text: string): JSONContent[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const content: JSONContent[] = []
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' })
    if (line) content.push({ type: 'text', text: line })
  })
  return content
}

/** 純文字 → 整份文件（單一段落，換行用 hardBreak），與 serializeComposerDoc 互為反向。 */
export function textToComposerDoc(text: string): JSONContent {
  const content = textToComposerInlineContent(text)
  return {
    type: 'doc',
    content: [content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }],
  }
}

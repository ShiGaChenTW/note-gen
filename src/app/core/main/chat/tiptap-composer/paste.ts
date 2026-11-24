// Spike（almanac ALMNC-77）：貼上一律當純文字（與舊 Textarea 一致），只有從輸入框自己複製的膠囊保留成膠囊。
import { Fragment, Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { textToComposerInlineContent } from './serialize'

type ClipboardSource = Pick<DataTransfer, 'getData'> | null | undefined

/** 回傳 true 表示已經貼上；false 交給 ProseMirror 預設流程（例如含膠囊的 HTML）。 */
export function pasteComposerPlainText(view: EditorView, clipboardData: ClipboardSource): boolean {
  const html = clipboardData?.getData('text/html') ?? ''
  if (html.includes('data-composer-mention')) return false
  const text = clipboardData?.getData('text/plain') ?? ''
  if (!text) return false
  const nodes = textToComposerInlineContent(text).map(node => view.state.schema.nodeFromJSON(node))
  view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0)).scrollIntoView())
  return true
}

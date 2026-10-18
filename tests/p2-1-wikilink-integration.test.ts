// @vitest-environment jsdom
// Phase 2-1 整合：手動打字與 L2 選單插入都要產生 L1 的 wikilink 節點，存檔仍是原始 `[[ ]]`。
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { MarkdownParagraph, normalizeMarkdownPlaceholders } from '@/app/core/main/editor/markdown/markdown-paragraph'
import { Wikilink, WIKILINK_NODE_NAME } from '@/app/core/main/editor/markdown/wikilink-extension'
import { parseWikilink } from '@/lib/markdown/wikilink'

function createEditor() {
  return new Editor({
    extensions: [
      StarterKit.configure({ blockquote: false, codeBlock: false, link: false, paragraph: false, underline: false, dropcursor: false }),
      MarkdownParagraph,
      Wikilink,
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    ],
  })
}

function typeText(editor: Editor, text: string) {
  const { from, to } = editor.state.selection
  const handled = editor.view.someProp('handleTextInput', f => f(editor.view, from, to, text))
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to))
}

function nodes(editor: Editor) {
  const out: string[] = []
  editor.state.doc.descendants(node => { if (node.type.name === WIKILINK_NODE_NAME) out.push(node.attrs.raw) })
  return out
}

describe('Phase 2-1 wikilink input', () => {
  it('手動打完 ]] 變成節點，存檔仍是 [[Note|別名]]', () => {
    const editor = createEditor()
    editor.commands.setContent('看 [[Note|別名]', { contentType: 'markdown' })
    editor.commands.focus('end')
    typeText(editor, ']')
    expect(nodes(editor)).toEqual(['[[Note|別名]]'])
    expect(normalizeMarkdownPlaceholders(editor.getMarkdown()).trimEnd()).toBe('看 [[Note|別名]]')
  })

  it('不合法的 [[]] 不轉節點', () => {
    const editor = createEditor()
    editor.commands.setContent('空 [[]', { contentType: 'markdown' })
    editor.commands.focus('end')
    typeText(editor, ']')
    expect(nodes(editor)).toEqual([])
    expect(editor.state.doc.textContent).toBe('空 [[]]')
  })

  it('L2 的插入方式：用節點取代 [[query 與既有的 ]]', () => {
    const editor = createEditor()
    // 用 HTML 載入，讓 `[[No]]` 保持純文字（模擬使用者剛打完、尚未轉成節點）
    editor.commands.setContent('<p>前 [[No]] 後</p>')
    expect(nodes(editor)).toEqual([])
    // 模擬 wikilink-suggest 的 insertText：context.from 指向 `[[`，游標在 `No` 之後，後面已有 `]]`
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size)
    const from = text.indexOf('[[') + 1
    const cursor = from + 4
    const attrs = parseWikilink('[[Note|別名]]')!
    editor.chain().insertContentAt({ from, to: cursor + 2 }, { type: WIKILINK_NODE_NAME, attrs }).run()
    expect(nodes(editor)).toEqual(['[[Note|別名]]'])
    expect(normalizeMarkdownPlaceholders(editor.getMarkdown()).trimEnd()).toBe('前 [[Note|別名]] 後')
  })
})

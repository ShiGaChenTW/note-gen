// @vitest-environment jsdom
// Phase 2-3b 軌道 A：筆記內的 ```base 區塊往返一字不差（harness 照 tests/table-roundtrip.test.ts）。
// 區塊讀入時記住原文 raw；內容沒改時 renderMarkdown 直接輸出 raw，改過才重組 fence。
import { describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import {
  MarkdownParagraph,
  normalizeMarkdownPlaceholders,
} from '@/app/core/main/editor/markdown/markdown-paragraph'
import {
  encodeFrontmatterForEditor,
  Frontmatter,
} from '@/app/core/main/editor/markdown/frontmatter-extension'
import { Wikilink } from '@/app/core/main/editor/markdown/wikilink-extension'
import {
  BASES_BLOCK_NODE_NAME,
  BasesBlock,
  basesSourceFromRaw,
  renderBasesBlockMarkdown,
} from '@/app/core/main/editor/markdown/bases-block-extension'

function createEditor() {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      Frontmatter,
      StarterKit.configure({
        blockquote: false,
        link: false,
        paragraph: false,
        underline: false,
        dropcursor: false,
      }),
      MarkdownParagraph,
      TaskList,
      TaskItem.configure({ nested: true }),
      Wikilink,
      BasesBlock,
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    ],
  })
}

function load(editor: Editor, raw: string) {
  editor.chain().setMeta('addToHistory', false)
    .setContent(encodeFrontmatterForEditor(raw), { contentType: 'markdown' }).run()
}

function save(editor: Editor) {
  return normalizeMarkdownPlaceholders(editor.getMarkdown())
}

function roundTrip(raw: string) {
  const editor = createEditor()
  load(editor, raw)
  const out = save(editor)
  editor.destroy()
  return out
}

function blockNodes(editor: Editor): JSONContent[] {
  return (editor.getJSON().content ?? []).filter(node => node.type === BASES_BLOCK_NODE_NAME)
}

// 與 table-roundtrip 相同的 EOF 規則（上游行為）：結尾的換行數可能差一個，其餘必須一字不差。
function expectExact(out: string, raw: string) {
  expect(out.replace(/\n+$/, '')).toBe(raw.replace(/(?:\r?\n)+$/, ''))
  expect(out).not.toMatch(/\n\n$/)
}

const SPEC_BLOCK = [
  '```base',
  'filters:',
  '  and:',
  '    - file.hasTag("project")',
  '    - \'status != "done"\'',
  'formulas:',
  '  days_left: \'if(due, (date(due) - today()).days, "")\'',
  'properties:',
  '  note.status: { displayName: 狀態 }',
  'views:',
  '  - type: table',
  '    name: 進行中',
  '    order: [file.name, status, due, formula.days_left]',
  '    sort: [{ property: due, direction: ASC }]',
  '    limit: 50',
  '```',
  '',
].join('\n')

const samples: Record<string, string> = {
  '規格範例': SPEC_BLOCK,
  '沒有 views 的區塊': '```base\nfilters: file.hasTag("project")\n```\n',
  '空區塊': '```base\n```\n',
  '只有一個空行的區塊': '```base\n\n```\n',
  '內容結尾有空行': '```base\nfilters: x\n\n```\n',
  '前後有文字': '# 標題\n\n前面的段落。\n\n```base\nfilters: file.inFolder("Projects")\n```\n\n後面的段落 [[雙鏈]]。\n',
  '兩個區塊': '```base\nfilters: a\n```\n\n```base\nfilters: b\n```\n',
  '清單之後': '- item\n- two\n\n```base\nviews:\n  - type: list\n```\n',
  'fence 後有尾隨空白': '```base  \nfilters: a\n```\n',
  '含 frontmatter': '---\ntitle: 測試\n---\n\n```base\nfilters: a\n```\n',
  '內容含縮排與 tab 字元': '```base\nviews:\n  - type: table\n    order:\n      - file.name\n\t    - status\n```\n',
  '區塊在檔案最開頭且沒有結尾換行': '```base\nfilters: a\n```',
}

describe('```base 區塊：沒改過時存檔一字不差', () => {
  for (const [name, raw] of Object.entries(samples)) {
    it(`${name}: save(load(x)) === x`, () => {
      expectExact(roundTrip(raw), raw)
    })
    it(`${name}: 重複 load／save 穩定`, () => {
      const editor = createEditor()
      load(editor, raw)
      const first = save(editor)
      load(editor, first)
      expect(save(editor)).toBe(first)
      editor.destroy()
    })
  }

  it('解析成 basesBlock 節點，attrs 有 source 與 raw，raw 不進 HTML', () => {
    const editor = createEditor()
    load(editor, SPEC_BLOCK)
    const nodes = blockNodes(editor)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].attrs?.source).toBe(SPEC_BLOCK.slice('```base\n'.length, SPEC_BLOCK.lastIndexOf('\n```')))
    expect(nodes[0].attrs?.raw).toBe(SPEC_BLOCK.trimEnd())
    expect(editor.getHTML()).toContain('data-type="bases-block"')
    // source 跟 mermaid 的 code 一樣會進 HTML（剪貼簿用）；raw 只用於序列化
    expect(editor.getHTML()).not.toContain('raw=')
    expect(editor.getHTML()).not.toContain('```base')
    editor.destroy()
  })

  it('CRLF：lexer 先把整份換成 LF，區塊內容其餘不變', () => {
    const crlf = 'before\r\n\r\n```base\r\nfilters: a\r\n```\r\n\r\nafter\r\n'
    const out = roundTrip(crlf)
    expectExact(out, crlf.replace(/\r\n/g, '\n'))
    expect(out).not.toContain('\r')
  })

  it('```bases 與 ```basex 不是 Bases 區塊（仍是程式碼區塊）', () => {
    for (const raw of ['```bases\nx\n```\n', '```basex\nx\n```\n']) {
      const editor = createEditor()
      load(editor, raw)
      expect(blockNodes(editor)).toHaveLength(0)
      expect((editor.getJSON().content ?? []).some(node => node.type === 'codeBlock')).toBe(true)
      editor.destroy()
    }
  })

  it('沒有結尾 fence 時不當成 Bases 區塊', () => {
    const editor = createEditor()
    load(editor, '```base\nfilters: a\n\ntext\n')
    expect(blockNodes(editor)).toHaveLength(0)
    editor.destroy()
  })

  it('區塊前後其他內容不受影響（表格、wikilink）', () => {
    const raw = '| a | b |\n|---|---|\n| 1 | [[X]] |\n\n```base\nfilters: a\n```\n\n[[Y|別名]]\n'
    const out = roundTrip(raw)
    expect(out).toContain('```base\nfilters: a\n```')
    expect(out).toContain('[[Y|別名]]')
  })
})

describe('```base 區塊：改過內容後重組', () => {
  it('updateAttributes 改 source 後輸出新內容；其他區塊維持原文', () => {
    const raw = '前\n\n```base\nfilters: a\n```\n\n```base  \nfilters: b\n```\n\n後\n'
    const editor = createEditor()
    load(editor, raw)
    let pos = -1
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === BASES_BLOCK_NODE_NAME && node.attrs.source === 'filters: a') { pos = p; return false }
      return true
    })
    expect(pos).toBeGreaterThanOrEqual(0)
    editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, source: 'filters: changed' })
      return true
    })
    const out = save(editor)
    editor.destroy()
    expect(out.replace(/\n+$/, '')).toBe('前\n\n```base\nfilters: changed\n```\n\n```base  \nfilters: b\n```\n\n後')
  })

  it('編輯後再改回原內容，仍輸出原文', () => {
    const raw = '```base   \nfilters: a\n```\n'
    const editor = createEditor()
    load(editor, raw)
    editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(0, undefined, { ...editor.state.doc.nodeAt(0)!.attrs, source: 'x' })
      return true
    })
    editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(0, undefined, { ...editor.state.doc.nodeAt(0)!.attrs, source: 'filters: a' })
      return true
    })
    expectExact(save(editor), raw)
    editor.destroy()
  })
})

describe('純函式', () => {
  it('basesSourceFromRaw', () => {
    expect(basesSourceFromRaw('```base\nfilters: a\n```')).toBe('filters: a')
    expect(basesSourceFromRaw('```base\n```')).toBe('')
    expect(basesSourceFromRaw('```base\n\n```')).toBe('')
    expect(basesSourceFromRaw('```base\nfilters: a\n\n```')).toBe('filters: a\n')
    expect(basesSourceFromRaw('```base \nfilters: a\n``` ')).toBe('filters: a')
    expect(basesSourceFromRaw('```bases\nx\n```')).toBeNull()
    expect(basesSourceFromRaw('x\n```base\nfilters: a\n```')).toBeNull()
    expect(basesSourceFromRaw('```base\nfilters: a')).toBeNull()
  })

  it('renderBasesBlockMarkdown：沒改用 raw，改了重組，沒有 raw 時重組', () => {
    expect(renderBasesBlockMarkdown({ source: 'filters: a', raw: '```base  \nfilters: a\n```' })).toBe('```base  \nfilters: a\n```')
    expect(renderBasesBlockMarkdown({ source: '', raw: '```base\n\n```' })).toBe('```base\n\n```')
    expect(renderBasesBlockMarkdown({ source: 'filters: b', raw: '```base\nfilters: a\n```' })).toBe('```base\nfilters: b\n```')
    expect(renderBasesBlockMarkdown({ source: 'filters: a' })).toBe('```base\nfilters: a\n```')
    expect(renderBasesBlockMarkdown({ source: '' })).toBe('```base\n```')
    expect(renderBasesBlockMarkdown(undefined)).toBe('```base\n```')
  })
})

// @vitest-environment jsdom
// A-3 (Phase 2-3a): a markdown table that the user did not touch must be saved byte-for-byte.
// Upstream @tiptap/extension-table re-flows every table on save (`|---|---|` → `| --- | --- |`,
// cells padded to equal width, alignment markers dropped) and its renderer starts with `\n`,
// which on top of the serializer's blank line between blocks gave one extra blank line before
// every table.
import { describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { renderTableToMarkdown, Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
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
  rawTableMarkdownIfUnchanged,
  TABLE_RAW_ATTR,
  TABLE_SIGNATURE_ATTR,
  tableSignature,
  withRawTableRoundtrip,
} from '@/app/core/main/editor/markdown/table-raw-extension'

// Same as tiptap-editor.tsx's promoteFirstTableRowInMarkdown (not exported there).
function promoteFirstTableRowInMarkdown(node: JSONContent): JSONContent {
  const [firstRow, ...remainingRows] = node.content ?? []
  if (!firstRow?.content?.length) return node
  if (firstRow.content.some(cell => cell.type === 'tableHeader')) return node
  return {
    ...node,
    content: [
      { ...firstRow, content: firstRow.content.map(cell => (cell.type === 'tableCell' ? { ...cell, type: 'tableHeader' } : cell)) },
      ...remainingRows,
    ],
  }
}

// Equivalent of `MarkdownTable` in tiptap-editor.tsx after the A-3 mount.
const MarkdownTable = withRawTableRoundtrip(Table.extend({
  renderMarkdown: (node, helpers) => renderTableToMarkdown(promoteFirstTableRowInMarkdown(node), helpers),
}))

function createEditor(withRaw = true) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      Frontmatter,
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        link: false,
        paragraph: false,
        underline: false,
        dropcursor: false,
      }),
      MarkdownParagraph,
      TaskList,
      TaskItem.configure({ nested: true }),
      Wikilink,
      withRaw ? MarkdownTable : Table,
      TableRow,
      TableHeader,
      TableCell,
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

function roundTrip(raw: string, withRaw = true) {
  const editor = createEditor(withRaw)
  load(editor, raw)
  const out = save(editor)
  editor.destroy()
  return out
}

function tableNode(editor: Editor) {
  let found: JSONContent | null = null
  for (const node of editor.getJSON().content ?? []) {
    if (node.type === 'table') { found = node; break }
  }
  return found
}

// EOF handling is upstream and unchanged by A-3: a file ending in a paragraph loses its final
// newline, a file ending in a table / list / code block keeps exactly one (StarterKit's
// TrailingNode adds an empty paragraph that normalizeMarkdownPlaceholders turns into `\n`).
// Everything before that must be byte-identical.
function expectExact(out: string, raw: string) {
  expect(out.replace(/\n+$/, '')).toBe(raw.replace(/(?:\r?\n)+$/, ''))
  expect(out).not.toMatch(/\n\n$/)
}

const compact = '| a | b |\n|---|---|\n| 1 | 2 |\n'
const aligned = '| left | right | center |\n|:--|--:|:-:|\n| x | y | z |\n'
const wikilinkTable = '| 欄位 | 連結 |\n|---|---|\n| 表格別名 | [[雙鏈目標\\|表格]] |\n| 表格一般 | [[同名]] |\n'
const surrounded = 'before\n\n| a |\n|---|\n| 1 |\n\nafter\n'
const crlf = 'before\r\n\r\n| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n\r\nafter\r\n'
const uneven = '|a|b|\n|-|-|\n|longer cell|x|\n|  spaced  |  y  |\n'
const marksInside = '| **bold** | `code` | *em* |\n|---|---|---|\n| ~~del~~ | plain | a \\| b |\n'
// personal/make-test-vault.mjs: `60 Notes/雙鏈表格.md`
const vaultSample = '# 雙鏈表格\n\n| 欄位 | 連結 |\n|---|---|\n| 表格別名 | [[雙鏈目標\\|表格]] |\n| 表格一般 | [[同名]] |\n'

describe('A-3: untouched tables are saved byte-for-byte', () => {
  it('reproduces the upstream re-flow without the extension', () => {
    const out = roundTrip(surrounded, false)
    expect(out).toContain('| --- |')
    expect(out).toContain('before\n\n\n|')
  })

  const samples: Record<string, string> = {
    'compact delimiter row': compact,
    'alignment row': aligned,
    'wikilink with escaped pipe (2-1 WikilinkTable tokenizer)': wikilinkTable,
    'text before and after (one blank line before the table)': surrounded,
    'uneven widths and padded cells': uneven,
    'marks inside cells': marksInside,
    '60 Notes/雙鏈表格.md': vaultSample,
    'table at the very start': '| a |\n|---|\n| 1 |',
    'two tables': '| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n',
    'table after a heading and a list': '# T\n\n- item\n\n| a |\n|---|\n| 1 |\n',
    'table with trailing text row-less': '| a | b |\n|---|---|\n',
  }
  for (const [name, raw] of Object.entries(samples)) {
    it(`${name}: save(load(x)) === x`, () => {
      expectExact(roundTrip(raw), raw)
    })
    it(`${name}: stable across repeated load/save`, () => {
      const editor = createEditor()
      load(editor, raw)
      const first = save(editor)
      load(editor, first)
      expect(save(editor)).toBe(first)
      editor.destroy()
    })
  }

  it('CRLF file: table lines identical modulo the line ending the parser normalises', () => {
    // marked's lexer turns \r\n into \n for the whole document before any tokenizer runs, so the
    // table is stored LF like the rest of the note; nothing else in the table changes.
    const out = roundTrip(crlf)
    expectExact(out, crlf.replace(/\r\n/g, '\n'))
    expect(out).not.toContain('\r')
  })

  it('stores raw markdown and a signature on the node, hidden from HTML', () => {
    const editor = createEditor()
    load(editor, compact)
    const node = tableNode(editor)
    expect(node?.attrs?.[TABLE_RAW_ATTR]).toBe(compact)
    expect(node?.attrs?.[TABLE_SIGNATURE_ATTR]).toBe(tableSignature(node!))
    expect(editor.getHTML()).not.toContain('rawMarkdown')
    expect(editor.getHTML()).not.toContain('rawSignature')
    editor.destroy()
  })

  it('edited cell: falls back to the normal serializer', () => {
    const editor = createEditor()
    load(editor, compact)
    // move into the last cell and type
    const json = editor.getJSON()
    let pos = -1
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === 'tableCell' && node.textContent === '2') { pos = p + 2; return false }
      return true
    })
    expect(pos).toBeGreaterThan(0)
    editor.commands.setTextSelection(pos)
    editor.commands.insertContent('x')
    const out = save(editor)
    editor.destroy()
    // upstream serializer: leading `\n`, padded cells, `| --- |`
    expect(out.replace(/\n+$/, '')).toBe('\n| a   | b   |\n| --- | --- |\n| 1   | x2  |')
    expect(rawTableMarkdownIfUnchanged(json.content![0]!)).toBe(compact.trimEnd())
  })

  it('edited mark (bold toggled): signature changes', () => {
    const editor = createEditor()
    load(editor, compact)
    let from = -1
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === 'tableHeader' && node.textContent === 'a') { from = p + 2; return false }
      return true
    })
    editor.commands.setTextSelection({ from, to: from + 1 })
    editor.commands.setBold()
    const out = save(editor)
    editor.destroy()
    expect(out).toContain('| **a** | b   |')
  })

  it('undoing an edit restores the raw output', () => {
    const editor = createEditor()
    load(editor, compact)
    let pos = -1
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === 'tableCell' && node.textContent === '2') { pos = p + 2; return false }
      return true
    })
    editor.commands.setTextSelection(pos)
    editor.commands.insertContent('x')
    editor.commands.undo()
    const out = save(editor)
    editor.destroy()
    expectExact(out, compact)
  })

  it('a table inserted in the editor (no raw) uses the normal serializer', () => {
    const editor = createEditor()
    load(editor, 'p')
    editor.commands.focus('end')
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    const out = save(editor)
    editor.destroy()
    expect(out).toMatch(/\| -{3,} \| -{3,} \|/)
  })

  it('tableSignature: merges adjacent text runs and ignores mark attrs', () => {
    const a: JSONContent = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'ab', marks: [{ type: 'bold', attrs: { x: 1 } }] },
    ] }] }] }] }
    const b: JSONContent = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
    ] }] }] }] }
    const c: JSONContent = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'ab' },
    ] }] }] }] }
    expect(tableSignature(a)).toBe(tableSignature(b))
    expect(tableSignature(a)).not.toBe(tableSignature(c))
    expect(tableSignature({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell' }] }] })).toBe('')
  })

  it('tableSignature: a wikilink cell changes with its raw text, rows and cells are separated', () => {
    const cell = (text: string) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    const link = (raw: string) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'wikilink', attrs: { raw } }] }] })
    const one = tableSignature({ type: 'table', content: [{ type: 'tableRow', content: [cell('a'), cell('b')] }] })
    const two = tableSignature({ type: 'table', content: [{ type: 'tableRow', content: [cell('a')] }, { type: 'tableRow', content: [cell('b')] }] })
    expect(one).not.toBe(two)
    expect(tableSignature({ type: 'table', content: [{ type: 'tableRow', content: [link('[[A]]')] }] }))
      .not.toBe(tableSignature({ type: 'table', content: [{ type: 'tableRow', content: [link('[[B]]')] }] }))
  })
})

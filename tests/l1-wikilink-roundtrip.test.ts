// @vitest-environment jsdom
// L1: Obsidian `[[wikilink]]` must survive the visual editor byte-for-byte.
// Without the Wikilink node, a `[[A\|a]]` inside a table cell came back as `[[A|a]]`
// (marked unescapes the pipe) and split the row in Obsidian.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
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
import CodeBlock from '@tiptap/extension-code-block'
import {
  parseFencedCodeBlockToken,
  renderFencedCodeBlockNode,
} from '@/app/core/main/editor/markdown/code-block-markdown'
import {
  clearPendingWikilinkScroll,
  findWikilinkAnchor,
  matchWikilinkAtStart,
  openWikilink,
  queueWikilinkScroll,
  scrollToWikilinkAnchor,
  tokenizeTableCellsWithWikilinks,
  Wikilink,
  wikilinkNewNotePath,
  wikilinkStartIndex,
  wikilinkTableStartIndex,
} from '@/app/core/main/editor/markdown/wikilink-extension'
import { parseWikilink } from '@/lib/markdown/wikilink'
import useVaultIndexStore from '@/stores/vault-index'
import useArticleStore from '@/stores/article'
import type { IndexedNote } from '@/lib/vault-index/index-note'
import * as noteIo from '@/lib/daily/note-io'

vi.mock('@/lib/daily/note-io', () => ({
  noteExists: vi.fn(async () => false),
  writeNote: vi.fn(async () => undefined),
  revealInFileTree: vi.fn(async () => undefined),
}))

// Same fence handling as the editor's StableCodeBlockLowlight, without the React view.
const FencedCodeBlock = CodeBlock.extend({
  parseMarkdown: parseFencedCodeBlockToken,
  renderMarkdown: renderFencedCodeBlockNode,
})

// Mirrors the block-level setup of tiptap-editor.tsx (Wikilink next to RecurringTask).
function createEditor(withWikilink = true) {
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
      FencedCodeBlock,
      TaskList,
      TaskItem.configure({ nested: true }),
      ...(withWikilink ? [Wikilink] : []),
      Table,
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

function wikilinkNodes(editor: Editor) {
  const out: Record<string, unknown>[] = []
  editor.state.doc.descendants(node => {
    if (node.type.name === 'wikilink') out.push(node.attrs)
  })
  return out
}

function indexedNote(path: string): IndexedNote {
  return { path, mtime: 0, frontmatter: null, tasks: [], links: [], aliases: [], tags: [] }
}

function setIndex(paths: string[]) {
  useVaultIndexStore.getState().replaceAll(new Map(paths.map(p => [p, indexedNote(p)])))
}

// Framing newlines are upstream behaviour (lists and code blocks end with `\n`, the final
// newline of a file is never emitted, tables are wrapped in blank lines), so round trips
// are compared with trailing whitespace removed. Everything inside must be byte-identical.
function expectRoundTrip(out: string, raw: string) {
  expect(out.trimEnd()).toBe(raw.trimEnd())
}

const samples: Record<string, string> = {
  'paragraph start / middle / end': '[[A]] 開頭，中間 [[B|別名]] 文字，結尾 [[C#標題]]',
  'CJK without spaces, adjacent links': '這是[[筆記]]沒有空格，相鄰[[A]][[B]]。',
  'block id, self heading, folder, .md': '[[Note#^abc123]] 與 [[#標題]] 與 [[folder/Note]] 與 [[Note.md]]',
  'bullet list': '- 讀 [[書名|這本]]\n- 另一本 [[B]]',
  'task item': '- [ ] 讀 [[書名|這本]] 📅 2026-10-20\n- [x] 看 [[影片]] ✅ 2026-10-18',
  'escaped pipe outside a table': '段落裡的 [[A\\|a]] 也照原樣',
  'embeds': '![[圖.png]] 與 ![[Note#段落]] 與 ![[子資料夾/附件.pdf]]',
  'inline code': '行內 `[[x]]` 保持原樣，`![[y]]` 也是',
  'fenced code': '```\n[[x]]\n```',
  'fenced code with language': '```md\n![[x]]\n```',
  'heading and emphasis': '# 標題 [[A]]\n\n**粗體** [[B]] 與 *斜體* [[C|c]] 與 ~~刪除~~ [[D]]',
  'frontmatter related': '---\nrelated: "[[Front]]"\n---\n\n內文 [[Body]]',
  'not a wikilink': '[A] 與 [[]] 與 [[ ]] 與 [[a]b]] 與 [[未結束',
}

const tableSample = '| [[A\\|a]] | [[B]] |\n| -------- | ----- |\n| [[C\\|c]] | y     |'
const tableSamples: Record<string, string> = {
  'table row': tableSample,
  'table after a paragraph, code in a cell': '前言\n\n| 欄        | 值       |\n| -------- | ------- |\n| [[A\\|a]] | `[[x]]` |',
  'table without wikilinks': '| a   | b   |\n| --- | --- |\n| 1   | 2   |',
  'table-like text without a delimiter row': '| [[A\\|a]] | b |\n只是文字',
}

describe('L1: wikilink round trip through the visual editor', () => {
  it('reproduces the original bug without the Wikilink node (table pipe lost)', () => {
    const editor = createEditor(false)
    load(editor, tableSample)
    const out = save(editor)
    editor.destroy()
    expect(out).toContain('[[A|a]]')
    expect(out).not.toContain('[[A\\|a]]')
  })

  for (const [name, raw] of Object.entries(samples)) {
    it(`${name}: save(load(x)) === x`, () => {
      const editor = createEditor()
      load(editor, raw)
      const out = save(editor)
      editor.destroy()
      expectRoundTrip(out, raw)
    })
  }

  for (const [name, raw] of Object.entries(tableSamples)) {
    it(`${name}: save(load(x)) === x`, () => {
      const editor = createEditor()
      load(editor, raw)
      const out = save(editor)
      editor.destroy()
      // the upstream table serializer puts a newline before the table as well
      expectRoundTrip(out.replace(/\n\n\n\|/, '\n\n|').replace(/^\n/, ''), raw)
    })
  }

  it('table row keeps `\\|` inside wikilinks and parses the alias', () => {
    const editor = createEditor()
    load(editor, tableSample)
    const nodes = wikilinkNodes(editor)
    const canonical = normalizeMarkdownPlaceholders(editor.getMarkdown())
    editor.destroy()
    expect(nodes.map(n => n.raw)).toEqual(['[[A\\|a]]', '[[B]]', '[[C\\|c]]'])
    expect(nodes[0]).toMatchObject({ target: 'A', alias: 'a' })
    expect(canonical).not.toContain('[[A|a]]')
  })

  for (const [name, raw] of Object.entries({ ...samples, ...tableSamples })) {
    it(`${name}: stable across repeated load/save`, () => {
      const editor = createEditor()
      load(editor, raw)
      const first = save(editor)
      load(editor, first)
      expect(save(editor)).toBe(first)
      editor.destroy()
    })
  }

  it('creates one node per link: [[A]][[B]] is two nodes with parseWikilink attrs', () => {
    const editor = createEditor()
    load(editor, samples['CJK without spaces, adjacent links'])
    const nodes = wikilinkNodes(editor)
    editor.destroy()
    expect(nodes).toHaveLength(3)
    expect(nodes[1]).toEqual(parseWikilink('[[A]]'))
    expect(nodes[2]).toEqual(parseWikilink('[[B]]'))
  })

  it('keeps alias / heading / block id / embed attrs from parseWikilink', () => {
    const editor = createEditor()
    load(editor, '[[B|別名]] [[C#標題]] [[Note#^abc123]] [[#標題]] ![[圖.png]]')
    const nodes = wikilinkNodes(editor)
    editor.destroy()
    expect(nodes).toEqual([
      parseWikilink('[[B|別名]]'),
      parseWikilink('[[C#標題]]'),
      parseWikilink('[[Note#^abc123]]'),
      parseWikilink('[[#標題]]'),
      parseWikilink('![[圖.png]]'),
    ])
    expect(nodes[4]).toMatchObject({ embed: true, target: '圖.png' })
  })

  it('does not touch [[ ]] inside inline or fenced code', () => {
    const editor = createEditor()
    load(editor, `${samples['inline code']}\n\n${samples['fenced code']}\n\n${samples['tilde fence']}`)
    expect(wikilinkNodes(editor)).toHaveLength(0)
    editor.destroy()
  })

  it('coexists with the Frontmatter node', () => {
    const editor = createEditor()
    load(editor, samples['frontmatter related'])
    const json = editor.getJSON()
    editor.destroy()
    expect(json.content?.[0]?.type).toBe('frontmatter')
    expect(json.content?.[0]?.attrs?.raw).toBe('---\nrelated: "[[Front]]"\n---\n')
    expect(JSON.stringify(json).match(/"type":"wikilink"/g)).toHaveLength(1)
  })

  it('keeps links intact after editing the paragraph', () => {
    const editor = createEditor()
    load(editor, '前面 [[A]] 後面')
    editor.commands.focus('end')
    editor.commands.insertContent(' 新增')
    const out = save(editor)
    editor.destroy()
    expect(out).toBe('前面 [[A]] 後面 新增')
  })

  it('is an inline atom (arrow keys skip it, Backspace deletes it whole)', () => {
    const editor = createEditor()
    const type = editor.schema.nodes.wikilink
    expect(type.isInline && type.isAtom && type.isLeaf).toBe(true)
    expect(type.spec.selectable).toBe(true)
    editor.destroy()
  })

  // Upstream limitations shared with InlineMath (`$x$`), documented so they flip when
  // @tiptap/markdown handles marks on inline atoms:
  // - the parser only puts marks on text nodes, so `**粗體 [[B]]**` comes back as `**粗體** [[B]]`
  // - the serializer closes and reopens a mark around a marked atom
  it.fails('known limitation: marks wrapping a link in the file', () => {
    const editor = createEditor()
    load(editor, '**粗體 [[B]]**')
    const out = save(editor)
    editor.destroy()
    expect(out).toBe('**粗體 [[B]]**')
  })

  it.fails('known limitation: bold applied in the editor across a link', () => {
    const editor = createEditor()
    load(editor, '粗體 [[B]] 文字')
    editor.commands.setTextSelection({ from: 1, to: 5 })
    editor.commands.setBold()
    const out = save(editor)
    editor.destroy()
    expect(out).toBe('**粗體 [[B]]** 文字')
  })

  it('renders <a class="notegen-wikilink"> with display text, embeds as <span>', () => {
    const editor = createEditor()
    load(editor, '[[Note|別名]] [[folder/Note]] [[Note#標題]] ![[圖.png]]')
    const dom = editor.view.dom
    const anchors = Array.from(dom.querySelectorAll('a[data-type="wikilink"]'))
    expect(anchors.map(a => a.textContent)).toEqual(['別名', 'Note', 'Note > 標題'])
    expect(anchors.every(a => a.classList.contains('notegen-wikilink'))).toBe(true)
    expect(anchors.every(a => !a.hasAttribute('href'))).toBe(true)
    const embed = dom.querySelector('span[data-type="wikilink"]')
    expect(embed?.textContent).toBe('⧉ 圖.png')
    expect(embed?.classList.contains('notegen-wikilink-embed')).toBe(true)
    editor.destroy()
  })
})

describe('L1: tokenizer helpers', () => {
  it('start finds [[ and the ! of ![[', () => {
    expect(wikilinkStartIndex('abc [[A]]')).toBe(4)
    expect(wikilinkStartIndex('abc ![[A]]')).toBe(4)
    expect(wikilinkStartIndex('no link')).toBe(-1)
  })

  it('tokenize only accepts what parseWikilink accepts', () => {
    expect(matchWikilinkAtStart('[[A]] rest')).toBe('[[A]]')
    expect(matchWikilinkAtStart('![[A#B]] rest')).toBe('![[A#B]]')
    expect(matchWikilinkAtStart('[[]]')).toBeNull()
    expect(matchWikilinkAtStart('[[a\nb]]')).toBeNull()
    expect(matchWikilinkAtStart('x [[A]]')).toBeNull()
  })

  it('table start only fires for tables that contain [[', () => {
    expect(wikilinkTableStartIndex('x\n\n| [[A]] | b |\n| --- | --- |')).toBe(3)
    expect(wikilinkTableStartIndex('| a | b |\n| --- | --- |\n| [[A]] | 1 |')).toBe(0)
    expect(wikilinkTableStartIndex('| a | b |\n| --- | --- |')).toBe(-1)
    expect(wikilinkTableStartIndex('| a | b |\n| --- | --- |\n\n[[A]]')).toBe(-1)
    expect(wikilinkTableStartIndex('| a | b |\n| --- | --- |\n\n| [[A]] | b |\n| --- | --- |')).toBe(25)
    expect(wikilinkTableStartIndex('| [[A]] | b |\n只是文字')).toBe(-1)
  })

  it('re-escapes pipes in wikilink tokens inside table cells only', () => {
    const inline = (text: string) => text === '[[A|a]] a|b'
      ? [{ type: 'notegen_wikilink', raw: '[[A|a]]' }, { type: 'text', raw: ' a|b' }]
      : [{ type: 'strong', raw: '**[[B|b]]**', tokens: [{ type: 'notegen_wikilink', raw: '[[B|b]]' }] }]
    const header = [{ text: '[[A|a]] a|b', tokens: [] }]
    const rows = [[{ text: '**[[B|b]]**', tokens: [] }]]
    tokenizeTableCellsWithWikilinks({ type: 'table', header, rows }, inline)
    expect(header[0].tokens).toEqual([{ type: 'notegen_wikilink', raw: '[[A\\|a]]' }, { type: 'text', raw: ' a|b' }])
    expect(rows[0][0].tokens).toEqual([{ type: 'strong', raw: '**[[B|b]]**', tokens: [{ type: 'notegen_wikilink', raw: '[[B\\|b]]' }] }])
  })
})

describe('L1: resolution decorations', () => {
  beforeEach(() => { setIndex([]) })

  it('marks unresolved links via decorations, not attrs, and follows the index revision', () => {
    const editor = createEditor()
    load(editor, '[[A]] [[B]] [[#標題]] ![[圖.png]]')
    const unresolved = () => Array.from(editor.view.dom.querySelectorAll('.notegen-wikilink-unresolved'))
      .map(el => el.textContent)
    expect(unresolved()).toEqual(['A', 'B'])

    setIndex(['A.md'])
    expect(unresolved()).toEqual(['B'])

    setIndex(['A.md', 'sub/B.md'])
    expect(unresolved()).toEqual([])

    // attrs stay exactly the parseWikilink fields
    for (const attrs of wikilinkNodes(editor)) {
      expect(Object.keys(attrs).sort()).toEqual(['alias', 'blockId', 'embed', 'heading', 'raw', 'target'])
    }
    editor.destroy()
  })

  it('recomputes after edits insert a new link', () => {
    const editor = createEditor()
    setIndex(['A.md'])
    load(editor, '[[A]]')
    expect(editor.view.dom.querySelectorAll('.notegen-wikilink-unresolved')).toHaveLength(0)
    editor.commands.focus('end')
    editor.commands.insertContent(' [[Missing]]', { contentType: 'markdown' })
    expect(Array.from(editor.view.dom.querySelectorAll('.notegen-wikilink-unresolved')).map(el => el.textContent))
      .toEqual(['Missing'])
    editor.destroy()
  })
})

describe('L1: click behaviour (openWikilink)', () => {
  const setActiveFilePath = vi.fn(async () => undefined)
  const io = vi.mocked(noteIo)

  beforeEach(() => {
    vi.clearAllMocks()
    setIndex(['folder/Note.md', 'Other.md'])
    useArticleStore.setState({ activeFilePath: 'folder/Current.md', setActiveFilePath } as never)
  })
  afterEach(() => { useArticleStore.setState({ activeFilePath: '' }) })

  it('opens an existing note after revealing it in the file tree', async () => {
    await openWikilink(parseWikilink('[[Note|別名]]')!)
    expect(io.writeNote).not.toHaveBeenCalled()
    expect(io.revealInFileTree).toHaveBeenCalledWith('folder/Note.md')
    expect(setActiveFilePath).toHaveBeenCalledWith('folder/Note.md')
  })

  it('creates a missing note next to the current one with `# 名稱`', async () => {
    await openWikilink(parseWikilink('[[新筆記#標題]]')!)
    expect(io.writeNote).toHaveBeenCalledWith('folder/新筆記.md', '# 新筆記\n')
    expect(io.revealInFileTree).toHaveBeenCalledWith('folder/新筆記.md')
    expect(setActiveFilePath).toHaveBeenCalledWith('folder/新筆記.md')
  })

  it('uses the relative path when the target has a folder', async () => {
    await openWikilink(parseWikilink('[[專案/計畫]]')!)
    expect(io.writeNote).toHaveBeenCalledWith('專案/計畫.md', '# 計畫\n')
    expect(setActiveFilePath).toHaveBeenCalledWith('專案/計畫.md')
  })

  it('does not overwrite a note that appeared meanwhile', async () => {
    io.noteExists.mockResolvedValueOnce(true)
    await openWikilink(parseWikilink('[[新筆記]]')!)
    expect(io.writeNote).not.toHaveBeenCalled()
    expect(setActiveFilePath).toHaveBeenCalledWith('folder/新筆記.md')
  })

  it('ignores [[#標題]], embeds and attachment targets', async () => {
    await openWikilink(parseWikilink('[[#標題]]')!)
    await openWikilink(parseWikilink('![[Note]]')!)
    await openWikilink(parseWikilink('[[圖.png]]')!)
    expect(io.writeNote).not.toHaveBeenCalled()
    expect(io.revealInFileTree).not.toHaveBeenCalled()
    expect(setActiveFilePath).not.toHaveBeenCalled()
  })

  it('wikilinkNewNotePath', () => {
    expect(wikilinkNewNotePath('A', 'folder/x.md')).toBe('folder/A.md')
    expect(wikilinkNewNotePath('A', 'x.md')).toBe('A.md')
    expect(wikilinkNewNotePath('A', '')).toBe('A.md')
    expect(wikilinkNewNotePath('A.md', 'folder/x.md')).toBe('folder/A.md')
    expect(wikilinkNewNotePath('sub/B', 'folder/x.md')).toBe('sub/B.md')
    expect(wikilinkNewNotePath('2026.10', 'folder/x.md')).toBe('folder/2026.10.md')
    expect(wikilinkNewNotePath('圖.png', 'folder/x.md')).toBeNull()
    expect(wikilinkNewNotePath('  ', 'folder/x.md')).toBeNull()
  })
})

// A-2 (Phase 2-3a): `[[Note#標題]]` / `[[Note#^id]]` / `[[#標題]]` scroll to the target.
describe('A-2: heading / block jumps', () => {
  const doc = '# 第一章\n\n內文。\n\n## Hello World [[A]]\n\n段落一 ^para-1\n\n- 清單項 ^item-1\n\n| a |\n|---|\n| 1 ^row-1 |\n\n## 第二章\n\n結尾。'
  const scrollIntoView = vi.fn()
  const setActiveFilePath = vi.fn(async (path: string) => {
    useArticleStore.setState({ activeFilePath: path } as never)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    clearPendingWikilinkScroll()
    Element.prototype.scrollIntoView = scrollIntoView
    setIndex(['Current.md', 'Other.md'])
    useArticleStore.setState({ activeFilePath: 'Current.md', setActiveFilePath } as never)
  })
  afterEach(() => {
    vi.useRealTimers()
    useArticleStore.setState({ activeFilePath: '' })
  })

  it('findWikilinkAnchor: headings by normalized text (wikilink display text included)', () => {
    const editor = createEditor()
    load(editor, doc)
    const d = editor.state.doc
    expect(findWikilinkAnchor(d, { heading: '第一章', blockId: '' })?.node.type.name).toBe('heading')
    expect(findWikilinkAnchor(d, { heading: '  hello   world a ', blockId: '' })?.node.textContent).toBe('Hello World ')
    expect(findWikilinkAnchor(d, { heading: '第二章', blockId: '' })?.node.textContent).toBe('第二章')
    expect(findWikilinkAnchor(d, { heading: '沒有', blockId: '' })).toBeNull()
    expect(findWikilinkAnchor(d, { heading: '', blockId: '' })).toBeNull()
    editor.destroy()
  })

  it('findWikilinkAnchor: block ids in paragraphs, list items and table cells', () => {
    const editor = createEditor()
    load(editor, doc)
    const d = editor.state.doc
    expect(findWikilinkAnchor(d, { heading: '', blockId: 'para-1' })?.node.textContent).toBe('段落一 ^para-1')
    expect(findWikilinkAnchor(d, { heading: '', blockId: 'ITEM-1' })?.node.textContent).toBe('清單項 ^item-1')
    expect(findWikilinkAnchor(d, { heading: '', blockId: 'row-1' })?.node.textContent).toBe('1 ^row-1')
    expect(findWikilinkAnchor(d, { heading: '', blockId: 'para' })).toBeNull()
    editor.destroy()
  })

  it('scrollToWikilinkAnchor: scrolls the heading into view and moves the cursor there', () => {
    const editor = createEditor()
    load(editor, doc)
    expect(scrollToWikilinkAnchor(editor.view, { heading: '第二章', blockId: '' })).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    const { $from } = editor.state.selection
    expect($from.parent.type.name).toBe('heading')
    expect($from.parent.textContent).toBe('第二章')
    expect(scrollToWikilinkAnchor(editor.view, { heading: '沒有', blockId: '' })).toBe(false)
    editor.destroy()
  })

  it('scrollToWikilinkAnchor: block ids get a 1.5 s highlight decoration', () => {
    const editor = createEditor()
    load(editor, doc)
    expect(scrollToWikilinkAnchor(editor.view, { heading: '', blockId: 'para-1' })).toBe(true)
    const highlighted = () => Array.from(editor.view.dom.querySelectorAll('.notegen-wikilink-target')).map(el => el.textContent)
    expect(highlighted()).toEqual(['段落一 ^para-1'])
    vi.advanceTimersByTime(1400)
    expect(highlighted()).toEqual(['段落一 ^para-1'])
    vi.advanceTimersByTime(200)
    expect(highlighted()).toEqual([])
    // the highlight is a decoration: nothing reaches the file (this harness has no A-3 table
    // extension, so only the paragraph is compared)
    const out = save(editor)
    expect(out).toContain('段落一 ^para-1')
    expect(out).not.toContain('notegen-wikilink-target')
    editor.destroy()
  })

  it('[[#標題]] scrolls in the clicked editor without touching files', async () => {
    const editor = createEditor()
    load(editor, doc)
    await openWikilink(parseWikilink('[[#第二章]]')!, editor.view)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(editor.state.selection.$from.parent.textContent).toBe('第二章')
    expect(setActiveFilePath).not.toHaveBeenCalled()
    expect(vi.mocked(noteIo).revealInFileTree).not.toHaveBeenCalled()
    editor.destroy()
  })

  it('[[Current#^id]] (target is this note) only scrolls', async () => {
    const editor = createEditor()
    load(editor, doc)
    await openWikilink(parseWikilink('[[Current#^item-1]]')!, editor.view)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(setActiveFilePath).not.toHaveBeenCalled()
    expect(editor.view.dom.querySelectorAll('.notegen-wikilink-target')).toHaveLength(1)
    editor.destroy()
  })

  it('[[Other#標題]]: opens the note, then scrolls once its editor has loaded the content', async () => {
    const source = createEditor()
    load(source, '來源 [[Other#第二章]]')
    const target = createEditor()
    load(target, '空的')

    await openWikilink(parseWikilink('[[Other#第二章]]')!, source.view)
    expect(setActiveFilePath).toHaveBeenCalledWith('Other.md')
    expect(scrollIntoView).not.toHaveBeenCalled()

    // the target tab's editor loads the file (doc change while activeFilePath === Other.md)
    load(target, doc)
    vi.advanceTimersByTime(0)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(target.state.selection.$from.parent.textContent).toBe('第二章')
    // nothing scrolled in the source editor
    expect(source.state.selection.$from.parent.textContent).not.toBe('第二章')

    // one-shot: a later reload of the same note does not scroll again
    load(target, doc)
    vi.advanceTimersByTime(0)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    source.destroy()
    target.destroy()
  })

  it('[[Other#標題]]: target tab already open and visible → scrolls after the open resolves', async () => {
    const source = createEditor()
    load(source, '來源')
    const target = createEditor()
    load(target, doc)
    document.body.appendChild(target.view.dom)
    ;(target.view.dom as HTMLElement).getClientRects = () => [{} as DOMRect] as unknown as DOMRectList

    await openWikilink(parseWikilink('[[Other#第二章]]')!, source.view)
    vi.advanceTimersByTime(1000)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(target.state.selection.$from.parent.textContent).toBe('第二章')
    target.view.dom.remove()
    source.destroy()
    target.destroy()
  })

  it('a missing heading in the target only opens the note; the pending jump expires', async () => {
    const target = createEditor()
    load(target, '空的')
    await openWikilink(parseWikilink('[[Other#沒有]]')!)
    expect(setActiveFilePath).toHaveBeenCalledWith('Other.md')
    load(target, doc)
    vi.advanceTimersByTime(0)
    expect(scrollIntoView).not.toHaveBeenCalled()
    target.destroy()
  })

  it('queueWikilinkScroll: a pending jump is ignored while another note is active', () => {
    const editor = createEditor()
    queueWikilinkScroll('Other.md', { heading: '第二章', blockId: '' })
    load(editor, doc) // activeFilePath is Current.md
    vi.advanceTimersByTime(0)
    expect(scrollIntoView).not.toHaveBeenCalled()
    editor.destroy()
  })
})

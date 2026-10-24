// @vitest-environment jsdom
// Phase 2-4, Issue #18: 頂層區塊原文往返與區塊間空行。
// 沒動過的頂層區塊存檔時輸出 marked 的原文（`*` 項目符號、tab 縮排、setext 標題、`***`、
// 空清單項 `-` 都不變），區塊之間的空行數照載入時的；動過的區塊走上游序列化器，但「標題後緊接
// 清單」這種零空行的間距仍保留（只要 CommonMark 不會因此改變結構）。
import { describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import { renderTableToMarkdown, Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { MarkdownParagraph, normalizeMarkdownPlaceholders } from '@/app/core/main/editor/markdown/markdown-paragraph'
import { encodeFrontmatterForEditor, Frontmatter } from '@/app/core/main/editor/markdown/frontmatter-extension'
import { Wikilink } from '@/app/core/main/editor/markdown/wikilink-extension'
import { GitHubAlertBlockquote } from '@/app/core/main/editor/markdown/github-alert-blockquote'
import { withRawTableRoundtrip } from '@/app/core/main/editor/markdown/table-raw-extension'
import {
  BLOCK_GAP_ATTR,
  BLOCK_RAW_ATTR,
  BlockRoundtrip,
  BlockRoundtripDocument,
  blockSeparator,
  blockSignature,
  canBeTight,
} from '@/app/core/main/editor/markdown/block-roundtrip-extension'

const MarkdownTable = withRawTableRoundtrip(Table.extend({
  renderMarkdown: (node, helpers) => renderTableToMarkdown(node, helpers),
}))

function createEditor(withRoundtrip = true) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      GitHubAlertBlockquote,
      Frontmatter,
      ...(withRoundtrip ? [BlockRoundtripDocument] : []),
      StarterKit.configure({
        document: withRoundtrip ? false : undefined,
        blockquote: false,
        paragraph: false,
        underline: false,
        dropcursor: false,
      }),
      MarkdownParagraph,
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Wikilink,
      MarkdownTable,
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
      ...(withRoundtrip ? [BlockRoundtrip] : []),
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

function roundTrip(raw: string, withRoundtrip = true) {
  const editor = createEditor(withRoundtrip)
  load(editor, raw)
  const out = save(editor)
  editor.destroy()
  return out
}

function blocks(editor: Editor): JSONContent[] {
  return editor.getJSON().content ?? []
}

// personal/make-test-vault.mjs: `00 System/05 templates/Daily.md`
const DAILY = `---
date: "{{date}}"
tags: [daily]
---

# {{date}} {{weekday}}

> 一句話定調 →

## 🎯 唯一要務
-

## 三件 MIT
- [ ] 🔴
- [ ] 🟡
- [ ] 🟢

## ⏰ 錨點時段
- 08:00 早晨啟動
- 21:30 整日復盤

## 📥 捕捉軌

## 🌙 沉澱
- **今天真正完成**：
- **明天要記得**：
`

describe('Issue #18: Daily 模板往返', () => {
  it('reproduces the original drift without the extension', () => {
    const out = roundTrip(DAILY, false)
    expect(out).toContain('## 三件 MIT\n\n- [ ] 🔴')
    expect(out).toContain('## 🎯 唯一要務\n\n- \n')
  })

  it('不改內容直接存檔一字不差', () => {
    expect(roundTrip(DAILY)).toBe(DAILY)
  })

  it('改了任務項文字：那個清單重新序列化，但仍緊接標題，其他區塊原文不動', () => {
    const editor = createEditor()
    load(editor, DAILY)
    const text = editor.state.doc.textContent
    const pos = text.indexOf('🔴')
    let docPos = -1
    editor.state.doc.descendants((node, nodePos) => {
      if (docPos === -1 && node.isText && node.text?.includes('🔴')) docPos = nodePos + node.text.indexOf('🔴') + '🔴'.length
    })
    expect(pos).toBeGreaterThan(-1)
    editor.commands.insertContentAt(docPos, ' 寫規格')
    const out = save(editor)
    editor.destroy()
    expect(out).toBe(DAILY.replace('- [ ] 🔴\n', '- [ ] 🔴 寫規格\n'))
  })

  it('勾選任務：`- [x]` 直接接在標題後', () => {
    const editor = createEditor()
    load(editor, DAILY)
    let taskPos = -1
    editor.state.doc.descendants((node, nodePos) => {
      if (taskPos === -1 && node.type.name === 'taskItem') taskPos = nodePos
    })
    editor.commands.command(({ tr, state }) => {
      const node = state.doc.nodeAt(taskPos)!
      tr.setNodeMarkup(taskPos, undefined, { ...node.attrs, checked: true })
      return true
    })
    const out = save(editor)
    editor.destroy()
    expect(out).toBe(DAILY.replace('- [ ] 🔴\n', '- [x] 🔴\n'))
  })

  it('動過的清單裡的空項目存成 `- `，不是 `- &nbsp;`', () => {
    const raw = '## 標題\n- 第一\n-\n'
    const editor = createEditor()
    load(editor, raw)
    let pos = -1
    editor.state.doc.descendants((node, nodePos) => {
      if (pos === -1 && node.isText && node.text === '第一') pos = nodePos + node.text.length
    })
    editor.commands.insertContentAt(pos, '項')
    const out = save(editor)
    editor.destroy()
    expect(out).toBe('## 標題\n- 第一項\n- \n')
  })

  it('重複載入／存檔穩定', () => {
    const first = roundTrip(DAILY)
    expect(roundTrip(first)).toBe(first)
  })
})

describe('頂層區塊原文往返', () => {
  const samples: Record<string, string> = {
    '星號項目符號與 tab 縮排': '* 甲\n\t* 乙\n\t\t* 丙\n* 丁\n',
    '括號編號與不從 1 開始': '3) 三\n4) 四\n',
    'setext 標題與 *** 分隔線': 'Title\n=====\n\n段落\n\n***\n\n下一段\n',
    '引用緊接標題': '## 引用\n> 第一行\n> 第二行\n',
    'GitHub alert': '> [!NOTE] 提醒\n> 內容\n',
    '圍欄程式碼緊接段落': '說明\n```ts\nconst a = 1\n```\n\n後記\n',
    '連續兩個空行': '甲\n\n\n乙\n',
    '段落內的連結、wikilink、粗體、硬換行': '看 [[雙鏈目標|別名]] 與 **粗** *斜* `碼` [站](https://example.com "標")  \n下一行 ![圖](a.png)\n',
    '表格前後的間距': '## 表\n|a|b|\n|-|-|\n|1|2|\n\n段落\n',
    'frontmatter 後沒有空行': '---\ntitle: x\n---\n# 標題\n\n內容\n',
    'frontmatter 後兩個空行': '---\ntitle: x\n---\n\n\n# 標題\n',
    '清單緊接段落': '段落\n- 項目\n1. 一\n',
  }
  for (const [name, raw] of Object.entries(samples)) {
    it(`${name}：不改內容一字不差`, () => {
      expect(roundTrip(raw)).toBe(raw)
    })
  }

  it('任務項開頭的混合清單：兩個節點各有自己的原文，仍一字不差', () => {
    const raw = '- [ ] 任務\n- 一般\n'
    const editor = createEditor()
    load(editor, raw)
    const [taskList, bulletList] = blocks(editor)
    expect(taskList.type).toBe('taskList')
    expect(bulletList.type).toBe('bulletList')
    expect(taskList.attrs?.[BLOCK_RAW_ATTR]).toBe('- [ ] 任務\n')
    expect(bulletList.attrs?.[BLOCK_RAW_ATTR]).toBe('- 一般\n')
    expect(save(editor)).toBe(raw)
    editor.destroy()
  })

  it('一般項開頭的混合清單被上游從一個 token 拆成多個節點：各段用自己的原文，段之間緊接', () => {
    const raw = '- 一般\n- [ ] 任務\n- 又一般\n'
    const editor = createEditor()
    load(editor, raw)
    const [bulletList, taskList, bulletList2] = blocks(editor)
    expect([bulletList.type, taskList.type, bulletList2.type]).toEqual(['bulletList', 'taskList', 'bulletList'])
    expect(bulletList.attrs?.[BLOCK_RAW_ATTR]).toBe('- 一般\n')
    expect(taskList.attrs?.[BLOCK_RAW_ATTR]).toBe('- [ ] 任務\n')
    expect(taskList.attrs?.[BLOCK_GAP_ATTR]).toBe(0)
    expect(save(editor)).toBe(raw)
    editor.destroy()
  })

  it('混合清單中間有空行（loose）：段之間的空行照舊', () => {
    const raw = '- 一般\n\n- [ ] 任務\n'
    expect(roundTrip(raw)).toBe(raw)
  })

  it('載入時每個頂層區塊記下前面的空行數', () => {
    const editor = createEditor()
    load(editor, '# 一\n段\n\n\n- a\n')
    // 第四個是 TrailingNode 補的空段落
    expect(blocks(editor).map(block => block.attrs?.[BLOCK_GAP_ATTR]).slice(0, 3)).toEqual([null, 0, 2])
    editor.destroy()
  })

  it('改了段落文字就不再用原文（連結會重排，但間距照舊）', () => {
    const editor = createEditor()
    load(editor, '## 標\n看 [站](https://example.com "標") 吧\n')
    let pos = -1
    editor.state.doc.descendants((node, nodePos) => {
      if (pos === -1 && node.isText && node.text === '看 ') pos = nodePos
    })
    editor.commands.insertContentAt(pos, '請')
    const out = save(editor)
    editor.destroy()
    expect(out.startsWith('## 標\n請看 ')).toBe(true)
    expect(out).toContain('https://example.com')
  })

  it('Enter 拆開段落：兩半的簽章都對不上原文（ProseMirror 會把屬性複製到新節點），都走序列化器', () => {
    const editor = createEditor()
    load(editor, '甲乙\n')
    editor.commands.setTextSelection(2)
    editor.commands.splitBlock()
    expect(blocks(editor)[1].attrs?.[BLOCK_RAW_ATTR]).toBe('甲乙\n')
    expect(save(editor)).toBe('甲\n\n乙\n')
    editor.destroy()
  })
})

describe('區塊間距的安全規則', () => {
  const para = (text = 'x'): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const heading: JSONContent = { type: 'heading', attrs: { level: 2 } }
  const tight = (node: JSONContent): JSONContent => ({ ...node, attrs: { ...(node.attrs ?? {}), [BLOCK_GAP_ATTR]: 0 } })
  const list = (empty = false, type = 'bulletList', start?: number): JSONContent => ({
    type,
    attrs: start === undefined ? {} : { start },
    content: [{ type: type === 'taskList' ? 'taskItem' : 'listItem', content: [empty ? { type: 'paragraph' } : para('item')] }],
  })

  it('標題後可以緊接任何區塊', () => {
    for (const next of [para(), list(true), list(false, 'orderedList', 5), { type: 'horizontalRule' }, { type: 'table' }]) {
      expect(canBeTight(heading, next)).toBe(true)
    }
  })

  it('段落後只能緊接打得斷段落的區塊', () => {
    expect(canBeTight(para(), heading)).toBe(true)
    expect(canBeTight(para(), { type: 'codeBlock' })).toBe(true)
    expect(canBeTight(para(), { type: 'blockquote' })).toBe(true)
    expect(canBeTight(para(), list(false))).toBe(true)
    expect(canBeTight(para(), list(false, 'orderedList', 1))).toBe(true)
    expect(canBeTight(para(), list(true))).toBe(false)
    expect(canBeTight(para(), list(false, 'orderedList', 3))).toBe(false)
    expect(canBeTight(para(), { type: 'horizontalRule' })).toBe(false)
    expect(canBeTight(para(), para())).toBe(false)
    expect(canBeTight(para(), { type: 'table' })).toBe(false)
  })

  it('清單、引用、表格後不能緊接段落；清單接清單照載入時的樣子', () => {
    expect(canBeTight(list(), para())).toBe(false)
    expect(canBeTight({ type: 'blockquote' }, para())).toBe(false)
    expect(canBeTight({ type: 'table' }, para())).toBe(false)
    expect(canBeTight(list(), list(false, 'taskList'))).toBe(true)
    expect(canBeTight(list(), heading)).toBe(true)
    expect(canBeTight({ type: 'table' }, list())).toBe(true)
  })

  it('blockSeparator：沒記間距一個空行、0 依規則、n 照放', () => {
    expect(blockSeparator(heading, para())).toBe('\n\n')
    expect(blockSeparator(heading, tight(para()))).toBe('\n')
    expect(blockSeparator(para(), tight(para()))).toBe('\n\n')
    expect(blockSeparator(para(), { ...para(), attrs: { [BLOCK_GAP_ATTR]: 3 } })).toBe('\n\n\n\n')
  })

  it('簽章忽略圖片的 asset 路徑與連結的預設屬性，但看得出文字、mark 與勾選狀態', () => {
    const base: JSONContent = { type: 'paragraph', content: [
      { type: 'text', text: '看', marks: [{ type: 'link', attrs: { href: 'h', target: '_blank', rel: 'noopener' } }] },
      { type: 'image', attrs: { src: 'a.png', alt: '' } },
    ] }
    const loaded: JSONContent = { type: 'paragraph', attrs: { [BLOCK_GAP_ATTR]: 1 }, content: [
      { type: 'text', text: '看', marks: [{ type: 'link', attrs: { href: 'h', target: null, rel: null, class: null } }] },
      { type: 'image', attrs: { src: 'asset://localhost/x/a.png', relativeSrc: 'a.png', alt: '', uploading: false } },
    ] }
    expect(blockSignature(base)).toBe(blockSignature(loaded))
    expect(blockSignature({ ...base, content: [{ type: 'text', text: '看', marks: [{ type: 'link', attrs: { href: 'other' } }] }] })).not.toBe(blockSignature(base))
    const task = (checked: boolean): JSONContent => ({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }] })
    expect(blockSignature(task(false))).not.toBe(blockSignature(task(true)))
  })
})

describe('空段落不存成 &nbsp;（Issue #17）', () => {
  function insertEmptyParagraphAfter(editor: Editor, blockIndex: number) {
    let pos = 0
    editor.state.doc.forEach((child, offset, index) => { if (index === blockIndex) pos = offset + child.nodeSize })
    editor.chain().insertContentAt(pos, { type: 'paragraph' }).run()
  }

  it('在編輯器新建的空段落存成多一個空行，不出現 &nbsp;', () => {
    const editor = createEditor()
    load(editor, 'A\n\nB\n')
    insertEmptyParagraphAfter(editor, 0)
    const out = save(editor)
    editor.destroy()
    expect(out).not.toContain('&nbsp;')
    expect(out).toBe('A\n\n\nB\n')
  })

  it('連續兩個空段落多兩個空行；結尾的空段落省略', () => {
    const editor = createEditor()
    load(editor, 'A\n\nB\n')
    insertEmptyParagraphAfter(editor, 0)
    insertEmptyParagraphAfter(editor, 0)
    insertEmptyParagraphAfter(editor, 3) // 在 B 後面再加一個，結尾的空段落要省略
    const out = save(editor)
    editor.destroy()
    expect(out).toBe('A\n\n\n\nB\n')
  })

  it('存檔後再載入、再存檔，位元組相同（空行由 gapBefore 接手）', () => {
    const editor = createEditor()
    load(editor, 'A\n\nB\n')
    insertEmptyParagraphAfter(editor, 0)
    const first = save(editor)
    editor.destroy()
    expect(roundTrip(first)).toBe(first)
  })

  it('檔案裡原本就有的 &nbsp; 行維持原樣', () => {
    const raw = 'A\n\n&nbsp;\n\nB\n'
    expect(roundTrip(raw)).toBe(raw)
  })

  it('清單項裡的空段落與沒有空段落的檔案不受影響', () => {
    const raw = '- a\n-\n- b\n'
    expect(roundTrip(raw)).toBe(raw)
    expect(roundTrip('A\n\n\nB\n')).toBe('A\n\n\nB\n')
  })
})


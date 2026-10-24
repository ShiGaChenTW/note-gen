import { describe, expect, it } from 'vitest'
import {
  extractBlock,
  extractSection,
  findBlockIdLine,
  hideBlockIds,
  listHeadings,
  normalizeHeadingText,
  parseAtxHeading,
  stripFrontmatter,
} from './note-section'

const note = `---
title: 目標
tags: [a]
---

前言一段。

# 第一章

第一章內文。

## 第一節

第一節內容 [[A]]。

### 小節

小節內容。

## 第二節

第二節內容。 ^para-1

- 清單項 ^item-1
  - 子項
- 另一項

| a | b |
|---|---|
| 1 | 2 |
^table-1

| c |
|---|
| 3 ^row-1 |

\`\`\`md
# 不是標題
段落 ^not-an-id
\`\`\`

# 第二章 #

結尾。
`

describe('note-section: stripFrontmatter / headings', () => {
  it('strips the frontmatter block and the blank lines after it', () => {
    expect(stripFrontmatter(note).startsWith('前言一段。')).toBe(true)
    expect(stripFrontmatter('沒有 frontmatter')).toBe('沒有 frontmatter')
    expect(stripFrontmatter('---\r\na: 1\r\n---\r\n\r\nBody')).toBe('Body')
  })

  it('normalizes heading text (case, whitespace)', () => {
    expect(normalizeHeadingText('  Hello   World ')).toBe('hello world')
    expect(normalizeHeadingText('第一節')).toBe('第一節')
  })

  it('parses ATX headings and drops closing hashes', () => {
    expect(parseAtxHeading('# 第二章 #')).toEqual({ level: 1, text: '第二章' })
    expect(parseAtxHeading('### 小節')).toEqual({ level: 3, text: '小節' })
    expect(parseAtxHeading('#tag 不是標題')).toBeNull()
    expect(parseAtxHeading('####### 七個')).toBeNull()
    expect(parseAtxHeading('##')).toEqual({ level: 2, text: '' })
    expect(parseAtxHeading('# C# 語言')).toEqual({ level: 1, text: 'C# 語言' })
  })

  it('lists headings outside code fences', () => {
    expect(listHeadings(stripFrontmatter(note)).map(h => `${h.level}:${h.text}`)).toEqual([
      '1:第一章', '2:第一節', '3:小節', '2:第二節', '1:第二章',
    ])
  })
})

describe('note-section: extractSection', () => {
  it('returns the heading and everything up to the next heading of the same or higher level', () => {
    expect(extractSection(note, '第一節')).toBe('## 第一節\n\n第一節內容 [[A]]。\n\n### 小節\n\n小節內容。')
    expect(extractSection(note, '小節')).toBe('### 小節\n\n小節內容。')
  })

  it('is case-insensitive and trims', () => {
    const md = '## Hello World\n\nhi\n\n## Other\n\nno'
    expect(extractSection(md, '  hello   world ')).toBe('## Hello World\n\nhi')
  })

  it('runs to the end of the note for the last section and skips fences', () => {
    expect(extractSection(note, '第二章')).toBe('# 第二章 #\n\n結尾。')
    expect(extractSection(note, '不是標題')).toBeNull()
  })

  it('returns null when missing or empty', () => {
    expect(extractSection(note, '沒有這個')).toBeNull()
    expect(extractSection(note, '')).toBeNull()
  })

  it('handles CRLF notes (output is LF, it is only rendered)', () => {
    expect(extractSection('# A\r\n\r\nx\r\n\r\n# B\r\n\r\ny\r\n', 'a')).toBe('# A\n\nx')
    expect(extractBlock('a\r\nb ^p\r\n\r\nc\r\n', 'p')).toBe('a\nb')
  })
})

describe('note-section: extractBlock', () => {
  it('paragraph: the whole paragraph without the ^id marker', () => {
    expect(extractBlock(note, 'para-1')).toBe('第二節內容。')
    expect(extractBlock('第一行\n第二行 ^p\n\n其他', 'p')).toBe('第一行\n第二行')
  })

  it('list item: the item and its nested lines', () => {
    expect(extractBlock(note, 'item-1')).toBe('- 清單項\n  - 子項')
  })

  it('table: ^id on its own line after the table gives the whole table', () => {
    expect(extractBlock(note, 'table-1')).toBe('| a | b |\n|---|---|\n| 1 | 2 |')
  })

  it('table row: ^id inside a row gives the whole table with the marker removed', () => {
    expect(extractBlock(note, 'row-1')).toBe('| c |\n|---|\n| 3 |')
  })

  it('is case-insensitive, ignores fences, returns null when missing', () => {
    expect(extractBlock(note, 'PARA-1')).toBe('第二節內容。')
    expect(extractBlock(note, 'not-an-id')).toBeNull()
    expect(extractBlock(note, 'nope')).toBeNull()
    expect(extractBlock(note, '')).toBeNull()
  })

  it('findBlockIdLine reports the 0-based line in the given text', () => {
    const body = 'a\nb ^x\n'
    expect(findBlockIdLine(body, 'x')).toBe(1)
    expect(findBlockIdLine(body, 'y')).toBeNull()
  })
})

describe('hideBlockIds（Issue #15：嵌入顯示時隱藏區塊 id）', () => {
  it('隱藏行尾的 ^id，保留其他文字', () => {
    expect(hideBlockIds('段落內容 ^blk-1\n\n- 項目 ^item-1\n- 另一項')).toBe('段落內容\n\n- 項目\n- 另一項')
  })
  it('單獨一行的 ^id 整行移除', () => {
    expect(hideBlockIds('| a | b |\n|---|---|\n| 1 | 2 |\n\n^row-1\n')).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n\n')
  })
  it('表格列尾的 ^id 保留管線符號', () => {
    expect(hideBlockIds('| 1 | 2 | ^row-1')).toBe('| 1 | 2 |')
  })
  it('程式碼區塊內與沒有空白的 x^2 不處理', () => {
    const code = '```\nvalue ^not-an-id\n```'
    expect(hideBlockIds(code)).toBe(code)
    expect(hideBlockIds('面積是 x^2')).toBe('面積是 x^2')
    expect(hideBlockIds('這是 ^ 符號')).toBe('這是 ^ 符號')
  })
  it('沒有區塊 id 的內容原樣輸出', () => {
    expect(hideBlockIds('# 標題\n\n內文')).toBe('# 標題\n\n內文')
  })
})


import { describe, expect, it } from 'vitest'
import { findUnlinkedMentions, linkMention, linkMentions, normalizeMentionNames } from './unlinked-mentions'

describe('normalizeMentionNames', () => {
  it('略過短名與純數字，不分大小寫去重，長的在前', () => {
    expect(normalizeMentionNames([' a ', '12', 'Note', 'note', 'Longer Name', ''])).toEqual(['Longer Name', 'Note'])
  })
})

describe('findUnlinkedMentions', () => {
  it('命中名稱與別名、ASCII 不分大小寫、記下行列與上下文', () => {
    const content = '# About Note\n\n第一段提到 note 和 Alias。\nNotes 與 my_note 不算。\n'
    const mentions = findUnlinkedMentions(content, ['Note', 'Alias'])
    expect(mentions.map(m => [m.line, m.column, m.text])).toEqual([[0, 8, 'Note'], [2, 6, 'note'], [2, 13, 'Alias']])
    expect(mentions[1]).toMatchObject({ length: 4, context: '第一段提到 note 和 Alias。', contextOffset: 6 })
  })

  it('CJK 不套邊界，ASCII 名稱才套邊界', () => {
    expect(findUnlinkedMentions('這是讀書筆記的內容', ['讀書']).map(m => m.text)).toEqual(['讀書'])
    expect(findUnlinkedMentions('xNote Notex Note_ _Note Note', ['Note']).map(m => m.column)).toEqual([24])
    expect(findUnlinkedMentions('(Note) Note. 「Note」', ['Note']).map(m => m.column)).toEqual([1, 7, 14])
  })

  it('同一位置取最長，重疊的只留前面', () => {
    const mentions = findUnlinkedMentions('Project Note 與 Note Project', ['Note', 'Project Note', 'Note Project'])
    expect(mentions.map(m => m.text)).toEqual(['Project Note', 'Note Project'])
  })

  it('跳過 frontmatter、code、wikilink、markdown 連結、URL 與標籤；標題行要算', () => {
    const content = [
      '---',
      'title: Note',
      '---',
      '## Note 標題',
      '[[Note]] 與 [[Note|別名]] 與 ![[Note]] 已連結',
      '`Note` 與 ``Note `x` `` 行內 code',
      '```',
      'Note fenced',
      '```',
      '[Note](Note.md) 與 ![Note](Note.png) 與 https://example.com/Note 連結',
      '#Note 標籤 與 #tag/Note 巢狀 與 Note 文字',
      '~~~',
      'Note 另一種 fence',
      '~~~',
    ].join('\n')
    const mentions = findUnlinkedMentions(content, ['Note'])
    expect(mentions.map(m => [m.line, m.column])).toEqual([[3, 3], [10, 26]])
  })

  it('CRLF 內容的行列與上下文不含 \\r', () => {
    const mentions = findUnlinkedMentions('第一行\r\n提到 Note 了\r\n', ['Note'])
    expect(mentions).toHaveLength(1)
    expect(mentions[0]).toMatchObject({ line: 1, column: 3, context: '提到 Note 了', contextOffset: 3 })
  })

  it('上下文以命中為中心、最多 160 字', () => {
    const long = `${'前'.repeat(200)}Note${'後'.repeat(200)}`
    const [mention] = findUnlinkedMentions(long, ['Note'])
    expect(mention.context).toHaveLength(160)
    expect(mention.context.slice(mention.contextOffset, mention.contextOffset + 4)).toBe('Note')
  })

  it('沒有名稱或內容時回傳空陣列', () => {
    expect(findUnlinkedMentions('Note', [])).toEqual([])
    expect(findUnlinkedMentions('', ['Note'])).toEqual([])
    expect(findUnlinkedMentions('n', ['n'])).toEqual([])
  })
})

describe('linkMention', () => {
  const content = '前言\n提到 note 與 Note 與 Alias。\n| 表 | Note |\n後記\n'

  it('相同寫 [[target]]，不同（大小寫或別名）寫 [[target|原文]]，其他行一字不差', () => {
    const [lower, exact, alias] = findUnlinkedMentions(content, ['Note', 'Alias'])
    expect(linkMention(content, exact, 'Note').split('\n')[1]).toBe('提到 note 與 [[Note]] 與 Alias。')
    expect(linkMention(content, lower, 'Note').split('\n')[1]).toBe('提到 [[Note|note]] 與 Note 與 Alias。')
    expect(linkMention(content, alias, 'folder/Note').split('\n')[1]).toBe('提到 note 與 Note 與 [[folder/Note|Alias]]。')
    const result = linkMention(content, alias, 'Note')
    const before = content.split('\n')
    result.split('\n').forEach((line, i) => { if (i !== 1) expect(line).toBe(before[i]) })
  })

  it('表格列用 \\|', () => {
    const table = findUnlinkedMentions(content, ['Note']).find(m => m.line === 2)!
    expect(linkMention(content, table, 'note').split('\n')[2]).toBe('| 表 | [[note\\|Note]] |')
  })

  it('位置上的文字已經變了就原樣回傳', () => {
    const [mention] = findUnlinkedMentions(content, ['Note'])
    const changed = content.replace('提到 note', '提到 nope')
    expect(linkMention(changed, mention, 'Note')).toBe(changed)
  })

  it('同一篇多筆由後往前一次改完，CRLF 原樣', () => {
    const crlf = 'Note 開頭\r\n中間 note 再 Note\r\n結尾\r\n'
    const mentions = findUnlinkedMentions(crlf, ['Note'])
    expect(mentions).toHaveLength(3)
    expect(linkMentions(crlf, mentions, 'Note')).toBe('[[Note]] 開頭\r\n中間 [[Note|note]] 再 [[Note]]\r\n結尾\r\n')
  })
})

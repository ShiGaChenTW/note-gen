import { describe, expect, it } from 'vitest'
import {
  findWikilinks,
  noteKeyOf,
  parseWikilink,
  resolveWikilinkTarget,
  wikilinkDisplayText,
  wikilinkTargetFor,
} from './wikilink'

describe('parseWikilink', () => {
  it('基本、別名、標題、block id', () => {
    expect(parseWikilink('[[Note]]')).toEqual({ raw: '[[Note]]', target: 'Note', heading: '', blockId: '', alias: '', embed: false })
    expect(parseWikilink('[[Note|顯示]]')?.alias).toBe('顯示')
    expect(parseWikilink('[[Note\\|顯示]]')?.alias).toBe('顯示')
    expect(parseWikilink('[[Note\\|顯示]]')?.target).toBe('Note')
    expect(parseWikilink('[[Note#段落|顯示]]')).toMatchObject({ target: 'Note', heading: '段落', alias: '顯示' })
    expect(parseWikilink('[[Note#^abc123]]')).toMatchObject({ target: 'Note', heading: '', blockId: 'abc123' })
    expect(parseWikilink('[[#只有標題]]')).toMatchObject({ target: '', heading: '只有標題' })
    expect(parseWikilink('[[ folder/Note.md ]]')?.target).toBe('folder/Note.md')
  })

  it('嵌入', () => {
    expect(parseWikilink('![[圖.png]]')).toMatchObject({ target: '圖.png', embed: true, raw: '![[圖.png]]' })
  })

  it('不合法', () => {
    expect(parseWikilink('[[]]')).toBeNull()
    expect(parseWikilink('[[|只有別名]]')).toBeNull()
    expect(parseWikilink('[[a[[b]]')).toBeNull()
    expect(parseWikilink('[Note]')).toBeNull()
    expect(parseWikilink('[[多\n行]]')).toBeNull()
  })
})

describe('wikilinkDisplayText', () => {
  it('別名 > 檔名 > 標題', () => {
    expect(wikilinkDisplayText(parseWikilink('[[a/b/Note.md|別名]]')!)).toBe('別名')
    expect(wikilinkDisplayText(parseWikilink('[[a/b/Note.md]]')!)).toBe('Note')
    expect(wikilinkDisplayText(parseWikilink('[[Note#段落]]')!)).toBe('Note > 段落')
    expect(wikilinkDisplayText(parseWikilink('[[#段落]]')!)).toBe('段落')
  })
})

describe('findWikilinks', () => {
  it('找出行號與位置，跳過 code', () => {
    const content = [
      '---',
      'related: "[[Front]]"',
      '---',
      '看 [[A]] 和 [[B|別名]]，還有 ![[圖.png]]',
      '`[[inline code]]` 不算，但 [[C]] 算',
      '```',
      '[[fenced]]',
      '```',
      '| 表格 | [[D\\|d]] |',
    ].join('\n')
    const links = findWikilinks(content)
    expect(links.map(l => [l.line, l.column, l.target, l.alias, l.embed])).toEqual([
      [1, 10, 'Front', '', false],
      [3, 2, 'A', '', false],
      [3, 10, 'B', '別名', false],
      [3, 22, '圖.png', '', true],
      [4, 23, 'C', '', false],
      [8, 7, 'D', 'd', false],
    ])
  })

  it('CRLF 與空內容', () => {
    expect(findWikilinks('')).toEqual([])
    expect(findWikilinks('[[A]]\r\n[[B]]\r\n').map(l => l.line)).toEqual([0, 1])
  })
})

describe('noteKeyOf', () => {
  it('去路徑與 .md', () => {
    expect(noteKeyOf('a/b/Note.md')).toBe('Note')
    expect(noteKeyOf('Note')).toBe('Note')
    expect(noteKeyOf('a\\b\\Note.MD')).toBe('Note')
    expect(noteKeyOf('圖.png')).toBe('圖.png')
  })
})

describe('resolveWikilinkTarget', () => {
  const paths = [
    'Inbox/Note.md',
    'Projects/Note.md',
    'Projects/Sub/Deep.md',
    'Daily/20261019.md',
    'Attachments/圖.png',
    'Other/unique.md',
  ]

  it('完整路徑優先，可省略 .md', () => {
    expect(resolveWikilinkTarget('Projects/Note', paths)).toBe('Projects/Note.md')
    expect(resolveWikilinkTarget('Projects/Note.md', paths)).toBe('Projects/Note.md')
    expect(resolveWikilinkTarget('projects/note', paths)).toBe('Projects/Note.md')
  })

  it('檔名唯一時直接命中，不分大小寫', () => {
    expect(resolveWikilinkTarget('unique', paths)).toBe('Other/unique.md')
    expect(resolveWikilinkTarget('UNIQUE', paths)).toBe('Other/unique.md')
    expect(resolveWikilinkTarget('Deep.md', paths)).toBe('Projects/Sub/Deep.md')
    expect(resolveWikilinkTarget('20261019', paths)).toBe('Daily/20261019.md')
  })

  it('同名時先同資料夾，再最短路徑', () => {
    expect(resolveWikilinkTarget('Note', paths, 'Projects/Other.md')).toBe('Projects/Note.md')
    expect(resolveWikilinkTarget('Note', paths, 'Daily/20261019.md')).toBe('Inbox/Note.md')
    expect(resolveWikilinkTarget('Note', paths)).toBe('Inbox/Note.md')
  })

  it('附件要連副檔名', () => {
    expect(resolveWikilinkTarget('圖.png', paths)).toBe('Attachments/圖.png')
    expect(resolveWikilinkTarget('圖', paths)).toBeNull()
  })

  it('找不到與本篇', () => {
    expect(resolveWikilinkTarget('沒有這篇', paths)).toBeNull()
    expect(resolveWikilinkTarget('', paths, 'Inbox/Note.md')).toBe('Inbox/Note.md')
    expect(resolveWikilinkTarget('', paths)).toBeNull()
  })
})

describe('wikilinkTargetFor', () => {
  const paths = ['Inbox/Note.md', 'Projects/Note.md', 'Other/unique.md']
  it('唯一時只寫檔名，同名時寫完整路徑', () => {
    expect(wikilinkTargetFor('Other/unique.md', paths)).toBe('unique')
    expect(wikilinkTargetFor('Projects/Note.md', paths)).toBe('Projects/Note')
  })
})

import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import {
  COMPOSER_MENTION_NODE,
  serializeComposerDoc,
  textToComposerDoc,
  textToComposerInlineContent,
} from './serialize'

const mention = (id: string, kind: string, label: string): JSONContent => ({
  type: COMPOSER_MENTION_NODE,
  attrs: { id, kind, label },
})

const text = (value: string): JSONContent => ({ type: 'text', text: value })

describe('serializeComposerDoc', () => {
  it('提及留在句中原本的位置', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          text('比較 '),
          mention('record:record:12', 'record', '會議紀錄'),
          text(' 和 '),
          mention('file:/vault/工作/週報.md', 'file', '週報'),
          text(' 的差異'),
        ],
      }],
    }

    expect(serializeComposerDoc(doc)).toEqual({
      text: '比較 @會議紀錄 和 @週報 的差異',
      mentions: [
        { id: 'record:record:12', kind: 'record', label: '會議紀錄' },
        { id: 'file:/vault/工作/週報.md', kind: 'file', label: '週報' },
      ],
    })
  })

  it('三種提及都轉成 @名稱，同一份只附加一次上下文', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          mention('canvas:c1', 'canvas', '產品地圖'),
          text(' 對照 '),
          mention('file:/a.md', 'file', 'a'),
          text('，再看一次 '),
          mention('canvas:c1', 'canvas', '產品地圖'),
        ],
      }],
    }

    const result = serializeComposerDoc(doc)
    expect(result.text).toBe('@產品地圖 對照 @a，再看一次 @產品地圖')
    expect(result.mentions.map(item => item.id)).toEqual(['canvas:c1', 'file:/a.md'])
  })

  it('Shift+Enter 的換行與段落都變成 \\n', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [text('第一行'), { type: 'hardBreak' }, text('第二行')] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [text('第四行')] },
      ],
    }

    expect(serializeComposerDoc(doc).text).toBe('第一行\n第二行\n\n第四行')
  })

  it('空文件是空字串，壞掉的提及不輸出', () => {
    expect(serializeComposerDoc(textToComposerDoc(''))).toEqual({ text: '', mentions: [] })
    expect(serializeComposerDoc(null)).toEqual({ text: '', mentions: [] })
    const broken: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [text('a'), { type: COMPOSER_MENTION_NODE, attrs: {} }, text('b')] }],
    }
    expect(serializeComposerDoc(broken)).toEqual({ text: 'ab', mentions: [] })
  })

  it('名稱的換行與多餘空白壓成一格，空名稱改用 id', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [mention('record:record:3', 'record', '  兩行\n標題 '), text(' '), mention('canvas:x', 'canvas', '   ')],
      }],
    }

    expect(serializeComposerDoc(doc).text).toBe('@兩行 標題 @canvas:x')
  })
})

describe('textToComposerDoc', () => {
  it.each([
    '',
    '單行',
    '第一行\n第二行',
    '前面空一行\n\n後面',
    '\n開頭換行',
    '結尾換行\n',
    '@不是膠囊 只是文字',
  ])('與 serializeComposerDoc 互為反向：%j', value => {
    expect(serializeComposerDoc(textToComposerDoc(value)).text).toBe(value)
  })

  it('Windows 換行統一成 \\n', () => {
    expect(serializeComposerDoc(textToComposerDoc('a\r\nb\rc')).text).toBe('a\nb\nc')
  })

  it('只產生文字與 hardBreak，空行不產生空文字節點', () => {
    expect(textToComposerInlineContent('a\n\nb')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'hardBreak' },
      { type: 'hardBreak' },
      { type: 'text', text: 'b' },
    ])
  })
})

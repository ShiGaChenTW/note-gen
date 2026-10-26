import { describe, expect, it } from 'vitest'
import { recordNoteContent } from './record-to-note'

describe('recordNoteContent', () => {
  it('keeps text records as-is', () => {
    expect(recordNoteContent({ type: 'text', content: '  想法\n第二行 ', desc: '', url: '' })).toBe('想法\n第二行\n')
  })

  it('turns a link record into a markdown link plus its content', () => {
    expect(recordNoteContent({ type: 'link', content: '摘要', desc: '標題', url: 'https://example.com' }))
      .toBe('[標題](https://example.com)\n\n摘要\n')
  })

  it('turns a todo record into a task line', () => {
    const content = JSON.stringify({ title: '買菜', description: '牛奶', completed: false })
    expect(recordNoteContent({ type: 'todo', content, desc: '', url: '' })).toBe('- [ ] 買菜\n\n牛奶\n')
  })

  it('does not repeat an image description that equals its OCR text', () => {
    expect(recordNoteContent({ type: 'scan', content: 'OCR', desc: 'OCR', url: 'image/a.png' })).toBe('OCR\n')
  })

  it('keeps a prompt draft record as-is, appending its source URL when present (#55)', () => {
    expect(recordNoteContent({ type: 'prompt-draft', content: '寫一篇關於 {{topic}} 的文章', desc: '', url: 'https://example.com' }))
      .toBe('寫一篇關於 {{topic}} 的文章\n\nhttps://example.com\n')
  })

  it('keeps a prompt draft record without a source URL unchanged', () => {
    expect(recordNoteContent({ type: 'prompt-draft', content: '寫一篇關於 {{topic}} 的文章', desc: '', url: '' }))
      .toBe('寫一篇關於 {{topic}} 的文章\n')
  })
})

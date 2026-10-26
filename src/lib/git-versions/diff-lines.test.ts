import { describe, expect, it } from 'vitest'
import { diffLines } from './diff-lines'

describe('git-versions/diffLines', () => {
  it('marks identical text as all equal', () => {
    const result = diffLines('a\nb\nc', 'a\nb\nc')
    expect(result).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'equal', text: 'b' },
      { type: 'equal', text: 'c' },
    ])
  })

  it('detects a pure addition without flagging unrelated lines', () => {
    const result = diffLines('a\nc', 'a\nb\nc')
    expect(result).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'equal', text: 'c' },
    ])
  })

  it('detects a pure removal without flagging unrelated lines', () => {
    const result = diffLines('a\nb\nc', 'a\nc')
    expect(result).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'remove', text: 'b' },
      { type: 'equal', text: 'c' },
    ])
  })

  it('pairs a changed line as remove+add instead of rewriting the whole file', () => {
    const result = diffLines('title\nold line\nfooter', 'title\nnew line\nfooter')
    expect(result).toEqual([
      { type: 'equal', text: 'title' },
      { type: 'remove', text: 'old line' },
      { type: 'add', text: 'new line' },
      { type: 'equal', text: 'footer' },
    ])
  })

  it('treats an empty old text as a full addition', () => {
    const result = diffLines('', 'a\nb')
    expect(result).toEqual([
      { type: 'add', text: 'a' },
      { type: 'add', text: 'b' },
    ])
  })

  it('treats an empty new text as a full removal', () => {
    const result = diffLines('a\nb', '')
    expect(result).toEqual([
      { type: 'remove', text: 'a' },
      { type: 'remove', text: 'b' },
    ])
  })

  it('returns an empty diff for two empty texts', () => {
    expect(diffLines('', '')).toEqual([])
  })

  it('keeps an inserted block out of the removed/added middle instead of marking everything changed', () => {
    const oldText = 'a\nb\nc\nd'
    const newText = 'a\nx\ny\nb\nc\nd'
    const result = diffLines(oldText, newText)
    expect(result).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'add', text: 'x' },
      { type: 'add', text: 'y' },
      { type: 'equal', text: 'b' },
      { type: 'equal', text: 'c' },
      { type: 'equal', text: 'd' },
    ])
  })
})

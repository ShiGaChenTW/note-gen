// Fork（almanac ALMNC-54.8）：資料源整頁編輯器——標題／內文、字數、存成新版本 vN、格式工具列。
import { describe, expect, it } from 'vitest'
import { applyFormat, isChanged, joinContent, splitContent, versionAfterSave, wordCount } from './source-editor'

describe('source editor', () => {
  it('splits the first line into the title and joins it back', () => {
    expect(splitContent('# 早上和 A 通話\n\nA 說下週二\n地點在工廠')).toEqual({ title: '早上和 A 通話', body: 'A 說下週二\n地點在工廠' })
    expect(splitContent('', '白板照片')).toEqual({ title: '白板照片', body: '' })
    expect(joinContent({ title: '標題', body: '內文' })).toBe('標題\n\n內文')
    expect(joinContent({ title: ' ', body: '只有內文' })).toBe('只有內文')
  })

  it('counts characters without whitespace (title + body)', () => {
    expect(wordCount({ title: '產線 平衡', body: 'ab c\n中' })).toBe(8)
  })

  it('detects changes against the original', () => {
    expect(isChanged('標題\n\n內文', { title: '標題', body: '內文' })).toBe(false)
    expect(isChanged('標題\n\n內文', { title: '標題', body: '內文。' })).toBe(true)
  })

  it('saving a submitted source makes v(N+1) and keeps the old one; drafts stay in place', () => {
    expect(versionAfterSave({ version: 1, locked: true })).toEqual({ version: 2, versioned: true })
    expect(versionAfterSave({ version: 1, locked: false })).toEqual({ version: 1, versioned: false })
  })

  it('applies the formatting toolbar to the selection', () => {
    expect(applyFormat('abc', 0, 3, 'bold')).toEqual({ text: '**abc**', start: 2, end: 5 })
    expect(applyFormat('a\nb', 0, 3, 'bullet').text).toBe('- a\n- b')
    expect(applyFormat('a\nb', 0, 3, 'numbered').text).toBe('1. a\n2. b')
    expect(applyFormat('x', 0, 1, 'task').text).toBe('- [ ] x')
    expect(applyFormat('x', 0, 1, 'heading').text).toBe('## x')
    expect(applyFormat('x', 1, 1, 'rule').text).toBe('x\n\n---\n')
    expect(applyFormat('x', 0, 1, 'link').text).toBe('[x](https://)')
  })
})

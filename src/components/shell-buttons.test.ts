// Fork（almanac ALMNC-62）：側欄開關「不能只剩左欄」的判斷、可拖曳欄寬的讀寫、預設提示詞標題的顯示。
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { wouldCauseLeftOnly } from './shell-buttons'
import { clampWidth, readStoredWidth, storeWidth } from '@/hooks/use-drag-width'
import { displayPromptTitle } from '@/lib/prompt-title'

describe('wouldCauseLeftOnly', () => {
  it('never blocks opening a hidden panel', () => {
    expect(wouldCauseLeftOnly({ left: false, center: true, right: false }, 'left')).toBe(false)
  })
  it('blocks closing the last visible panel', () => {
    expect(wouldCauseLeftOnly({ left: false, center: true, right: false }, 'center')).toBe(true)
  })
  it('blocks closing center or right when only the left would remain', () => {
    expect(wouldCauseLeftOnly({ left: true, center: true, right: false }, 'center')).toBe(true)
    expect(wouldCauseLeftOnly({ left: true, center: false, right: true }, 'right')).toBe(true)
  })
  it('allows closing the left sidebar', () => {
    expect(wouldCauseLeftOnly({ left: true, center: true, right: true }, 'left')).toBe(false)
    expect(wouldCauseLeftOnly({ left: true, center: true, right: false }, 'left')).toBe(false)
  })
})

describe('stored column widths', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })
  it('clamps into range', () => {
    expect(clampWidth(100, 200, 400)).toBe(200)
    expect(clampWidth(999, 200, 400)).toBe(400)
    expect(clampWidth(250.6, 200, 400)).toBe(251)
  })
  it('falls back when nothing or garbage is stored, and clamps stored values', () => {
    expect(readStoredWidth('w', 240, 200, 400)).toBe(240)
    localStorage.setItem('w', 'abc')
    expect(readStoredWidth('w', 240, 200, 400)).toBe(240)
    storeWidth('w', 520)
    expect(readStoredWidth('w', 240, 200, 400)).toBe(400)
    storeWidth('w', 312.4)
    expect(readStoredWidth('w', 240, 200, 400)).toBe(312)
  })
})

describe('displayPromptTitle', () => {
  it('localizes the untouched built-in prompt', () => {
    expect(displayPromptTitle({ title: '写作助手', isDefault: true }, '寫作助手')).toBe('寫作助手')
  })
  it('keeps titles the user wrote, and non-default prompts', () => {
    expect(displayPromptTitle({ title: '我的助手', isDefault: true }, '寫作助手')).toBe('我的助手')
    expect(displayPromptTitle({ title: '写作助手' }, '寫作助手')).toBe('写作助手')
    expect(displayPromptTitle(null, '寫作助手')).toBe('')
  })
})

// Fork（almanac ALMNC-69.1）：接受的筆記檔名就是標題。
import { describe, expect, it } from 'vitest'
import { capturePath, NOTE_FILE_NAME_MAX, noteFileName } from './capture'

const now = new Date(2026, 10, 18, 9, 30)

describe('noteFileName', () => {
  it('用標題當檔名，不加時間前綴', () => {
    expect(noteFileName('定價想法', now)).toBe('定價想法.md')
  })

  it('去掉檔名不能用的字元與開頭的點，只取第一行', () => {
    expect(noteFileName('A/B: C?\n第二行', now)).toBe('A B C.md')
    expect(noteFileName('..隱藏', now)).toBe('隱藏.md')
  })

  it('過長的標題截斷', () => {
    expect(noteFileName('字'.repeat(200), now)).toBe(`${'字'.repeat(NOTE_FILE_NAME_MAX)}.md`)
  })

  it('標題清完是空的就退回時間格式', () => {
    expect(noteFileName('  ///  ', now)).toBe('2026-11-18 0930.md')
  })

  it('同名時由 capturePath 加序號', () => {
    expect(capturePath('10 Inbox', '定價想法.md', 1)).toBe('10 Inbox/定價想法 2.md')
  })
})

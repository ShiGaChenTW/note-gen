import { describe, expect, it } from 'vitest'
import { branchPositionPinned } from './scott-pin-check'
import { SCOTT_PIN_TTL_MS, type ScottPin } from './scott-pins'

const now = Date.UTC(2026, 10, 24)
const base = { mocPath: '20 領域/時間管理.md', mocId: 'M-20261110-063015-AAAA', mocName: '時間管理', at: now - 1000 }
const pos = { mocId: base.mocId, chapterId: 'C-20261110-063015-CCCC' }

describe('ALMNC-69.14 × 69.11：分家／併回位置的 Scott 指定', () => {
  it('章節本身：只看同章節的章節名標記', () => {
    const pins: ScottPin[] = [{ ...base, kind: 'chapter-title', chapterId: pos.chapterId }]
    expect(branchPositionPinned(pos, pins, now)).toBe(true)
    expect(branchPositionPinned({ ...pos, chapterId: 'C-20261110-063015-DDDD' }, pins, now)).toBe(false)
    expect(branchPositionPinned({ ...pos, mocId: 'M-20261110-063015-BBBB' }, pins, now)).toBe(false)
  })

  it('收錄：依 N 編號或路徑比對，帶章節的標記要同章', () => {
    const pins: ScottPin[] = [
      { ...base, kind: 'relation', noteId: 'N-20261110-063015-NNNN', chapterId: pos.chapterId },
      { ...base, kind: 'position', notePath: '10 知識筆記/甲.md' },
    ]
    expect(branchPositionPinned({ ...pos, note: 'N-20261110-063015-NNNN' }, pins, now)).toBe(true)
    expect(branchPositionPinned({ ...pos, chapterId: 'C-20261110-063015-DDDD', note: 'N-20261110-063015-NNNN' }, pins, now)).toBe(false)
    expect(branchPositionPinned({ ...pos, note: '10 知識筆記/甲.md' }, pins, now)).toBe(true)
    expect(branchPositionPinned({ ...pos, note: '10 知識筆記/乙.md' }, pins, now)).toBe(false)
  })

  it('區塊標記不算；90 天後失效', () => {
    expect(branchPositionPinned(pos, [{ ...base, kind: 'block', block: 'conclusions' }], now)).toBe(false)
    const old: ScottPin[] = [{ ...base, kind: 'chapter-title', chapterId: pos.chapterId, at: now - SCOTT_PIN_TTL_MS - 1 }]
    expect(branchPositionPinned(pos, old, now)).toBe(false)
  })
})

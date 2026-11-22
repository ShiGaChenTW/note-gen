// Fork（almanac ALMNC-54.8）：先放著（AC#4）——任何卡片都能放著、可設提醒日期，日期到了才回到清單。
import { describe, expect, it, vi } from 'vitest'
import {
  PUT_ASIDE_KEY, hiddenCards, isHidden, loadAside, pruneAside, putAside, reminderPresets, sanitizeAside, saveAside, takeBack, visibleCards,
} from './put-aside'

const NOW = new Date(2026, 10, 21, 10).getTime() // 2026-11-21（週六）
const cards = [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }, { key: 'c', title: 'C' }]

describe('put aside', () => {
  it('AC#4: any card can be put aside; without a date it stays hidden until taken back', () => {
    const map = putAside({}, cards[0], NOW)
    expect(map.a).toEqual({ at: NOW, title: 'A' })
    expect(visibleCards(cards, map, NOW).map(card => card.key)).toEqual(['b', 'c'])
    expect(hiddenCards(cards, map, NOW).map(card => card.key)).toEqual(['a'])
    expect(visibleCards(cards, takeBack(map, 'a'), NOW)).toHaveLength(3)
  })

  it('AC#4: a reminder date brings the card back on that day', () => {
    const map = putAside({}, cards[1], NOW, '2026-11-23')
    expect(isHidden(map.b, NOW)).toBe(true)
    expect(isHidden(map.b, new Date(2026, 10, 22, 23, 59).getTime())).toBe(true)
    expect(isHidden(map.b, new Date(2026, 10, 23, 0, 1).getTime())).toBe(false)
    expect(hiddenCards(cards, map, new Date(2026, 10, 24).getTime())).toEqual([])
  })

  it('ignores malformed dates and prunes entries whose card is gone', () => {
    expect(putAside({}, cards[0], NOW, 'next week').a.until).toBeUndefined()
    const map = putAside(putAside({}, cards[0], NOW), cards[1], NOW)
    expect(Object.keys(pruneAside(map, ['b']))).toEqual(['b'])
    expect(pruneAside(map, ['a', 'b'])).toBe(map)
  })

  it('offers tomorrow and next Monday', () => {
    expect(reminderPresets(NOW)).toEqual({ tomorrow: '2026-11-22', nextWeek: '2026-11-23' })
    expect(reminderPresets(new Date(2026, 10, 23, 9).getTime()).nextWeek).toBe('2026-11-30')
  })

  it('persists in store.json under workbenchAside and drops junk', async () => {
    const storage = { get: vi.fn(async () => ({ a: { at: 1, title: 'A', until: '2026-12-01' }, bad: { at: 'x' }, c: { at: 2, title: 'C', until: 'soon' } })), set: vi.fn(async () => {}), save: vi.fn(async () => {}) }
    expect(await loadAside(storage)).toEqual({ a: { at: 1, title: 'A', until: '2026-12-01' }, c: { at: 2, title: 'C' } })
    await saveAside({ a: { at: 1, title: 'A' } }, storage)
    expect(storage.set).toHaveBeenCalledWith(PUT_ASIDE_KEY, { a: { at: 1, title: 'A' } })
    expect(storage.save).toHaveBeenCalled()
    expect(sanitizeAside(null)).toEqual({})
  })
})

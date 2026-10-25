import { describe, expect, it } from 'vitest'
import { EMPTY_PREFS, cardsForSlot, isCardVisible, moveCardBy, moveCardTo, normalizePrefs, setCardVisible } from './cards'

const cards = [
  { key: 'schedule', defaultOn: true, slots: { main: 1, side: 1 } },
  { key: 'recent', defaultOn: true, slots: { side: 1 } },
  { key: 'footprint', defaultOn: false, slots: { side: 1 } },
]

describe('首頁卡片設定', () => {
  it('讀回時丟掉不存在的卡片、補上新卡片', () => {
    expect(normalizePrefs({ order: ['gone', 'recent', 'recent'], hidden: ['gone', 'recent'] }, cards)).toEqual({
      order: ['recent', 'schedule', 'footprint'],
      hidden: ['recent'],
      shown: [],
    })
    expect(normalizePrefs(null, cards).order).toEqual(['schedule', 'recent', 'footprint'])
    expect(normalizePrefs('garbage', cards)).toEqual({ order: ['schedule', 'recent', 'footprint'], hidden: [], shown: [] })
  })

  it('預設開／關與使用者切換', () => {
    const prefs = normalizePrefs(EMPTY_PREFS, cards)
    expect(isCardVisible(prefs, cards[0])).toBe(true)
    expect(isCardVisible(prefs, cards[2])).toBe(false)
    const on = setCardVisible(prefs, cards[2], true)
    expect(isCardVisible(on, cards[2])).toBe(true)
    const off = setCardVisible(on, cards[2], false)
    expect(isCardVisible(off, cards[2])).toBe(false)
    expect(off.shown).toEqual([])
    expect(isCardVisible(setCardVisible(prefs, cards[0], false), cards[0])).toBe(false)
  })

  it('拖曳與上下移', () => {
    const prefs = normalizePrefs(EMPTY_PREFS, cards)
    expect(moveCardTo(prefs, 'footprint', 'schedule').order).toEqual(['footprint', 'schedule', 'recent'])
    expect(moveCardTo(prefs, 'schedule', 'footprint').order).toEqual(['recent', 'footprint', 'schedule'])
    expect(moveCardBy(prefs, 'recent', -1).order).toEqual(['recent', 'schedule', 'footprint'])
    expect(moveCardBy(prefs, 'schedule', -1)).toBe(prefs)
    expect(moveCardBy(prefs, 'footprint', 1)).toBe(prefs)
  })

  it('依欄位與順序挑出要顯示的卡片', () => {
    const prefs = moveCardTo(setCardVisible(normalizePrefs(EMPTY_PREFS, cards), cards[2], true), 'footprint', 'schedule')
    expect(cardsForSlot(cards, prefs, 'side').map(card => card.key)).toEqual(['footprint', 'schedule', 'recent'])
    expect(cardsForSlot(cards, prefs, 'main').map(card => card.key)).toEqual(['schedule'])
    expect(cardsForSlot(cards, setCardVisible(prefs, cards[0], false), 'main')).toEqual([])
  })
})

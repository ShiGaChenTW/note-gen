// almanac ALMNC-45：釘選資料清單（加入、排序、移除、改名／移動跟著走、刪除後移除、釘選日與最後送出日）。
import { describe, expect, it } from 'vitest'
import {
  addPin, applyPathDelete, applyPathMove, isPinned, markPinsSent, movePin, movePinBy, normalizePins, removePin, togglePin,
  type EinkPin,
} from './pins'

const T = Date.UTC(2026, 10, 21)
const paths = (pins: EinkPin[]) => pins.map(pin => pin.path)

function list(...items: string[]): EinkPin[] {
  return items.reduce<EinkPin[]>((pins, path, index) => addPin(pins, path, T + index), [])
}

describe('addPin／removePin／togglePin', () => {
  it('加在最後並記下釘選日；同一路徑不重複', () => {
    const pins = addPin(list('a.md'), 'b.md', T + 5)
    expect(pins).toEqual([{ path: 'a.md', pinnedAt: T, order: 0 }, { path: 'b.md', pinnedAt: T + 5, order: 1 }])
    expect(addPin(pins, 'a.md', T + 9)).toEqual(pins)
  })

  it('路徑統一成工作區相對、正斜線', () => {
    expect(paths(addPin([], './資料夾\\筆記.md', T))).toEqual(['資料夾/筆記.md'])
    expect(isPinned(list('資料夾/筆記.md'), '資料夾\\筆記.md')).toBe(true)
  })

  it('移除後 order 重新連續', () => {
    const pins = removePin(list('a.md', 'b.md', 'c.md'), 'b.md')
    expect(pins.map(pin => [pin.path, pin.order])).toEqual([['a.md', 0], ['c.md', 1]])
  })

  it('togglePin 釘了再按一次就取消', () => {
    const once = togglePin([], 'a.md', T)
    expect(isPinned(once, 'a.md')).toBe(true)
    expect(togglePin(once, 'a.md', T)).toEqual([])
  })
})

describe('排序', () => {
  it('移到指定位置，超出範圍夾在頭尾', () => {
    const pins = list('a.md', 'b.md', 'c.md')
    expect(paths(movePin(pins, 'c.md', 0))).toEqual(['c.md', 'a.md', 'b.md'])
    expect(paths(movePin(pins, 'a.md', 99))).toEqual(['b.md', 'c.md', 'a.md'])
    expect(movePin(pins, 'a.md', 99).map(pin => pin.order)).toEqual([0, 1, 2])
  })

  it('上移／下移一格；在頭尾時不動；不存在的路徑不動', () => {
    const pins = list('a.md', 'b.md', 'c.md')
    expect(paths(movePinBy(pins, 'b.md', -1))).toEqual(['b.md', 'a.md', 'c.md'])
    expect(paths(movePinBy(pins, 'b.md', 1))).toEqual(['a.md', 'c.md', 'b.md'])
    expect(paths(movePinBy(pins, 'a.md', -1))).toEqual(['a.md', 'b.md', 'c.md'])
    expect(paths(movePinBy(pins, 'x.md', 1))).toEqual(['a.md', 'b.md', 'c.md'])
  })
})

describe('改名／移動跟著走', () => {
  it('檔案改名：路徑換掉，釘選日、最後送出日與順序不變', () => {
    const pins = markPinsSent(list('a.md', 'b.md'), ['a.md'], T + 100)
    const moved = applyPathMove(pins, 'a.md', '專案/新名字.md')
    expect(moved[0]).toEqual({ path: '專案/新名字.md', pinnedAt: T, lastSentAt: T + 100, firstSentAt: T + 100, order: 0 })
    expect(moved[1].path).toBe('b.md')
  })

  it('資料夾移動：底下的釘選全部跟著換，名稱只是前綴相同的不動', () => {
    const pins = list('舊/a.md', '舊/子/b.md', '舊資料夾/c.md', '舊')
    expect(paths(applyPathMove(pins, '舊', '新'))).toEqual(['新/a.md', '新/子/b.md', '舊資料夾/c.md', '新'])
  })

  it('移到已經釘過的路徑（覆蓋）時只留一則', () => {
    expect(paths(applyPathMove(list('a.md', 'b.md'), 'b.md', 'a.md'))).toEqual(['a.md'])
  })

  it('跟釘選無關的改名不改清單', () => {
    const pins = list('a.md')
    expect(applyPathMove(pins, 'z.md', 'y.md')).toEqual(pins)
  })
})

describe('刪除後移除', () => {
  it('刪檔案只移除那一則', () => {
    expect(paths(applyPathDelete(list('a.md', 'a.md.bak', 'b.md'), 'a.md', false))).toEqual(['a.md.bak', 'b.md'])
  })

  it('刪資料夾連同底下全部移除', () => {
    expect(paths(applyPathDelete(list('夾/a.md', '夾/子/b.md', '夾子.md'), '夾', true))).toEqual(['夾子.md'])
  })
})

describe('最後送出日', () => {
  it('只更新送出的那幾則', () => {
    const pins = markPinsSent(list('a.md', 'b.md'), ['b.md'], T + 50)
    expect(pins[0].lastSentAt).toBeUndefined()
    expect(pins[1].lastSentAt).toBe(T + 50)
  })

  it('第一次送出日只記一次，之後送出只更新最後送出日（ALMNC-47）', () => {
    const again = markPinsSent(markPinsSent(list('a.md'), ['a.md'], T + 50), ['a.md'], T + 90)
    expect(again[0]).toMatchObject({ firstSentAt: T + 50, lastSentAt: T + 90 })
    expect(normalizePins(again)[0].firstSentAt).toBe(T + 50)
  })
})

describe('normalizePins（從 store.json 讀回）', () => {
  it('丟掉壞資料與重複路徑，依 order 排好並重新編號', () => {
    expect(normalizePins([
      { path: 'b.md', pinnedAt: 2, order: 5, lastSentAt: 9 },
      { path: 'a.md', pinnedAt: 1, order: 1 },
      { path: 'a.md', pinnedAt: 3, order: 0 },
      { path: '', pinnedAt: 1, order: 2 },
      { path: 'c.md', order: 3 },
      'junk',
    ])).toEqual([
      { path: 'a.md', pinnedAt: 1, order: 0 },
      { path: 'b.md', pinnedAt: 2, lastSentAt: 9, order: 1 },
    ])
    expect(normalizePins(null)).toEqual([])
  })
})

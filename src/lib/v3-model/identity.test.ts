// Fork（almanac ALMNC-69.1）：身分編號格式與撞號重抽（AC#1）。
import { describe, expect, it } from 'vitest'
import { idStamp, isId, newId, parseId, shortCode } from './identity'

/** 依序回傳指定字元在短碼字母表中的位置所對應的亂數。 */
function sequence(codes: string[]) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const values = codes.join('').split('').map(char => (alphabet.indexOf(char) + 0.5) / alphabet.length)
  let i = 0
  return () => values[i++ % values.length]
}

const AT = new Date(Date.UTC(2026, 10, 10, 6, 30, 15))

describe('newId 格式', () => {
  it('類別-YYYYMMDD-HHMMSS-4碼，時間用 UTC', async () => {
    expect(await newId('N', AT, { random: sequence(['B3XR']) })).toBe('N-20261110-063015-B3XR')
  })

  it('台灣時間跨日時仍以 UTC 日期為準', async () => {
    // 台灣 2026-11-11 02:00 = UTC 2026-11-10 18:00
    const at = new Date('2026-11-11T02:00:00+08:00')
    expect(idStamp(at)).toBe('20261110-180000')
  })

  it.each(['S', 'N', 'M', 'C'] as const)('類別 %s', async kind => {
    const id = await newId(kind, AT)
    expect(id).toMatch(new RegExp(`^${kind}-20261110-063015-[A-Z0-9]{4}$`))
    expect(isId(id, kind)).toBe(true)
  })

  it('拒絕未知類別與無效時間', async () => {
    await expect(newId('X' as never, AT)).rejects.toThrow('未知的編號類別')
    await expect(newId('N', new Date('nope'))).rejects.toThrow('編號時間無效')
  })

  it('預設亂數只產生大寫英數', () => {
    for (let i = 0; i < 200; i++) expect(shortCode()).toMatch(/^[A-Z0-9]{4}$/)
  })

  it('亂數剛好接近 1 時不會超出字母表', () => {
    expect(shortCode(() => 0.9999999999)).toBe('9999')
    expect(shortCode(() => 0)).toBe('AAAA')
  })
})

describe('撞號重抽', () => {
  it('撞到既有編號就重抽短碼，時間部分不變', async () => {
    const taken = new Set(['N-20261110-063015-AAAA', 'N-20261110-063015-BBBB'])
    const checked: string[] = []
    const id = await newId('N', AT, {
      random: sequence(['AAAA', 'BBBB', 'K7QF']),
      exists: value => { checked.push(value); return taken.has(value) },
    })
    expect(id).toBe('N-20261110-063015-K7QF')
    expect(checked).toEqual(['N-20261110-063015-AAAA', 'N-20261110-063015-BBBB', 'N-20261110-063015-K7QF'])
  })

  it('exists 可以是非同步（查資料庫）', async () => {
    const id = await newId('M', AT, { random: sequence(['AAAA', 'Z9Z9']), exists: async value => value.endsWith('AAAA') })
    expect(id).toBe('M-20261110-063015-Z9Z9')
  })

  it('連續撞號超過上限就丟錯', async () => {
    await expect(newId('N', AT, { exists: () => true, maxAttempts: 3 })).rejects.toThrow('連續撞號 3 次')
  })
})

describe('isId／parseId', () => {
  it('辨認格式與類別', () => {
    expect(isId('N-20261110-063015-B3XR')).toBe(true)
    expect(isId('N-20261110-063015-B3XR', 'M')).toBe(false)
    expect(isId('src_123')).toBe(false)
    expect(isId('N-20261110-063015-b3xr')).toBe(false)
    expect(isId('S-20261123-011542-K7QF-02')).toBe(false)
    expect(isId(42)).toBe(false)
  })

  it('拆出類別、UTC 時間與短碼；不存在的日期回傳 null', () => {
    expect(parseId('S-20261123-011542-K7QF')).toEqual({ kind: 'S', at: new Date(Date.UTC(2026, 10, 23, 1, 15, 42)), code: 'K7QF' })
    expect(parseId('N-20260230-000000-AAAA')).toBeNull()
    expect(parseId('nope')).toBeNull()
  })
})

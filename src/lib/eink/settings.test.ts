// almanac ALMNC-45：電子紙設定值的正規化、章節勾選、位址與 token。
import { describe, expect, it } from 'vitest'
import {
  BRIEFING_SECTIONS, DEFAULT_EINK_SETTINGS, generateEinkToken, isValidEinkToken, maskEinkToken, normalizeEinkSettings,
  normalizeReaderAddress, normalizeWeatherCity, orderSections, toggleSection,
} from './settings'

describe('normalizeEinkSettings', () => {
  it('沒有存過時用預設值：關閉、區網服務關閉、全部章節', () => {
    expect(normalizeEinkSettings(undefined)).toEqual(DEFAULT_EINK_SETTINGS)
    expect(DEFAULT_EINK_SETTINGS.enabled).toBe(false)
    expect(DEFAULT_EINK_SETTINGS.lanServer).toBe(false)
    expect(DEFAULT_EINK_SETTINGS.sections).toEqual([...BRIEFING_SECTIONS])
  })

  it('讀回存好的值；壞欄位用預設補上，不認得的章節丟掉', () => {
    expect(normalizeEinkSettings({
      enabled: true, readerAddress: ' http://192.168.1.20 ', lanServer: 'yes', sections: ['report', 'bogus', 'schedule', 'report'], weatherCity: ' 臺北 ',
    })).toEqual({ enabled: true, readerAddress: 'http://192.168.1.20', lanServer: false, sections: ['schedule', 'report'], weatherCity: '臺北' })
  })

  it('章節全部取消時保留空陣列（不會被補回預設）', () => {
    expect(normalizeEinkSettings({ sections: [] }).sections).toEqual([])
  })
})

describe('章節勾選', () => {
  it('勾選後仍照今日簡報的固定順序', () => {
    expect(toggleSection(['report'], 'schedule', true)).toEqual(['schedule', 'report'])
    expect(toggleSection(['schedule', 'pinned', 'report'], 'pinned', false)).toEqual(['schedule', 'report'])
    expect(orderSections(['workbench', 'articles', 'articles'])).toEqual(['articles', 'workbench'])
  })
})

describe('normalizeReaderAddress', () => {
  it('補上 http://、去掉結尾斜線；空字串可以存', () => {
    expect(normalizeReaderAddress('192.168.1.20')).toBe('http://192.168.1.20')
    expect(normalizeReaderAddress(' http://x4.local:8080/ ')).toBe('http://x4.local:8080')
    expect(normalizeReaderAddress('')).toBe('')
  })

  it('不合法的位址回傳 null', () => {
    expect(normalizeReaderAddress('ftp://192.168.1.20')).toBeNull()
    expect(normalizeReaderAddress('http://user:pw@192.168.1.20')).toBeNull()
    expect(normalizeReaderAddress('http://192.168.1.20/?token=x')).toBeNull()
    expect(normalizeReaderAddress('http:// bad host')).toBeNull()
  })
})

describe('normalizeWeatherCity', () => {
  it('收掉多餘空白', () => {
    expect(normalizeWeatherCity('  New   York ')).toBe('New York')
    expect(normalizeWeatherCity('臺北市')).toBe('臺北市')
  })
})

describe('token', () => {
  it('產生 48 碼 hex，每次都不同', () => {
    const a = generateEinkToken()
    const b = generateEinkToken()
    expect(a).toMatch(/^[0-9a-f]{48}$/)
    expect(a).not.toBe(b)
    expect(isValidEinkToken(a)).toBe(true)
  })

  it('用注入的亂數來源產生（確認是逐位元組轉 hex）', () => {
    expect(generateEinkToken(bytes => bytes.fill(171))).toBe('ab'.repeat(24))
  })

  it('壞的 token 不算數；顯示時只露出最後 4 碼', () => {
    expect(isValidEinkToken('short')).toBe(false)
    expect(isValidEinkToken(42)).toBe(false)
    expect(maskEinkToken('ab'.repeat(24))).toBe('••••••••abab')
    expect(maskEinkToken('')).toBe('')
  })
})

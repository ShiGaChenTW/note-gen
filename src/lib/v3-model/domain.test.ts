// Fork（almanac ALMNC-54.1）：領域最多兩層（AC5）。
import { describe, expect, it } from 'vitest'
import { assertDomainPlacement, canonicalDomainIds, domainFromRow, domainLookup, domainPath, domainPlacementError, domainRefMatches, unknownDomainIds } from './domain'

const domains = [
  { id: 'eng', name: '工程' },
  { id: 'de', name: '資料工程', parentId: 'eng' },
  { id: 'life', name: '生活' },
]

describe('領域層級（AC5）', () => {
  it('頂層與第二層都合法', () => {
    expect(domainPlacementError(domains, { id: 'new' })).toBeNull()
    expect(domainPlacementError(domains, { id: 'fe', parentId: 'eng' })).toBeNull()
  })

  it('放到第二層底下（第三層）不合法', () => {
    expect(domainPlacementError(domains, { id: 'etl', parentId: 'de' })).toMatch(/2 層/)
    expect(() => assertDomainPlacement(domains, { id: 'etl', parentId: 'de' })).toThrow()
  })

  it('已有下層的領域不能再被放到別人底下', () => {
    expect(domainPlacementError(domains, { id: 'eng', parentId: 'life' })).toMatch(/下層/)
  })

  it('上層不存在或是自己都不合法', () => {
    expect(domainPlacementError(domains, { id: 'x', parentId: 'nope' })).toMatch(/不存在/)
    expect(domainPlacementError(domains, { id: 'life', parentId: 'life' })).toMatch(/自己/)
  })

  it('第二層改掛到另一個頂層合法', () => {
    expect(domainPlacementError(domains, { id: 'de', parentId: 'life' })).toBeNull()
  })
})

describe('領域路徑與筆記歸屬', () => {
  it('顯示「上層 › 下層」', () => {
    expect(domainPath(domains, 'de')).toBe('工程 › 資料工程')
    expect(domainPath(domains, 'eng')).toBe('工程')
    expect(domainPath(domains, 'missing')).toBeUndefined()
  })

  it('一則筆記可屬於多個領域，列出不存在的', () => {
    expect(unknownDomainIds(['de', 'life', 'ghost'], domains)).toEqual(['ghost'])
  })

  it('列對應', () => {
    expect(domainFromRow({ id: 'a', name: 'A', parentId: null, overview: '', createdAt: 1, updatedAt: 2 })).toEqual({
      id: 'a', name: 'A', parentId: undefined, overview: '', createdAt: 1, updatedAt: 2,
    })
  })
})

// Fork（almanac ALMNC-69.4）：筆記 domains 存領域名稱，過渡期也認舊 dom_ id。
describe('筆記 domains 的名稱與舊 id', () => {
  const domains = [{ id: 'dom_a', name: '時間管理' }, { id: 'dom_b', name: '專注力 ' }]

  it('名稱與 id 都對得到同一個領域', () => {
    expect(domainRefMatches('時間管理', domains[0])).toBe(true)
    expect(domainRefMatches('dom_a', domains[0])).toBe(true)
    expect(domainRefMatches('專注力', domains[1])).toBe(true)
    expect(domainRefMatches('dom_b', domains[0])).toBe(false)
    expect(domainRefMatches(' ', domains[0])).toBe(false)
  })

  it('換成領域 id：去重、保留順序、對不到的照原樣', () => {
    const lookup = domainLookup(domains)
    expect(lookup.get('專注力')?.id).toBe('dom_b')
    expect(canonicalDomainIds(['專注力', 'dom_a', '時間管理', '不存在'], lookup)).toEqual(['dom_b', 'dom_a', '不存在'])
  })
})

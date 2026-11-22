import { describe, expect, it } from 'vitest'
import { vaultDisplayName } from './vault-name'

describe('vaultDisplayName', () => {
  it('取筆記庫資料夾名', () => {
    expect(vaultDisplayName('/Users/scott/Documents/Almanac', '我的筆記')).toBe('Almanac')
    expect(vaultDisplayName('/Users/scott/Notes/', '我的筆記')).toBe('Notes')
    expect(vaultDisplayName('C:\\Users\\scott\\Vault\\', '我的筆記')).toBe('Vault')
  })

  it('雲端同步給過名稱時用那個名稱', () => {
    const names = { '/data/workspaces/self-hosted/work--0123abcd': '工作筆記' }
    expect(vaultDisplayName('/data/workspaces/self-hosted/work--0123abcd/', '我的筆記', names)).toBe('工作筆記')
  })

  it('預設工作區或取不到名稱時用備用文字', () => {
    expect(vaultDisplayName('', '我的筆記')).toBe('我的筆記')
    expect(vaultDisplayName('   ', '我的筆記')).toBe('我的筆記')
    expect(vaultDisplayName('/', '我的筆記')).toBe('我的筆記')
    expect(vaultDisplayName('/a/b', '我的筆記', { '/a/b': '  ' })).toBe('b')
  })

  it('切換筆記庫時名稱跟著變', () => {
    expect(vaultDisplayName('/vaults/Work', 'MyVault')).toBe('Work')
    expect(vaultDisplayName('/vaults/Personal', 'MyVault')).toBe('Personal')
  })
})

import { describe, expect, it } from 'vitest'
import { contentVersion, snapshotMismatch, withoutDerivedFields } from './version'

describe('contentVersion', () => {
  it('ignores the domains field rebuilt from MOCs, but not other edits', () => {
    const base = '---\nid: N-20261123-090000-AAAA\ntype: knowledge\n---\n內文\n'
    const withDomains = '---\nid: N-20261123-090000-AAAA\ndomains:\n  - 時間管理\n  - 專注力\ntype: knowledge\n---\n內文\n'
    const inline = '---\nid: N-20261123-090000-AAAA\ntype: knowledge\ndomains: [時間管理]\n---\n內文\n'
    expect(contentVersion(withDomains)).toBe(contentVersion(base))
    expect(contentVersion(inline)).toBe(contentVersion(base))
    expect(contentVersion(base.replace('內文', '改過'))).not.toBe(contentVersion(base))
    expect(contentVersion(base.replace(/\n/g, '\r\n'))).toBe(contentVersion(base))
    expect(contentVersion(null)).toBeNull()
    expect(withoutDerivedFields('沒有 frontmatter\ndomains: x\n')).toBe('沒有 frontmatter\ndomains: x\n')
  })
})

describe('snapshotMismatch', () => {
  it('lists files that do not match the snapshot for the direction', async () => {
    const files: Record<string, string> = { 'a.md': 'after', 'b.md': 'before' }
    const read = async (path: string) => files[path] ?? null
    const changes = [{ path: 'a.md', before: 'before', after: 'after' }, { path: 'b.md', before: 'before', after: null }]
    expect(await snapshotMismatch(changes, read, 'undo')).toEqual(['b.md'])
    expect(await snapshotMismatch(changes, read, 'apply')).toEqual(['a.md'])
    expect(await snapshotMismatch(changes, read, 'recover')).toEqual([])
  })
})

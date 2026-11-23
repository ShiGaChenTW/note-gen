import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseV3Note } from '@/lib/v3-model/note'
import { assignToMocs, entryTargetFor, rebuildFromMocs, removeFromMoc } from './service'
import { createMemoryMocIo } from './testing'
import { formalEntries, parseMoc } from './parse'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.md`), 'utf8')
const note = (domains: string[] = [], extra = '') => `---\ntype: knowledge\n${domains.length ? `domains: [${domains.join(', ')}]\n` : ''}${extra}---\n內文\n`
const domainsOf = (raw: string) => parseV3Note(raw).fields.domains

function vault() {
  return {
    '20 領域/時間管理.md': fixture('時間管理'),
    '20 領域/專注力.md': fixture('專注力'),
    '20 領域/個人效能.md': fixture('個人效能'),
    '10 知識/切換工作的代價比想像中高.md': note(['專注力']),
    '10 知識/時間區塊要留兩成緩衝.md': note(['時間管理', '個人效能']),
    '10 知識/說不比提高效率更省時間.md': note(),
    '10 知識/未歸屬.md': note(),
  } as Record<string, string>
}

describe('rebuildFromMocs', () => {
  it('rebuilds domains from formal entries: keeps order, appends new, drops what the MOCs do not list', async () => {
    const io = createMemoryMocIo(vault())
    const result = await rebuildFromMocs(io)
    // 切換工作：原本只有專注力 → 時間管理接在後面。
    expect(domainsOf(io.files['10 知識/切換工作的代價比想像中高.md'])).toEqual(['專注力', '時間管理'])
    // 個人效能只是分家清單（引用），不算歸屬 → 拿掉。
    expect(domainsOf(io.files['10 知識/時間區塊要留兩成緩衝.md'])).toEqual(['時間管理'])
    expect(domainsOf(io.files['10 知識/說不比提高效率更省時間.md'])).toEqual(['時間管理'])
    expect(domainsOf(io.files['10 知識/未歸屬.md'])).toEqual([])
    expect(result.written.sort()).toEqual(['10 知識/切換工作的代價比想像中高.md', '10 知識/時間區塊要留兩成緩衝.md', '10 知識/說不比提高效率更省時間.md'])
    expect(io.files['20 領域/時間管理.md']).toBe(fixture('時間管理'))
    // 第二次沒有變化就不寫。
    expect((await rebuildFromMocs(io)).written).toEqual([])
  })

  it('a manual frontmatter edit adding a member is undone; reordering by Scott is kept', async () => {
    const files = vault()
    const io = createMemoryMocIo(files)
    await rebuildFromMocs(io)
    files['10 知識/切換工作的代價比想像中高.md'] = note(['時間管理', '專注力', '個人效能'])
    await rebuildFromMocs(io)
    expect(domainsOf(files['10 知識/切換工作的代價比想像中高.md'])).toEqual(['時間管理', '專注力'])
  })

  it('removing the primary entry from a MOC promotes the next domain', async () => {
    const files = vault()
    const io = createMemoryMocIo(files)
    await rebuildFromMocs(io)
    files['20 領域/時間管理.md'] = files['20 領域/時間管理.md'].replace(/^- \[\[切換工作的代價比想像中高\]\].*\n/m, '')
    files['10 知識/切換工作的代價比想像中高.md'] = note(['時間管理', '專注力'])
    await rebuildFromMocs(io)
    expect(domainsOf(files['10 知識/切換工作的代價比想像中高.md'])).toEqual(['專注力'])
  })

  it('over 3 domains: does not write, reports the note', async () => {
    const files = vault()
    for (const name of ['睡眠', '寫作']) files[`20 領域/${name}.md`] = `---\nid: M-20261123-00000${name === '睡眠' ? 1 : 2}-ABCD\nkind: domain\n---\n# ${name}\n\n## ③ 章節\n\n### 尚未分章\n- [[切換工作的代價比想像中高]]\n`
    const io = createMemoryMocIo(files)
    const before = files['10 知識/切換工作的代價比想像中高.md']
    const result = await rebuildFromMocs(io)
    expect(files['10 知識/切換工作的代價比想像中高.md']).toBe(before)
    expect(result.overLimit).toEqual([expect.objectContaining({ path: '10 知識/切換工作的代價比想像中高.md', after: ['專注力', '時間管理', '睡眠', '寫作'] })])
  })

  it('leaves domains of a domain with no MOC file alone (degraded legacy data)', async () => {
    const files = { '10 知識/a.md': note(['dom_legacy', '沒有 MOC']) }
    const io = createMemoryMocIo(files)
    expect((await rebuildFromMocs(io)).written).toEqual([])
  })
})

describe('assignToMocs (write side goes through the MOC)', () => {
  it('writes an entry into 尚未分章 of the MOC, then the rebuild updates domains', async () => {
    const io = createMemoryMocIo(vault(), { domainNames: { dom_t: '時間管理' } })
    const result = await assignToMocs(io, [{ notePath: '10 知識/未歸屬.md', domain: 'dom_t' }])
    expect(result.failed).toEqual([])
    expect(result.mocPaths).toEqual(['20 領域/時間管理.md'])
    const moc = parseMoc(io.files['20 領域/時間管理.md'])
    expect(moc.unsorted?.entries.map(entry => entry.target)).toEqual(['未歸屬'])
    expect(moc.unsorted?.id).toMatch(/^C-/)
    expect(domainsOf(io.files['10 知識/未歸屬.md'])).toEqual(['時間管理'])
    // 復原：MOC 改回原文，domains 跟著重建。
    await result.undo!()
    expect(io.files['20 領域/時間管理.md']).toBe(fixture('時間管理'))
    expect(domainsOf(io.files['10 知識/未歸屬.md'])).toEqual([])
  })

  it('does not add a second entry when the note is already in the MOC', async () => {
    const io = createMemoryMocIo(vault())
    const result = await assignToMocs(io, [{ notePath: '10 知識/說不比提高效率更省時間.md', domain: '時間管理' }])
    expect(result.mocPaths).toEqual([])
    expect(formalEntries(parseMoc(io.files['20 領域/時間管理.md']))).toHaveLength(8)
  })

  it('degrades when there is no MOC file: creates a MOC skeleton (M id, five blocks) and files the note there', async () => {
    const io = createMemoryMocIo(vault())
    const result = await assignToMocs(io, [{ notePath: '10 知識/未歸屬.md', domain: '睡眠' }, { notePath: '10 知識/未歸屬.md', domain: '時間管理' }])
    expect(result.created).toEqual(['20 領域/睡眠.md'])
    const moc = parseMoc(io.files['20 領域/睡眠.md'], '20 領域/睡眠.md')
    expect(moc).toMatchObject({ isMoc: true, name: '睡眠', level: 1 })
    expect(moc.id).toMatch(/^M-/)
    expect(Object.keys(moc.blocks).sort()).toEqual(['chapters', 'conclusions', 'open', 'position', 'start'])
    expect(moc.unsorted?.entries.map(entry => entry.target)).toEqual(['未歸屬'])
    // 依要求的順序：睡眠是主要。
    expect(domainsOf(io.files['10 知識/未歸屬.md'])).toEqual(['睡眠', '時間管理'])
  })

  it('does not resolve unknown old dom_ ids into a MOC', async () => {
    const io = createMemoryMocIo(vault())
    const result = await assignToMocs(io, [{ notePath: '10 知識/未歸屬.md', domain: 'dom_missing' }])
    expect(result.failed).toEqual([{ notePath: '10 知識/未歸屬.md', domain: 'dom_missing' }])
    expect(Object.keys(io.files).filter(path => path.startsWith('20 領域/'))).toHaveLength(3)
  })

  it('uses a path link when another note has the same file name', () => {
    expect(entryTargetFor('a/筆記.md', ['a/筆記.md', 'b/筆記.md'])).toBe('a/筆記')
    expect(entryTargetFor('a/筆記.md', ['a/筆記.md'])).toBe('筆記')
  })
})

describe('removeFromMoc (over-limit card)', () => {
  it('removes the entry from that MOC and rebuilds domains; undo puts it back', async () => {
    const io = createMemoryMocIo(vault())
    await rebuildFromMocs(io)
    const result = await removeFromMoc(io, '10 知識/切換工作的代價比想像中高.md', '專注力')
    expect(result.removed).toBe(true)
    expect(formalEntries(parseMoc(io.files['20 領域/專注力.md']))).toEqual([])
    expect(domainsOf(io.files['10 知識/切換工作的代價比想像中高.md'])).toEqual(['時間管理'])
    await result.undo!()
    expect(io.files['20 領域/專注力.md']).toBe(fixture('專注力'))
    // 復原連筆記 domains 的順序也還原（專注力仍是主要）。
    expect(domainsOf(io.files['10 知識/切換工作的代價比想像中高.md'])).toEqual(['專注力', '時間管理'])
    expect((await removeFromMoc(io, '10 知識/未歸屬.md', '專注力')).removed).toBe(false)
  })
})

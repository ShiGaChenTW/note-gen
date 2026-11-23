import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderMocContent } from '@/lib/migration/domain-moc-migration'
import { addMocEntry, moveMocEntry, removeMocEntry, renderEntryLine, sameTarget } from './edit'
import { formalEntries, parseMoc } from './parse'

const time = readFileSync(join(__dirname, 'fixtures', '時間管理.md'), 'utf8')
const lineDiff = (before: string, after: string) => {
  const a = before.split('\n')
  const b = after.split('\n')
  return { removed: a.filter(line => !b.includes(line)), added: b.filter(line => !a.includes(line)) }
}

describe('renderEntryLine / sameTarget', () => {
  it('renders the formal entry format', () => {
    expect(renderEntryLine({ target: '筆記' })).toBe('- [[筆記]]')
    expect(renderEntryLine({ target: '筆記', relation: '為什麼\n放這裡' })).toBe('- [[筆記]] ── 為什麼 放這裡')
    expect(renderEntryLine({ target: 'a/筆記', alias: '筆記' })).toBe('- [[a/筆記|筆記]]')
  })

  it('matches by exact target, or by file name when one side has no folder', () => {
    expect(sameTarget('筆記', 'k/筆記.md')).toBe(true)
    expect(sameTarget('a/筆記', 'b/筆記')).toBe(false)
    expect(sameTarget('Note', 'note')).toBe(true)
  })
})

describe('addMocEntry', () => {
  it('adds into an existing chapter after its last entry and changes nothing else', () => {
    const result = addMocEntry(time, { target: '新筆記', relation: '補一則', chapter: { id: 'C-20261112-060024-3XSV' } })
    expect(result.changed).toBe(true)
    expect(lineDiff(time, result.content)).toEqual({ removed: [], added: ['- [[新筆記]] ── 補一則'] })
    const lines = result.content.split('\n')
    expect(lines[lines.indexOf('- [[新筆記]] ── 補一則') - 1]).toBe('- [[時間區塊要留兩成緩衝]] ── 支持「計畫的價值在調整」')
  })

  it('creates 尚未分章 at the bottom of the chapter area (with a C id) when missing', () => {
    const result = addMocEntry(time, { target: '新筆記', newChapterId: () => 'C-20261123-010101-NEWC' }, '20 領域/時間管理.md')
    const moc = parseMoc(result.content)
    expect(moc.unsorted).toMatchObject({ id: 'C-20261123-010101-NEWC', entries: [expect.objectContaining({ target: '新筆記', relation: '' })] })
    expect(lineDiff(time, result.content)).toEqual({ removed: [], added: ['### 尚未分章', '<!-- C-20261123-010101-NEWC -->', '- [[新筆記]]'] })
    // 尚未分章在章節區最後、④ 重點結論之前，前後各一行空白。
    expect(result.content).toContain('週五 16:00，半小時\n\n### 尚未分章\n<!-- C-20261123-010101-NEWC -->\n- [[新筆記]]\n\n## ④ 重點結論')
  })

  it('appends to an existing 尚未分章 without a new C id', () => {
    const first = addMocEntry(time, { target: 'A', newChapterId: () => 'C-20261123-010101-NEWC' }).content
    const second = addMocEntry(first, { target: 'B', newChapterId: () => { throw new Error('should not be called') } })
    expect(second.content).toContain('- [[A]]\n- [[B]]\n')
  })

  it('does nothing when the note already has a formal entry in this MOC (one entry per MOC)', () => {
    expect(addMocEntry(time, { target: '說不比提高效率更省時間' })).toEqual({ content: time, changed: false, reason: 'exists' })
    expect(addMocEntry(time, { target: '不存在', chapter: { title: '沒有這章' } }).reason).toBe('no-chapter')
  })

  it('keeps CRLF line endings', () => {
    const crlf = time.replace(/\n/g, '\r\n')
    const result = addMocEntry(crlf, { target: '新筆記', newChapterId: () => 'C-20261123-010101-NEWC' })
    expect(result.content).toContain('### 尚未分章\r\n<!-- C-20261123-010101-NEWC -->\r\n- [[新筆記]]\r\n')
    expect(result.content.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('fills the 69.6 migration skeleton: replaces the "no entries yet" comment with 尚未分章', () => {
    const skeleton = renderMocContent({ name: '睡眠', fileName: '睡眠', mocId: 'M-20261123-000000-SLEP', level: 1, children: [], overview: '', chapterId: '', members: [] }).content
    const result = addMocEntry(skeleton, { target: '睡眠不足會降低判斷力', newChapterId: () => 'C-20261123-000001-SLPC' })
    expect(result.content).not.toContain('還沒有收錄的筆記')
    expect(result.content).toContain('## ③ 章節\n\n### 尚未分章\n<!-- C-20261123-000001-SLPC -->\n- [[睡眠不足會降低判斷力]]\n\n## ④ 重點結論')
  })

  it('adds a ③ 章節 section when the MOC has none', () => {
    const raw = '---\nkind: domain\n---\n# 新\n\n## ① 這個領域在回答什麼\n問題\n\n## ⑤ 待釐清\n- x\n'
    const result = addMocEntry(raw, { target: 'n', newChapterId: () => 'C-20261123-000001-ABCD' })
    expect(result.content).toBe('---\nkind: domain\n---\n# 新\n\n## ① 這個領域在回答什麼\n問題\n\n## ③ 章節\n\n### 尚未分章\n<!-- C-20261123-000001-ABCD -->\n- [[n]]\n\n## ⑤ 待釐清\n- x\n')
    const bare = addMocEntry('---\nkind: domain\n---\n# 新\n', { target: 'n', newChapterId: () => 'C-20261123-000001-ABCD' })
    expect(bare.content).toBe('---\nkind: domain\n---\n# 新\n\n## ③ 章節\n\n### 尚未分章\n<!-- C-20261123-000001-ABCD -->\n- [[n]]\n')
  })
})

describe('removeMocEntry / moveMocEntry', () => {
  it('removes only that line', () => {
    const result = removeMocEntry(time, '時間區塊要留兩成緩衝')
    expect(lineDiff(time, result.content)).toEqual({ removed: ['- [[時間區塊要留兩成緩衝]] ── 支持「計畫的價值在調整」'], added: [] })
    expect(result.removed).toHaveLength(1)
    expect(removeMocEntry(time, '沒有這則').reason).toBe('not-found')
  })

  it('does not touch split-list references in a parent MOC', () => {
    const parent = readFileSync(join(__dirname, 'fixtures', '個人效能.md'), 'utf8')
    expect(removeMocEntry(parent, '時間區塊要留兩成緩衝').changed).toBe(false)
  })

  it('moves a line to another chapter keeping its relation', () => {
    const result = moveMocEntry(time, '說不比提高效率更省時間', { title: '回顧與調整' })
    expect(lineDiff(time, result.content)).toEqual({ removed: [], added: [] })
    const moc = parseMoc(result.content)
    expect(moc.chapters[0].entries.map(entry => entry.target)).not.toContain('說不比提高效率更省時間')
    expect(moc.chapters[3].entries.at(-1)).toMatchObject({ target: '說不比提高效率更省時間', relation: '和下一章互補：先刪，再排' })
    expect(formalEntries(moc)).toHaveLength(8)
  })

  it('moves into 尚未分章 (creating it) and back is a no-op when already there', () => {
    const moved = moveMocEntry(time, '說不比提高效率更省時間', { unsorted: true }, { newChapterId: () => 'C-20261123-010101-NEWC' })
    expect(parseMoc(moved.content).unsorted?.entries[0]).toMatchObject({ target: '說不比提高效率更省時間', relation: '和下一章互補：先刪，再排' })
    expect(moveMocEntry(moved.content, '說不比提高效率更省時間', { unsorted: true }).changed).toBe(false)
    expect(moveMocEntry(time, '沒有', { unsorted: true }).reason).toBe('not-found')
  })
})

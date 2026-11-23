import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blockItems, blockOfHeading, formalEntries, parseEntryLine, parseMoc } from './parse'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.md`), 'utf8')

const MOC = [
  '---',
  'id: M-20261112-060012-VPB3',
  'kind: domain',
  'level: 2',
  'parent: M-20261104-014500-A57V   # 個人效能',
  'owner: Ivy',
  'status: exploring',
  '---',
  '# 時間管理',
  '',
  '## ① 這個領域在回答什麼',
  '「有限的時間怎麼分配？」',
  '',
  '## ③ 章節',
  '',
  '### 決定做什麼',
  '<!-- C-20261112-060020-N9NR -->',
  '- [[時間不能管理，能管理的是注意力]] ── 整個領域的出發點',
  '- [[資料夾/說不比提高效率更省時間|說不]] ── 先刪，再排',
  '',
  '### 什麼時候做',
  '<!-- C-20261112-060024-3XSV -->',
  '- [[把最難的工作放在精神最好的時段]]',
  '- 這行沒有連結',
  '- 參考 [[別的筆記]] ── 連結不在最前面',
  '- [[時間不能管理，能管理的是注意力]] ── 重複了',
  '',
  '### 尚未分章',
  '<!-- C-20261112-060099-ZZZZ -->',
  '- [[每週回顧是讓系統不崩潰的最小動作]]',
  '',
  '## ④ 重點結論',
  '- 先決定不做什麼。（[[說不比提高效率更省時間]]）',
  '',
  '## ⑤ 待釐清',
  '- **未解**：番茄鐘有沒有效？',
  '',
].join('\n')

describe('parseMoc', () => {
  it('reads frontmatter: M id, name from file name, parent M id (comment stripped), level, status and the other fields', () => {
    const moc = parseMoc(MOC, '20 領域/時間管理.md')
    expect(moc).toMatchObject({ id: 'M-20261112-060012-VPB3', name: '時間管理', heading: '時間管理', parent: 'M-20261104-014500-A57V', level: 2, status: 'exploring', isMoc: true })
    expect(moc.frontmatter).toEqual({ owner: 'Ivy' })
  })

  it('finds the five blocks by heading, and chapters with their C ids, entries and relations', () => {
    const moc = parseMoc(MOC, '20 領域/時間管理.md')
    expect(Object.keys(moc.blocks).sort()).toEqual(['chapters', 'conclusions', 'open', 'position'])
    expect(moc.blocks.position?.text).toBe('「有限的時間怎麼分配？」')
    expect(moc.chapters.map(chapter => [chapter.title, chapter.id])).toEqual([
      ['決定做什麼', 'C-20261112-060020-N9NR'],
      ['什麼時候做', 'C-20261112-060024-3XSV'],
    ])
    const [first, second] = moc.chapters[0].entries
    expect(first).toMatchObject({ target: '時間不能管理，能管理的是注意力', relation: '整個領域的出發點', line: 17, reference: false })
    expect(second).toMatchObject({ target: '資料夾/說不比提高效率更省時間', alias: '說不', relation: '先刪，再排' })
  })

  it('reads 尚未分章 as its own group whose entries may have no relation', () => {
    const moc = parseMoc(MOC)
    expect(moc.unsorted).toMatchObject({ title: '尚未分章', id: 'C-20261112-060099-ZZZZ', unsorted: true })
    expect(moc.unsorted?.entries).toEqual([expect.objectContaining({ target: '每週回顧是讓系統不崩潰的最小動作', relation: '' })])
    expect(moc.unsorted?.entries[0].malformed).toBeUndefined()
  })

  it('reports broken lines without throwing: no link, link not first, missing ──, duplicate; a line missing ── still counts', () => {
    const moc = parseMoc(MOC)
    expect(moc.problems.map(problem => [problem.reason, problem.line])).toEqual([
      ['no-relation', 22],
      ['no-link', 23],
      ['link-not-first', 24],
      ['duplicate', 25],
    ])
    const targets = formalEntries(moc).map(({ entry }) => entry.target)
    expect(targets).toEqual(['時間不能管理，能管理的是注意力', '資料夾/說不比提高效率更省時間', '把最難的工作放在精神最好的時段', '每週回顧是讓系統不崩潰的最小動作'])
  })

  it('only counts links in the chapter area: 重點結論、待釐清、從這裡開始 are references', () => {
    const moc = parseMoc(MOC)
    expect(formalEntries(moc).some(({ entry }) => entry.target === '說不比提高效率更省時間')).toBe(false)
  })

  it('reads old headings as aliases (總覽 → ①, 矛盾與未解問題 → ⑤) and never throws on garbage', () => {
    const moc = parseMoc('---\nkind: domain\n---\n# 舊\n\n## 總覽\n內容\n\n## 矛盾與未解問題\n- 一條\n')
    expect(moc.blocks.position).toMatchObject({ heading: '總覽', legacy: true, text: '內容' })
    expect(moc.blocks.open).toMatchObject({ heading: '矛盾與未解問題', legacy: true })
    expect(blockOfHeading('② 從這裡開始')).toEqual({ key: 'start', legacy: false })
    expect(blockOfHeading('其他')).toBeNull()
    const broken = parseMoc('---\nkind: [domain\n---\n## ③ 章節\n- [[x]] ── y\n')
    expect(broken.problems.map(problem => problem.reason)).toEqual(['frontmatter', 'outside-chapter'])
    expect(broken.isMoc).toBe(false)
    expect(() => parseMoc('')).not.toThrow()
  })

  it('handles CRLF and ignores code fences', () => {
    const moc = parseMoc(MOC.replace(/\n/g, '\r\n'))
    expect(moc.eol).toBe('\r\n')
    expect(moc.chapters[0].entries[0].relation).toBe('整個領域的出發點')
    const fenced = parseMoc('## ③ 章節\n### A\n```\n- [[不是收錄]] ── x\n```\n- [[是收錄]] ── y\n')
    expect(formalEntries(fenced).map(({ entry }) => entry.target)).toEqual(['是收錄'])
  })

  it('parseEntryLine: separator must be ──; unsorted lines may omit it', () => {
    expect(parseEntryLine('- [[a]] ── b', true).entry?.relation).toBe('b')
    expect(parseEntryLine('- [[a]] - b', true).problem).toBe('no-relation')
    expect(parseEntryLine('- [[a]]', false).problem).toBeUndefined()
    expect(parseEntryLine('不是清單', true)).toEqual({})
  })
})

describe('parseMoc on the example vault MOCs', () => {
  it('時間管理: four chapters, eight formal entries, all five blocks', () => {
    const moc = parseMoc(fixture('時間管理'), '20 領域/時間管理.md')
    expect(moc.id).toBe('M-20261112-060012-VPB3')
    expect(moc.parent).toBe('M-20261104-014500-A57V')
    expect(moc.frontmatter).toMatchObject({ owner: 'Ivy · 時間管理專家' })
    expect(Object.keys(moc.blocks).sort()).toEqual(['chapters', 'conclusions', 'open', 'position', 'start'])
    expect(moc.chapters.map(chapter => chapter.title)).toEqual(['決定做什麼', '什麼時候做', '怎麼保持專注', '回顧與調整'])
    expect(moc.chapters.every(chapter => chapter.id?.startsWith('C-'))).toBe(true)
    expect(moc.unsorted).toBeNull()
    expect(formalEntries(moc)).toHaveLength(8)
    expect(moc.problems).toEqual([])
    const focus = moc.chapters[2].entries[0]
    expect(focus).toMatchObject({ target: '切換工作的代價比想像中高', relation: '也屬於 [[專注力]]；被打斷一次的代價遠大於那幾秒' })
    expect(blockItems(moc.blocks.conclusions!.text)).toHaveLength(3)
  })

  it('專注力: one chapter, one entry', () => {
    const moc = parseMoc(fixture('專注力'), '20 領域/專注力.md')
    expect(moc.level).toBe(2)
    expect(formalEntries(moc).map(({ entry }) => entry.target)).toEqual(['切換工作的代價比想像中高'])
    expect(moc.problems).toEqual([])
  })

  it('個人效能: grown chapters are split lists — references, not memberships, and their notes are not problems', () => {
    const moc = parseMoc(fixture('個人效能'), '20 領域/個人效能.md')
    expect(moc.chapters.map(chapter => [chapter.title, chapter.grownInto])).toEqual([['時間管理', '時間管理'], ['專注力', '專注力']])
    expect(moc.chapters[0].entries.map(entry => [entry.mocMarker, entry.reference])).toEqual([['時間管理', true], ['時間管理', true], ['時間管理', true]])
    expect(formalEntries(moc)).toEqual([])
    expect(moc.problems).toEqual([])
  })
})

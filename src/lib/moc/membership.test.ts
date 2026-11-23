import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_DOMAINS, membershipsFromMocs, planDomainRebuild, rebuildDomains } from './membership'
import { parseMoc } from './parse'

const fixture = (name: string) => parseMoc(readFileSync(join(__dirname, 'fixtures', `${name}.md`), 'utf8'), `20 領域/${name}.md`)

describe('rebuildDomains', () => {
  it('keeps the existing order Scott set', () => {
    expect(rebuildDomains(['專注力', '時間管理'], ['時間管理', '專注力'])).toEqual({ domains: ['專注力', '時間管理'], overLimit: false, added: [], removed: [] })
  })

  it('appends new memberships after the existing ones', () => {
    expect(rebuildDomains(['時間管理'], ['睡眠', '時間管理', '專注力']).domains).toEqual(['時間管理', '睡眠', '專注力'])
    expect(rebuildDomains([], ['睡眠', '專注力']).domains).toEqual(['睡眠', '專注力'])
  })

  it('drops removed memberships; when the primary is removed the next one takes over', () => {
    const result = rebuildDomains(['時間管理', '專注力', '睡眠'], ['睡眠', '專注力'])
    expect(result.domains).toEqual(['專注力', '睡眠'])
    expect(result.domains[0]).toBe('專注力')
    expect(result.removed).toEqual(['時間管理'])
    expect(rebuildDomains(['時間管理'], []).domains).toEqual([])
  })

  it('reports overLimit above 3 without cutting anything', () => {
    expect(MAX_DOMAINS).toBe(3)
    const result = rebuildDomains(['a', 'b', 'c'], ['a', 'b', 'c', 'd'])
    expect(result).toEqual({ domains: ['a', 'b', 'c', 'd'], overLimit: true, added: ['d'], removed: [] })
    expect(rebuildDomains(['a', 'b'], ['a', 'b', 'c']).overLimit).toBe(false)
  })

  it('ignores duplicates and blanks', () => {
    expect(rebuildDomains(['a', 'a', ' '], ['a', 'b', 'b']).domains).toEqual(['a', 'b'])
  })
})

describe('membershipsFromMocs', () => {
  it('maps the example vault: 切換工作 is in 時間管理 and 專注力; the 個人效能 split list does not count', () => {
    const { byNote, unresolved, duplicateNames } = membershipsFromMocs([fixture('個人效能'), fixture('時間管理'), fixture('專注力')])
    expect(byNote.get('切換工作的代價比想像中高')).toEqual(['時間管理', '專注力'])
    expect(byNote.get('時間區塊要留兩成緩衝')).toEqual(['時間管理'])
    expect([...byNote.values()].flat()).not.toContain('個人效能')
    expect(byNote.size).toBe(8)
    expect(unresolved).toEqual([])
    expect(duplicateNames).toEqual([])
  })

  it('resolves targets to note paths and lists broken links', () => {
    const moc = parseMoc('---\nkind: domain\n---\n## ③ 章節\n### 尚未分章\n- [[有]]\n- [[沒有]]\n', '20 領域/X.md')
    const result = membershipsFromMocs([moc], target => (target === '有' ? 'k/有.md' : null))
    expect([...result.byNote]).toEqual([['k/有.md', ['X']]])
    expect(result.unresolved).toEqual([{ moc: '20 領域/X.md', target: '沒有', line: 6 }])
  })
})

describe('planDomainRebuild', () => {
  const managed = new Set(['時間管理', '專注力', '睡眠', '寫作'])

  it('writes only notes whose domains change; members come from MOCs, order from the note', () => {
    const byNote = new Map([['a.md', ['時間管理', '專注力']], ['b.md', ['專注力']]])
    const plan = planDomainRebuild([
      { path: 'a.md', domains: ['專注力', '時間管理'] },
      { path: 'b.md', domains: ['時間管理', '專注力'] },
      { path: 'c.md', domains: [] },
    ], byNote, { managed })
    expect(plan.changes).toEqual([{ path: 'b.md', before: ['時間管理', '專注力'], after: ['專注力'], added: [], removed: ['時間管理'] }])
    expect(plan.overLimit).toEqual([])
  })

  it('manual edits to members do not count: a name with a MOC but no entry is removed', () => {
    const plan = planDomainRebuild([{ path: 'a.md', domains: ['睡眠'] }], new Map(), { managed })
    expect(plan.changes[0].after).toEqual([])
  })

  it('degrades safely: names without a MOC file stay where they are', () => {
    const plan = planDomainRebuild([{ path: 'a.md', domains: ['還沒遷移的領域', '睡眠'] }], new Map([['a.md', ['時間管理']]]), { managed })
    expect(plan.changes[0].after).toEqual(['還沒遷移的領域', '時間管理'])
  })

  it('rewrites old dom_ ids to names only when that domain has a MOC', () => {
    const aliases = new Map([['dom_1', '時間管理'], ['dom_2', '沒有 MOC']])
    const plan = planDomainRebuild([{ path: 'a.md', domains: ['dom_1', 'dom_2'] }], new Map([['a.md', ['時間管理']]]), { managed, aliases })
    expect(plan.changes[0].after).toEqual(['時間管理', 'dom_2'])
  })

  it('follows the order hint for newly added domains (first becomes primary)', () => {
    const plan = planDomainRebuild([{ path: 'n.md', domains: [] }], new Map([['n.md', ['時間管理', '睡眠']]]), { managed, orderHint: new Map([['n.md', ['睡眠', '時間管理']]]) })
    expect(plan.changes[0].after).toEqual(['睡眠', '時間管理'])
  })

  it('does not write notes over the limit; reports them with every membership', () => {
    const plan = planDomainRebuild([{ path: 'a.md', domains: ['時間管理', '專注力', '睡眠'] }], new Map([['a.md', ['時間管理', '專注力', '睡眠', '寫作']]]), { managed })
    expect(plan.changes).toEqual([])
    expect(plan.overLimit).toEqual([{ path: 'a.md', before: ['時間管理', '專注力', '睡眠'], after: ['時間管理', '專注力', '睡眠', '寫作'], added: ['寫作'], removed: [] }])
  })
})

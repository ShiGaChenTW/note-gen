// Fork（almanac ALMNC-54.12）：指揮官依衝突類型做清理提案——類型 → 處理方式、同領域打包、立刻提出 vs 等每週回顧、不偷偷覆寫。
import { describe, expect, it } from 'vitest'
import { createV3Note, parseV3Note } from '@/lib/v3-model/note'
import { appendToSection, cleanupProposals, confirmProposal, isImmediate, planAction, routeObservations, type CleanupLabels } from './plan'
import type { ConflictObservation } from './types'

const labels: CleanupLabels = {
  action: action => ({ modify: '修改', replace: '取代', verify: '待查證', supplement: '補情境', merge: '合併', archive: '封存' })[action],
  bundleTitle: ({ domain, count }) => `整理「${domain}」：${count} 項`,
  singleTitle: ({ action, title }) => `${action}：${title}`,
  item: ({ action, titles, evidence }) => `- ${action}：${titles}——${evidence}`,
  origin: ({ agent }) => `${agent} 整理的清理提案`,
  confirmTitle: ({ title }) => `仍然有效：${title}`,
  confirmBody: ({ evidence }) => `沒問題（${evidence}）`,
}

const note = (title: string, body: string, extra: Record<string, unknown> = {}) => createV3Note({
  title, type: 'knowledge', domains: ['ie'], status: 'valid', sources: [`src_${title}`], lastConfirmed: '2026-01-01', ...extra,
}, `${body}\n`)

const notes = new Map([
  ['k/a.md', note('A', '節拍時間是 60 秒。')],
  ['k/b.md', note('B', '節拍時間是 45 秒。')],
  ['k/c.md', note('C', '產線平衡率 = 總作業時間 ÷ (工站數 × 節拍)。')],
  ['k/d.md', note('D', '產線平衡率的定義同 C。', { sources: ['src_x', 'src_y'] })],
])
const domains = new Map([['ie', { id: 'ie', name: '工業工程', overview: '# 工業工程\n\n## 總覽\n\n生產系統。\n' }]])
const ctx = { notes, domains, today: '2026-11-21', labels, immediate: true }
const obs = (type: ConflictObservation['type'], notePaths: string[], extra: Partial<ConflictObservation> = {}): ConflictObservation => ({
  type, notePaths, evidence: `${type} 的證據`, trigger: 'written', domainId: 'ie', ...extra,
})

describe('planAction', () => {
  it('maps each conflict type to the cleanup action in the spec', () => {
    expect(planAction({ type: 'outdated', conclusionChanged: false })).toBe('modify')
    expect(planAction({ type: 'outdated', conclusionChanged: true })).toBe('replace')
    expect(planAction({ type: 'contradiction' })).toBe('verify')
    expect(planAction({ type: 'context' })).toBe('supplement')
    expect(planAction({ type: 'duplicate' })).toBe('merge')
    expect(planAction({ type: 'obsolete' })).toBe('archive')
  })

  it('sends conflicts and errors immediately and defers the rest to the weekly bundle', () => {
    expect(isImmediate({ type: 'contradiction' })).toBe(true)
    expect(isImmediate({ type: 'outdated' })).toBe(true)
    const routed = routeObservations([obs('duplicate', ['k/c.md', 'k/d.md']), obs('contradiction', ['k/a.md', 'k/b.md']), obs('context', ['k/a.md', 'k/b.md']), obs('obsolete', ['k/a.md'])])
    expect(routed.immediate.map(entry => entry.type)).toEqual(['contradiction'])
    expect(routed.deferred.map(entry => entry.type)).toEqual(['duplicate', 'context', 'obsolete'])
  })
})

describe('cleanupProposals', () => {
  const single = (observation: ConflictObservation) => {
    const [proposal] = cleanupProposals([observation], ctx)
    return { proposal, after: new Map(proposal.edits!.map(edit => [edit.path, edit.content])) }
  }

  it('modify: changes only facts and keeps a revision log with the old body', () => {
    const { proposal, after } = single(obs('outdated', ['k/a.md', 'k/b.md'], { conclusionChanged: false, revisedBody: '節拍時間是 45 秒。' }))
    expect(proposal.card).toEqual({ label: 'note', verb: 'modify' })
    expect(proposal.title).toBe('修改：A')
    const parsed = parseV3Note(after.get('k/a.md')!)
    expect(parsed.body).toContain('節拍時間是 45 秒。')
    expect(parsed.body).toContain('## 修改紀錄\n\n- 2026-11-21：修改：outdated 的證據（依據 [[k/b]]）')
    expect(parsed.body).toContain('> 節拍時間是 60 秒。')
    expect(parsed.fields.lastConfirmed).toBe('2026-11-21')
    expect(proposal.edits![0].baseContent).toBe(notes.get('k/a.md'))
  })

  it('replace: the old note is marked superseded and linked to the newer one', () => {
    const { proposal, after } = single(obs('outdated', ['k/a.md', 'k/b.md'], { conclusionChanged: true }))
    expect(proposal.card?.verb).toBe('replace')
    const old = parseV3Note(after.get('k/a.md')!)
    expect(old.fields.status).toBe('superseded')
    expect(old.fields.related).toContain('[[k/b]]')
    expect(old.body).toContain('節拍時間是 60 秒。')
    expect(parseV3Note(after.get('k/b.md')!).fields.related).toContain('[[k/a]]')
    // ALMNC-69.7：新筆記承接舊筆記的 MOC 收錄（接受時寫 MOC），不改任何筆記的 frontmatter domains。
    expect(proposal.membershipTransfers).toEqual([{ from: 'k/a.md', to: 'k/b.md' }])
    expect(parseV3Note(after.get('k/b.md')!).fields.domains).toEqual(['ie'])
  })

  it('replace without a newer note creates one from the revised body', () => {
    const { after, proposal } = single(obs('outdated', ['k/a.md'], { conclusionChanged: true, revisedBody: '節拍時間改由需求決定。', externalUrls: ['https://example.com'] }))
    const created = proposal.edits!.find(edit => edit.baseContent === null)!
    expect(created.path).toBe('k/A（2026-11-21 更新）.md')
    expect(parseV3Note(created.content).fields).toMatchObject({ status: 'valid', sources: ['src_A'], related: ['[[k/a]]'], lastConfirmed: '2026-11-21' })
    expect(parseV3Note(after.get('k/a.md')!).fields.status).toBe('superseded')
    expect(proposal.body).toContain('https://example.com')
    // ALMNC-69.7：新筆記不寫 domains（不當權威），由承接 MOC 收錄後重建。
    expect(parseV3Note(created.content).fields.domains).toEqual([])
    expect(proposal.membershipTransfers).toEqual([{ from: 'k/a.md', to: created.path }])
  })

  it('replace with nothing to replace falls back to needs-verification instead of overwriting', () => {
    const { proposal, after } = single(obs('outdated', ['k/a.md'], { conclusionChanged: true }))
    expect(proposal.card?.verb).toBe('verify')
    expect(parseV3Note(after.get('k/a.md')!).fields.status).toBe('disputed')
    expect(proposal.membershipTransfers).toBeUndefined()
  })

  it('verify: marks both notes disputed and lists the issue in the domain', () => {
    const { proposal, after } = single(obs('contradiction', ['k/a.md', 'k/b.md']))
    expect(proposal.card).toEqual({ label: 'note', verb: 'verify' })
    expect(parseV3Note(after.get('k/a.md')!).fields.status).toBe('disputed')
    expect(parseV3Note(after.get('k/b.md')!).fields.status).toBe('disputed')
    expect(proposal.domainEdits).toEqual([{
      domainId: 'ie', summary: '工業工程', baseOverview: domains.get('ie')!.overview,
      overview: '# 工業工程\n\n## 總覽\n\n生產系統。\n\n## 矛盾與未解問題\n\n- [[k/a]] ↔ [[k/b]]：contradiction 的證據\n',
    }])
  })

  it('supplement: keeps both notes and adds each one its own conditions', () => {
    const { proposal, after } = single(obs('context', ['k/a.md', 'k/b.md'], { contexts: { 'k/a.md': '單班制', 'k/b.md': '兩班制' } }))
    expect(proposal.card?.verb).toBe('supplement')
    expect(parseV3Note(after.get('k/a.md')!).body).toContain('## 適用情境\n\n- 單班制')
    expect(parseV3Note(after.get('k/b.md')!).body).toContain('## 適用情境\n\n- 兩班制')
    expect(parseV3Note(after.get('k/a.md')!).fields.status).toBe('valid')
  })

  it('merge: combines into the first note, keeps every source and archives the other', () => {
    const { proposal, after } = single(obs('duplicate', ['k/c.md', 'k/d.md']))
    expect(proposal.card?.verb).toBe('merge')
    const keeper = parseV3Note(after.get('k/c.md')!)
    expect(keeper.fields.sources).toEqual(['src_C', 'src_x', 'src_y'])
    expect(keeper.body).toContain('## 合併自 [[k/d]]\n\n產線平衡率的定義同 C。')
    const other = parseV3Note(after.get('k/d.md')!)
    expect(other.fields.status).toBe('archived')
    expect(other.fields.related).toContain('[[k/c]]')
    expect(other.body).toContain('產線平衡率的定義同 C。')
    // ALMNC-69.7：留下的那則承接被合併那則的 MOC 收錄；frontmatter domains 不由合併寫入。
    expect(proposal.membershipTransfers).toEqual([{ from: 'k/d.md', to: 'k/c.md' }])
    expect(keeper.fields.domains).toEqual(parseV3Note(notes.get('k/c.md')!).fields.domains)
  })

  it('archive: only changes the status and logs why', () => {
    const { proposal, after } = single(obs('obsolete', ['k/c.md']))
    expect(proposal.card?.verb).toBe('archive')
    const parsed = parseV3Note(after.get('k/c.md')!)
    expect(parsed.fields.status).toBe('archived')
    expect(parsed.body).toContain('產線平衡率 = 總作業時間')
    expect(parsed.body).toContain('封存：obsolete 的證據')
  })

  it('bundles one domain into one 知識／整理 proposal and splits different domains', () => {
    const mixed = cleanupProposals([
      obs('context', ['k/a.md', 'k/b.md']),
      obs('duplicate', ['k/c.md', 'k/d.md']),
      obs('obsolete', ['k/a.md']),
      obs('obsolete', ['k/x.md'], { domainId: 'other' }),
      obs('obsolete', ['k/missing.md'], { domainId: 'gone' }),
    ], { ...ctx, notes: new Map([...notes, ['k/x.md', note('X', '別的領域', { domains: ['other'] })]]), immediate: false })
    expect(mixed).toHaveLength(2)
    const [ie, other] = mixed
    expect(ie).toMatchObject({ title: '整理「工業工程」：3 項', card: { label: 'knowledge', verb: 'organize' }, cleanup: { domainId: 'ie', actions: ['supplement', 'merge', 'archive'], immediate: false } })
    // 同一則筆記被兩個觀察碰到：只有一筆變更，內容疊在一起，base 是原文。
    const a = ie.edits!.filter(edit => edit.path === 'k/a.md')
    expect(a).toHaveLength(1)
    expect(a[0].baseContent).toBe(notes.get('k/a.md'))
    expect(parseV3Note(a[0].content).fields.status).toBe('archived')
    expect(parseV3Note(a[0].content).body).toContain('## 適用情境')
    expect(other.cleanup?.domainId).toBe('other')
  })

  it('makes a still-valid proposal that only moves the last confirmed date', () => {
    const proposal = confirmProposal('k/a.md', notes.get('k/a.md')!, { today: '2026-11-21', labels, evidence: 'https://example.com' })
    expect(proposal).toMatchObject({ title: '仍然有效：A', card: { label: 'note', verb: 'confirm' } })
    expect(parseV3Note(proposal.edits![0].content).fields.lastConfirmed).toBe('2026-11-21')
    expect(parseV3Note(proposal.edits![0].content).body).toBe(parseV3Note(notes.get('k/a.md')!).body)
  })
})

describe('appendToSection', () => {
  it('appends inside an existing section, before the next heading', () => {
    expect(appendToSection('# T\n\n## 修改紀錄\n\n- 舊\n\n## 其他\n\n內容\n', '修改紀錄', '- 新')).toBe('# T\n\n## 修改紀錄\n\n- 舊\n- 新\n\n## 其他\n\n內容\n')
    expect(appendToSection('', '修改紀錄', '- 新')).toBe('## 修改紀錄\n\n- 新\n')
  })
})

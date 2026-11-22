// Fork（almanac ALMNC-54.13）：G1 研究員調研、G2 專家回顧、G3 秘書回顧行動、記憶稽核——都用假模型。
import { describe, expect, it, vi } from 'vitest'
import type { TaskRef } from '@/lib/vault-index/index-core'
import { computeActionStats, narrateActions, rescheduleLine, scheduleProposals, suggestReschedules } from './action-review'
import { auditMemory, auditProposals } from './audit'
import { parseExpertReview, reviewDomain } from './expert-review'
import { researchDomains, type DomainDigest } from './research'

const digest: DomainDigest = {
  domainId: 'ie', name: '工業工程',
  notes: [
    { path: 'k/takt.md', title: '節拍時間 60 秒', lastConfirmed: '2025-01-01' },
    { path: 'k/balance.md', title: '產線平衡率', summary: '總作業時間 ÷ (工站數 × 節拍)' },
  ],
}

describe('G1 researcher', () => {
  it('derives questions from the domain, looks them up and summarises the results for the commander', async () => {
    const ask = vi.fn(async (prompt: string) => prompt.includes('research questions')
      ? '{"questions":[{"question":"節拍時間 最新標準","notes":[0]},{"question":"產線平衡率 定義","notes":[1]}]}'
      : '{"findings":[{"index":0,"summary":"新標準建議依需求計算節拍。"}]}')
    const lookup = vi.fn(async (query: string) => query.startsWith('節拍') ? [{ title: '標準', url: 'https://example.com/takt', snippet: '依需求' }] : [])
    const findings = await researchDomains([digest], { ask, lookup, prompt: '# 研究員' })
    expect(ask.mock.calls[0][0].startsWith('# 研究員')).toBe(true)
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(findings).toEqual([
      { domainId: 'ie', question: '節拍時間 最新標準', status: 'found', summary: '新標準建議依需求計算節拍。', sources: [{ title: '標準', url: 'https://example.com/takt' }], notePaths: ['k/takt.md'] },
      { domainId: 'ie', question: '產線平衡率 定義', status: 'nothing', summary: '', sources: [], notePaths: ['k/balance.md'] },
    ])
  })

  it('still lists the questions when no lookup tool is available, and skips empty domains', async () => {
    const ask = vi.fn(async () => '{"questions":["節拍時間 最新標準"]}')
    const findings = await researchDomains([digest, { domainId: 'empty', name: '空', notes: [] }], { ask })
    expect(findings).toEqual([{ domainId: 'ie', question: '節拍時間 最新標準', status: 'unavailable', summary: '', sources: [], notePaths: [] }])
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('marks failed lookups and survives a broken model', async () => {
    const ask = vi.fn(async () => '{"questions":[{"question":"q1"}]}')
    expect((await researchDomains([digest], { ask, lookup: async () => { throw new Error('offline') } }))[0].status).toBe('failed')
    expect(await researchDomains([digest], { ask: async () => { throw new Error('down') } })).toEqual([])
  })
})

describe('G2 expert review', () => {
  it('splits observations for the weekly review from conflicts for the cleanup flow', () => {
    const review = parseExpertReview(JSON.stringify({
      observations: [{ kind: 'gap', text: '缺少換線時間的筆記', notes: [] }, { kind: 'weird', text: '總覽該重寫', notes: [1] }, { kind: 'gap', text: '' }],
      conflicts: [
        { type: 'duplicate', notes: [0, 1], evidence: '同一件事' },
        { type: 'obsolete', notes: [0], evidence: '已不用' },
        { type: 'contradiction', notes: [0], evidence: '只有一則' },
        { type: 'nope', notes: [0, 1], evidence: 'x' },
      ],
    }), digest, 'exp_ie')
    expect(review.observations).toEqual([
      { kind: 'gap', text: '缺少換線時間的筆記', notePaths: [] },
      { kind: 'other', text: '總覽該重寫', notePaths: ['k/balance.md'] },
    ])
    expect(review.conflicts).toEqual([
      { type: 'duplicate', notePaths: ['k/takt.md', 'k/balance.md'], evidence: '同一件事', domainId: 'ie', trigger: 'review', by: { role: 'expert', agentId: 'exp_ie' } },
      { type: 'obsolete', notePaths: ['k/takt.md'], evidence: '已不用', domainId: 'ie', trigger: 'review', by: { role: 'expert', agentId: 'exp_ie' } },
    ])
  })

  it('returns an empty review when the model fails', async () => {
    expect(await reviewDomain(digest, { ask: async () => { throw new Error('down') }, agentId: 'exp_ie' })).toEqual({ domainId: 'ie', agentId: 'exp_ie', observations: [], conflicts: [] })
  })
})

const task = (title: string, extra: Partial<TaskRef> = {}): TaskRef => ({
  path: 'daily/2026-11-10.md', line: 2, title, due: '', time: '', done: false, raw: `- [ ] ${title}`, recurrence: '', priority: 'mid', ...extra,
})

describe('G3 secretary action review', () => {
  const range = { start: new Date(2026, 10, 16), end: new Date(2026, 10, 22, 20) }
  const tasks = [
    task('寄報價', { due: '2026-11-05', raw: '- [ ] 寄報價 📅 2026-11-05' }),
    task('回信', { due: '2026-11-20', line: 3, raw: '- [ ] 回信 📅 2026-11-20' }),
    task('寫週報', { done: true, raw: '- [x] 寫週報 ✅ 2026-11-18' }),
    task('上週做完', { done: true, raw: '- [x] 上週做完 ✅ 2026-11-10' }),
  ]
  const hour = (d: number, h: number) => new Date(2026, 10, d, h).getTime()
  const events = [
    { id: '1', title: '週會', start: hour(17, 9), end: hour(17, 11), allDay: false, calendar: '工作' },
    { id: '2', title: '健身', start: hour(18, 18), end: hour(18, 19), allDay: false, calendar: '個人' },
    { id: '3', title: '假日', start: hour(19, 0), end: hour(20, 0), allDay: true, calendar: '個人' },
  ]

  it('counts completed, overdue and procrastinated tasks and where the time went', () => {
    const stats = computeActionStats({ tasks, events, range, today: '2026-11-22' })
    expect(stats.completed.map(entry => entry.title)).toEqual(['寫週報'])
    expect(stats.overdue.map(entry => entry.title)).toEqual(['寄報價', '回信'])
    expect(stats.procrastinated.map(entry => entry.title)).toEqual(['寄報價'])
    expect(stats.time).toEqual([{ key: '工作', minutes: 120 }, { key: '個人', minutes: 60 }])
  })

  it('suggests rescheduling slipping tasks onto lighter weekdays as E4 proposals', async () => {
    const stats = computeActionStats({ tasks, range, today: '2026-11-22' })
    const suggestions = suggestReschedules(stats, [...tasks, task('週一已滿', { due: '2026-11-23' })], '2026-11-22')
    expect(suggestions).toEqual([{ task: tasks[0], due: '2026-11-24' }])
    const file = '# 11/10\n\n- [ ] 寄報價 📅 2026-11-05\n- [ ] 回信 📅 2026-11-20\n'
    const labels = { title: ({ task: name, from, to }: { task: string, from: string, to: string }) => `改時間：${name}（${from} → ${to}）`, body: ({ days }: { days: number }) => `逾期 ${days} 天` }
    const [proposal] = await scheduleProposals(suggestions, { readNote: async () => file, labels, today: '2026-11-22' })
    expect(proposal).toMatchObject({ kind: 'task', title: '改時間：寄報價（2026-11-05 → 2026-11-24）', body: '逾期 17 天', card: { label: 'schedule', verb: 'reschedule' } })
    expect(proposal.edits![0].content).toContain('- [ ] 寄報價 📅 2026-11-24\n- [ ] 回信 📅 2026-11-20')
    // 那一行在提案前被改過就不提。
    expect(await scheduleProposals(suggestions, { readNote: async () => file.replace('寄報價', '寄報價單'), labels, today: '2026-11-22' })).toEqual([])
  })

  it('rewrites the due date in either format', () => {
    expect(rescheduleLine('- [ ] a due:: 2026-01-01', '2026-02-02')).toBe('- [ ] a due:: 2026-02-02')
    expect(rescheduleLine('- [ ] a ', '2026-02-02')).toBe('- [ ] a 📅 2026-02-02')
  })

  it('lets the secretary narrate, falling back to nothing', async () => {
    const stats = computeActionStats({ tasks, range, today: '2026-11-22' })
    expect(await narrateActions(stats, { ask: async () => '這週完成週報，報價一直拖。' })).toBe('這週完成週報，報價一直拖。')
    expect(await narrateActions(stats, { ask: async () => { throw new Error('down') } })).toBe('')
  })
})

describe('memory audit（防止違規 #3）', () => {
  const notes = [
    { path: 'k/takt.md', title: '節拍時間', body: '節拍時間等於每日可用生產時間除以每日顧客需求量，用來決定產線速度。' },
    { path: 'p/alpha.md', title: '專案 Alpha', body: '目標是降低換線時間。' },
  ]
  const expert = { id: 'exp_ie', name: 'Alex', role: 'expert' as const, domain: '工業工程' }
  const secretary = { id: 'sec', name: 'Leo', role: 'secretary' as const }
  const workNotes = [
    { agent: secretary, content: '- Scott 早上不排會\n- 節拍時間等於每日可用生產時間除以每日顧客需求量' },
    { agent: expert, content: '# 工作筆記\n- Scott 喜歡附來源\n- 節拍時間等於每日可用生產時間除以每日顧客需求量，用來決定產線速度' },
  ]
  const context = { projects: [{ title: '專案 Alpha', link: '[[p/alpha]]' }], weeklyFocus: [{ title: '每日可用生產時間除以每日顧客需求量' }], people: ['A'] }

  it('flags memory lines that copy note content, experts first, but allows titles and short how-to lines', () => {
    const findings = auditMemory({ workNotes, context, activity: [{ id: 7, note: '節拍時間等於每日可用生產時間除以每日顧客需求量' }, { id: 8, note: '提案已送出' }] }, notes)
    expect(findings.map(finding => [finding.memory, finding.ref])).toEqual([
      ['work_notes', 'exp_ie'], ['work_notes', 'sec'], ['context', 'weeklyFocus'], ['activity', '7'],
    ])
    expect(findings.every(finding => finding.notePath === 'k/takt.md')).toBe(true)
  })

  it('proposes removing the overlapping lines; activity log entries are only reported', () => {
    const findings = auditMemory({ workNotes, context, activity: [{ id: 7, note: '節拍時間等於每日可用生產時間除以每日顧客需求量' }] }, notes)
    const labels = { workNotesTitle: ({ agent, count }: { agent: string, count: number }) => `整理 ${agent}：${count}`, contextTitle: ({ count }: { count: number }) => `脈絡：${count}`, line: ({ text, note }: { text: string, note: string }) => `- ${text} → ${note}` }
    const proposals = auditProposals(findings, { workNotes, context }, labels)
    expect(proposals.map(proposal => proposal.title)).toEqual(['整理 Leo：1', '整理 Alex：1', '脈絡：1'])
    const [leo, alex, ctx] = proposals
    expect(leo.memoryEdits).toEqual([{ target: 'work_notes', agent: secretary, baseContent: workNotes[0].content, content: '- Scott 早上不排會', summary: 'Leo' }])
    expect(alex.memoryEdits?.[0]).toMatchObject({ content: '# 工作筆記\n- Scott 喜歡附來源' })
    expect(ctx.memoryEdits?.[0]).toMatchObject({ target: 'context', context: { projects: context.projects, weeklyFocus: [], people: ['A'] } })
    expect(proposals.every(proposal => proposal.card?.label === 'knowledge')).toBe(true)
  })
})

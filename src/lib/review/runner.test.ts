// Fork（almanac ALMNC-54.13）：一輪 G 自我優化——每週回顧提案的組成（G1／G2／G3＋14 天沒決定的提案＋到期筆記＋稽核），
// 不急的清理觀察依領域打包附在同一批，衝突或錯誤不等彙整立刻提案；頻率沒到或關閉時不跑。
import { describe, expect, it, vi } from 'vitest'
import type { CheckDeps } from '@/lib/cleanup/check'
import type { CleanupLabels } from '@/lib/cleanup/plan'
import { memoryQueue } from '@/lib/cleanup/queue'
import type { ProposalBatch, RosterAgent } from '@/lib/commander/types'
import { createV3Note } from '@/lib/v3-model/note'
import { maybeRunReview, runReview, type ReviewRunDeps } from './runner'
import { keyValueSettingsStore } from './settings'
import type { WeeklyLabels } from './weekly'

const cleanupLabels: CleanupLabels = {
  action: action => action,
  bundleTitle: ({ domain, count }) => `整理「${domain}」：${count} 項`,
  singleTitle: ({ action, title }) => `${action}：${title}`,
  item: ({ action, evidence }) => `- ${action}：${evidence}`,
  origin: ({ agent }) => `${agent} 整理的清理提案`,
  confirmTitle: ({ title }) => `仍然有效：${title}`,
  confirmBody: () => '',
}

const weekly: WeeklyLabels = {
  period: ({ month, week }) => `${month} 月第 ${week} 週`,
  title: ({ period }) => `每週回顧 · ${period}`,
  origin: ({ agent }) => `${agent} 統整的每週回顧`,
  tag: '時期回顧',
  sections: { actions: '行動回顧', records: '這期的紀錄', research: '研究員調研', experts: '專家回顧', due: '到期', stale: '超過 14 天沒決定的提案', audit: '記憶稽核', attached: '另附的提案' },
  completed: ({ count }) => `完成 ${count} 件`,
  overdue: ({ count }) => `逾期 ${count} 件`,
  procrastinated: ({ items }) => `拖延：${items}`,
  time: ({ items }) => `時間花在：${items}`,
  minutes: ({ key, hours }) => `${key} ${hours} 小時`,
  researchItem: ({ domain, question, summary }) => `${domain}｜${question}：${summary}`,
  researchUnavailable: ({ domain, question }) => `${domain}｜${question}（沒辦法查）`,
  researchNothing: ({ domain, question }) => `${domain}｜${question}：沒有新發現`,
  expertItem: ({ agent, domain, text }) => `${agent}（${domain}）：${text}`,
  dueItem: ({ note, date }) => `${note}（${date} 到期）`,
  staleItem: ({ title, days }) => `${title}（等了 ${days} 天）`,
  auditItem: ({ memory, text, note }) => `${memory}：「${text}」和 ${note} 重疊`,
  auditMemory: memory => memory,
  attached: ({ cleanup, schedule, audit }) => `清理 ${cleanup}、排程 ${schedule}、稽核 ${audit}`,
}

const roster: RosterAgent[] = [
  { id: 'cmd', name: 'Mia', role: 'commander', enabled: true },
  { id: 'exp_ie', name: 'Alex', role: 'expert', domain: '工業工程', enabled: true },
  { id: 'sec', name: 'Leo', role: 'secretary', enabled: true },
  { id: 'res', name: 'Nora', role: 'researcher', enabled: true },
]

const files = new Map<string, string>([
  ['k/takt.md', createV3Note({ title: '節拍 60 秒', type: 'knowledge', domains: ['ie'], status: 'valid', lastConfirmed: '2025-01-01' }, '節拍時間是 60 秒，等於可用時間除以需求量。\n')],
  ['k/takt2.md', createV3Note({ title: '節拍 45 秒', type: 'knowledge', domains: ['ie'], status: 'valid' }, '節拍時間是 45 秒。\n')],
  ['k/dup.md', createV3Note({ title: '節拍定義', type: 'knowledge', domains: ['ie'], status: 'valid' }, '節拍定義。\n')],
  ['daily/2026-11-10.md', '# 11/10\n\n- [ ] 寄報價 📅 2026-11-05\n'],
])

/** 假模型：依 prompt 內容回答各角色。 */
async function fakeModel(prompt: string): Promise<string> {
  if (prompt.includes('research questions')) return '{"questions":[{"question":"節拍時間 最新標準","notes":[0]}]}'
  if (prompt.includes('Summarise what the external results')) return '{"findings":[{"index":0,"summary":"新標準依需求計算。"}]}'
  if (prompt.includes('Review your domain')) {
    return JSON.stringify({
      observations: [{ kind: 'gap', text: '缺少換線時間的筆記', notes: [] }],
      conflicts: [{ type: 'contradiction', notes: [0, 1], evidence: '60 秒 vs 45 秒' }, { type: 'duplicate', notes: [0, 2], evidence: '同一件事' }],
    })
  }
  if (prompt.includes('You are the secretary')) return '這週報價一直拖。'
  return '{}'
}

function setup(options: { settings?: Record<string, unknown> } = {}) {
  const submitted: ProposalBatch[] = []
  const data = new Map<string, unknown>(Object.entries(options.settings ?? {}))
  const queue = memoryQueue([{ type: 'context', notePaths: ['k/takt.md', 'k/dup.md'], evidence: '單班與兩班', trigger: 'written', domainId: 'ie' }])
  const check: CheckDeps = {
    readNote: async path => files.get(path) ?? null,
    similar: async () => [],
    detect: async () => [],
    domains: async () => [{ id: 'ie', name: '工業工程', overview: '# 工業工程\n' }],
    submit: async batch => { submitted.push(batch) },
    queue,
    labels: cleanupLabels,
    commanderName: 'Mia',
    now: () => new Date(2026, 10, 22, 20),
  }
  const ask = vi.fn(fakeModel)
  const deps: ReviewRunDeps = {
    settings: keyValueSettingsStore({ get: async key => data.get(key), set: async (key, value) => { data.set(key, value) } }),
    now: () => new Date(2026, 10, 22, 20),
    roster: async () => roster,
    agentPrompt: async agent => `# ${agent.name}`,
    ask,
    lookup: async () => [{ title: '標準', url: 'https://example.com/takt', snippet: '依需求' }],
    digests: async () => [{ domainId: 'ie', name: '工業工程', notes: [
      { path: 'k/takt.md', title: '節拍 60 秒' }, { path: 'k/takt2.md', title: '節拍 45 秒' }, { path: 'k/dup.md', title: '節拍定義' },
    ] }],
    tasks: async () => [{ path: 'daily/2026-11-10.md', line: 2, title: '寄報價', due: '2026-11-05', time: '', done: false, raw: '- [ ] 寄報價 📅 2026-11-05', recurrence: '', priority: 'mid' }],
    events: async () => [{ id: '1', title: '週會', start: new Date(2026, 10, 17, 9).getTime(), end: new Date(2026, 10, 17, 11).getTime(), allDay: false, calendar: '工作' }],
    records: async () => [{ path: 'r/1119.md', title: '產線檢討' }],
    dueNotes: async (_today, until) => (until > '2026-11-22' ? [{ path: 'k/takt.md', title: '節拍 60 秒', lastConfirmed: '2025-01-01', dueDate: '2026-01-01', domains: ['ie'] }] : []),
    stale: async () => [{ key: 'collect:a:1', title: '舊提案', days: 20 }],
    memory: async () => ({ workNotes: [{ agent: { id: 'exp_ie', name: 'Alex', role: 'expert' }, content: '- 節拍時間是 60 秒，等於可用時間除以需求量' }] }),
    auditNotes: async () => [{ path: 'k/takt.md', title: '節拍 60 秒', body: '節拍時間是 60 秒，等於可用時間除以需求量。' }],
    check,
    submit: async batch => { submitted.push(batch) },
    labels: {
      weekly,
      schedule: { title: ({ task, to }) => `改時間：${task} → ${to}`, body: ({ days }) => `逾期 ${days} 天` },
      audit: { workNotesTitle: ({ agent, count }) => `整理 ${agent} 的工作筆記：${count}`, contextTitle: ({ count }) => `脈絡 ${count}`, line: ({ text, note }) => `- ${text} → ${note}` },
    },
    commanderName: 'Mia',
  }
  return { deps, submitted, queue, data, ask }
}

describe('runReview', () => {
  it('compiles G1, G2, G3, stale proposals, due notes and the audit into one weekly review batch', async () => {
    const { deps, submitted, data } = setup()
    const summary = await runReview(deps)
    expect(summary.errors).toEqual([])

    // 衝突（矛盾）不等彙整，先單獨送出。
    const [immediate, review] = submitted
    expect(immediate.id).toBe('cleanup:review:ie:2026-W47')
    expect(immediate.proposals).toHaveLength(1)
    expect(immediate.proposals[0]).toMatchObject({ card: { verb: 'verify' }, cleanup: { immediate: true } })

    expect(review.id).toBe('review:2026-W47')
    expect(review.origin).toBe('Mia 統整的每週回顧')
    const [weeklyProposal, ...extras] = review.proposals
    expect(weeklyProposal).toMatchObject({ title: '每週回顧 · 11 月第 3 週', card: { label: 'review', verb: 'add' }, review: { period: '11 月第 3 週', periodKey: '2026-W47' }, tags: ['時期回顧'] })
    const body = weeklyProposal.body
    expect(body).toContain('## 行動回顧\n\n這週報價一直拖。')
    expect(body).toContain('- 逾期 1 件')
    expect(body).toContain('- 拖延：寄報價')
    expect(body).toContain('時間花在：工作 2 小時')
    expect(body).toContain('## 這期的紀錄\n\n- [[r/1119]]')
    expect(body).toContain('工業工程｜節拍時間 最新標準：新標準依需求計算。 <https://example.com/takt>')
    expect(body).toContain('Alex（工業工程）：缺少換線時間的筆記')
    expect(body).toContain('[[k/takt]]（2026-01-01 到期）')
    expect(body).toContain('舊提案（等了 20 天）')
    expect(body).toContain('work_notes：「- 節拍時間是 60 秒，等於可用時間除以需求量」和 [[k/takt]] 重疊')
    expect(body).toContain('清理 1、排程 1、稽核 1')

    // 附帶：依領域打包的清理提案（佇列裡的情境不同＋G2 的重複）、排程調整（E4）、稽核。
    expect(extras.map(proposal => proposal.card)).toEqual([
      { label: 'knowledge', verb: 'organize' },
      { label: 'schedule', verb: 'reschedule' },
      { label: 'knowledge', verb: 'organize' },
    ])
    expect(extras[0]).toMatchObject({ title: '整理「工業工程」：2 項', cleanup: { immediate: false, actions: ['supplement', 'merge'] } })
    expect(extras[1]).toMatchObject({ title: '改時間：寄報價 → 2026-11-23', drafter: { role: 'secretary', agentId: 'sec' } })
    expect(extras[2].memoryEdits?.[0]).toMatchObject({ target: 'work_notes', content: '' })

    expect(data.get('almanacReviewLastRun')).toBe(new Date(2026, 10, 22, 20).getTime())
  })

  it('skips roles that are disabled and keeps going when a step fails', async () => {
    const { deps, submitted, ask } = setup()
    deps.roster = async () => roster.map(agent => agent.role === 'researcher' || agent.role === 'secretary' ? { ...agent, enabled: false } : agent)
    deps.stale = async () => { throw new Error('store down') }
    const summary = await runReview(deps)
    expect(summary.research).toEqual([])
    expect(summary.actions).toBeUndefined()
    expect(summary.errors).toEqual(['stale: store down'])
    expect(ask.mock.calls.some(([prompt]) => prompt.includes('research questions'))).toBe(false)
    expect(submitted.at(-1)?.proposals[0].body).not.toContain('行動回顧')
  })
})

describe('maybeRunReview', () => {
  it('runs on the default weekly schedule, not again in the same week, never when off', async () => {
    const first = setup()
    expect((await maybeRunReview(first.deps)).ran).toBe(true)
    expect((await maybeRunReview(first.deps)).ran).toBe(false)
    const off = setup({ settings: { almanacReviewSettings: { frequency: 'off', weekday: 0 } } })
    expect((await maybeRunReview(off.deps)).ran).toBe(false)
    expect(off.submitted).toEqual([])
  })
})

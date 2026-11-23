// Fork（almanac ALMNC-54.13）：指揮官把 G1 調研、G2 專家回顧、G3 秘書的行動回顧、這期的紀錄筆記、到期要確認的筆記、
// 超過 14 天沒決定的提案和記憶稽核，統整成一張「每週回顧」提案（標「回顧」、標的物是時期，例如「11 月第 3 週」）。
// 接受後寫成一則時期回顧（E2）。同一批另外附上排程調整（日程／改時間，作用在 E4）、
// 記憶稽核的刪除提案。MOC 整理另外送出，回顧只計數。
import { newProposalId } from '@/lib/collect/split'
import type { Proposal } from '@/lib/collect/types'
import type { ProposalBatch } from '@/lib/commander/types'
import type { ConfirmDue } from '@/lib/cleanup/interval'
import type { ActionStats } from './action-review'
import type { AuditFinding } from './audit'
import type { ExpertReview } from './expert-review'
import type { ResearchFinding } from './research'
import type { ReviewPeriod } from './settings'

export interface WeeklyLabels {
  period: (input: { month: number, week: number, year: number }) => string
  title: (input: { period: string }) => string
  origin: (input: { agent: string }) => string
  tag: string
  sections: {
    actions: string
    records: string
    research: string
    experts: string
    due: string
    stale: string
    audit: string
    attached: string
  }
  completed: (input: { count: number }) => string
  overdue: (input: { count: number }) => string
  procrastinated: (input: { items: string }) => string
  time: (input: { items: string }) => string
  minutes: (input: { key: string, hours: string }) => string
  researchItem: (input: { domain: string, question: string, summary: string }) => string
  researchUnavailable: (input: { domain: string, question: string }) => string
  researchNothing: (input: { domain: string, question: string }) => string
  expertItem: (input: { agent: string, domain: string, text: string }) => string
  dueItem: (input: { note: string, date: string }) => string
  staleItem: (input: { title: string, days: number }) => string
  auditItem: (input: { memory: string, text: string, note: string }) => string
  auditMemory: (memory: AuditFinding['memory']) => string
  attached: (input: { cleanup: number, schedule: number, audit: number }) => string
}

export interface WeeklyInput {
  period: ReviewPeriod
  labels: WeeklyLabels
  commanderName?: string
  domainNames: ReadonlyMap<string, string>
  agentNames?: ReadonlyMap<string, string>
  research: readonly ResearchFinding[]
  expertReviews: readonly ExpertReview[]
  actions?: { stats: ActionStats, narrative: string }
  /** 這期的紀錄筆記（D2 每週併入時期回顧）。 */
  records: ReadonlyArray<{ path: string, title: string }>
  dueNotes: readonly ConfirmDue[]
  /** 超過 14 天沒決定的提案。 */
  stale: ReadonlyArray<{ key: string, title: string, days: number }>
  audit: readonly AuditFinding[]
  cleanup: readonly Proposal[]
  schedule: readonly Proposal[]
  auditProposals: readonly Proposal[]
}

const wiki = (path: string) => `[[${path.replace(/\.md$/i, '')}]]`

function section(title: string, lines: readonly string[]): string[] {
  return lines.length ? [`## ${title}`, '', ...lines, ''] : []
}

function hours(minutes: number): string {
  return (Math.round(minutes / 6) / 10).toString()
}

export function weeklyReviewBody(input: WeeklyInput): string {
  const { labels } = input
  const domain = (id: string) => input.domainNames.get(id) ?? id
  const actionLines: string[] = []
  if (input.actions) {
    const { stats, narrative } = input.actions
    if (narrative) actionLines.push(narrative, '')
    actionLines.push(`- ${labels.completed({ count: stats.completed.length })}`)
    actionLines.push(`- ${labels.overdue({ count: stats.overdue.length })}`)
    if (stats.procrastinated.length) actionLines.push(`- ${labels.procrastinated({ items: stats.procrastinated.map(task => task.title).join('、') })}`)
    if (stats.time.length) actionLines.push(`- ${labels.time({ items: stats.time.slice(0, 6).map(bucket => labels.minutes({ key: bucket.key, hours: hours(bucket.minutes) })).join('、') })}`)
  }
  const research = input.research.map(finding => {
    const values = { domain: domain(finding.domainId), question: finding.question }
    if (finding.status === 'found') {
      const sources = finding.sources.slice(0, 3).map(source => `<${source.url}>`).join(' ')
      return `- ${labels.researchItem({ ...values, summary: finding.summary })}${sources ? ` ${sources}` : ''}`
    }
    if (finding.status === 'unavailable') return `- ${labels.researchUnavailable(values)}`
    return `- ${labels.researchNothing(values)}`
  })
  const experts = input.expertReviews.flatMap(review => review.observations.map(observation => {
    const notes = observation.notePaths.map(wiki).join('、')
    return `- ${labels.expertItem({ agent: (review.agentId && input.agentNames?.get(review.agentId)) || '', domain: domain(review.domainId), text: observation.text })}${notes ? `（${notes}）` : ''}`
  }))
  const attachedCount = { cleanup: new Set(input.cleanup.map(item => item.mocReview?.id)).size, schedule: input.schedule.length, audit: input.auditProposals.length }
  return [
    ...section(labels.sections.actions, actionLines),
    ...section(labels.sections.records, input.records.map(record => `- ${wiki(record.path)}`)),
    ...section(labels.sections.research, research),
    ...section(labels.sections.experts, experts),
    ...section(labels.sections.due, input.dueNotes.map(note => `- ${labels.dueItem({ note: wiki(note.path), date: note.dueDate })}`)),
    ...section(labels.sections.stale, input.stale.map(item => `- ${labels.staleItem({ title: item.title, days: item.days })}`)),
    ...section(labels.sections.audit, input.audit.map(finding => `- ${labels.auditItem({ memory: labels.auditMemory(finding.memory), text: finding.text.trim(), note: wiki(finding.notePath) })}`)),
    ...section(labels.sections.attached, attachedCount.cleanup + attachedCount.schedule + attachedCount.audit ? [labels.attached(attachedCount)] : []),
  ].join('\n').trim()
}

/** 每週回顧提案＋附帶的提案，一批送到工作台；完全沒有內容時回傳 undefined。批次 id 以時期為準，重跑不會重複送。 */
export function composeWeeklyReview(input: WeeklyInput): ProposalBatch | undefined {
  const body = weeklyReviewBody(input)
  const extras = [...input.schedule, ...input.auditProposals]
  if (!body && !extras.length) return undefined
  const period = input.labels.period({ month: input.period.month, week: input.period.week, year: input.period.year })
  const review: Proposal = {
    id: newProposalId(),
    kind: 'note',
    title: input.labels.title({ period }),
    body,
    due: '',
    time: '',
    tags: [input.labels.tag],
    card: { label: 'review', verb: 'add' },
    review: { period, periodKey: input.period.key },
    drafter: { role: 'commander' },
  }
  return {
    id: `review:${input.period.key}`,
    origin: input.labels.origin({ agent: input.commanderName ?? '' }),
    proposals: [review, ...extras],
  }
}

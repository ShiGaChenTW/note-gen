// Fork（almanac ALMNC-54.13）：G 自我優化的排程——到了 Agent 設定區設定的頻率（預設每週）就跑一輪：
//   G1 研究員調研各領域 → G2 各專家回顧自己的領域（衝突走清理流程）→ 定期檢查到期的筆記（ALMNC-54.12 發現時機 3）
//   → G3 秘書回顧行動（寫進時期回顧；排程調整建議作用在 E4）→ 稽核共用工作記憶與工作筆記
//   → 指揮官統整成一張「每週回顧」提案（附上依領域打包的清理提案、排程調整、稽核提案、超過 14 天沒決定的提案）。
// 衝突或錯誤（矛盾、過時）不等彙整，發現當下就立刻提案。每一步失敗都不影響其他步驟。全部注入依賴，測試用假的。
import { periodicCheck, submitImmediate, type CheckDeps } from '@/lib/cleanup/check'
import { cleanupProposals, routeObservations } from '@/lib/cleanup/plan'
import type { ConfirmDue } from '@/lib/cleanup/interval'
import { ymd } from '@/lib/cleanup/interval'
import type { ConflictObservation, ExternalEvidence } from '@/lib/cleanup/types'
import type { ProposalBatch, RosterAgent } from '@/lib/commander/types'
import type { CalendarEvent } from '@/lib/today/today-model'
import type { TaskRef } from '@/lib/vault-index/index-core'
import { computeActionStats, narrateActions, scheduleProposals, suggestReschedules, type ActionStats, type ScheduleLabels } from './action-review'
import { auditMemory, auditProposals, type AuditFinding, type AuditLabels, type AuditNote, type ContextInput, type WorkNotesInput } from './audit'
import { reviewDomain, type ExpertReview } from './expert-review'
import { researchDomains, type AskModel, type DomainDigest, type ResearchFinding } from './research'
import { isReviewDue, reviewPeriod, reviewRange, type ReviewSettingsStore } from './settings'
import { composeWeeklyReview, type WeeklyLabels } from './weekly'

export interface ReviewRunDeps {
  settings: ReviewSettingsStore
  now?: () => Date
  roster: () => Promise<RosterAgent[]>
  /** 角色的工作指示＋個別記憶。 */
  agentPrompt: (agent: RosterAgent) => Promise<string>
  ask: AskModel
  /** 研究員查外部資料；沒有就只列題目。 */
  lookup?: (query: string) => Promise<ExternalEvidence[]>
  digests: () => Promise<DomainDigest[]>
  tasks: () => Promise<TaskRef[]>
  events?: (range: { start: Date, end: Date }) => Promise<CalendarEvent[]>
  /** 這期的紀錄筆記。 */
  records: (range: { start: Date, end: Date }) => Promise<Array<{ path: string, title: string }>>
  /** 到 until 為止到期要重新確認的筆記。 */
  dueNotes: (today: string, until: string) => Promise<ConfirmDue[]>
  /** 超過 14 天沒決定的提案。 */
  stale: (now: number) => Promise<Array<{ key: string, title: string, days: number }>>
  memory: () => Promise<{ workNotes: WorkNotesInput[], context?: ContextInput, activity?: Array<{ id: number, note: string }> }>
  auditNotes: () => Promise<AuditNote[]>
  /** 清理流程的依賴（定期檢查、立刻提案、佇列）。 */
  check: CheckDeps
  submit: (batch: ProposalBatch) => Promise<void>
  labels: { weekly: WeeklyLabels, schedule: ScheduleLabels, audit: AuditLabels }
  commanderName?: string
  /** 每次最多定期檢查幾則到期的筆記。 */
  periodicLimit?: number
  /** Fork（almanac ALMNC-54.20）：研究員查到的外部資料建成系統產生的資料源、交給指揮官；沒給就不建。 */
  registerFindings?: (findings: ResearchFinding[], periodKey: string) => Promise<void>
}

export interface ReviewRunSummary {
  ran: boolean
  periodKey?: string
  research: ResearchFinding[]
  expertReviews: ExpertReview[]
  immediate: ConflictObservation[]
  actions?: ActionStats
  audit: AuditFinding[]
  batch?: ProposalBatch
  errors: string[]
}

function normalize(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

async function step<T>(name: string, errors: string[], run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run()
  } catch (error) {
    errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    return fallback
  }
}

/** 跑一輪 G1～G3＋稽核，統整成每週回顧提案送出，並記下這次執行的時間。 */
export async function runReview(deps: ReviewRunDeps): Promise<ReviewRunSummary> {
  const now = deps.now?.() ?? new Date()
  const today = ymd(now)
  const errors: string[] = []
  const { settings, lastRunAt } = await deps.settings.load()
  const range = reviewRange(settings, now, lastRunAt)
  const period = reviewPeriod(settings, range)
  const roster = (await step('roster', errors, deps.roster, [])).filter(agent => agent.enabled)
  const digests = await step('digests', errors, deps.digests, [])
  const domainNames = new Map(digests.map(digest => [digest.domainId, digest.name]))
  const immediate: ConflictObservation[] = []

  // G1 研究員調研。
  const researcher = roster.find(agent => agent.role === 'researcher')
  const research = researcher
    ? await step('research', errors, async () => researchDomains(digests, { ask: deps.ask, prompt: await deps.agentPrompt(researcher), lookup: deps.lookup }), [])
    : []
  if (deps.registerFindings && research.some(finding => finding.status === 'found')) {
    await step('research sources', errors, () => deps.registerFindings!(research, period.key), undefined)
  }

  // G2 專家回顧自己的領域；衝突照規則：衝突或錯誤立刻提案，其餘進佇列。
  const expertReviews: ExpertReview[] = []
  for (const expert of roster.filter(agent => agent.role === 'expert')) {
    for (const digest of digests.filter(entry => normalize(entry.name) === normalize(expert.domain))) {
      const review = await step(`expert ${expert.id}`, errors, async () => reviewDomain(digest, { ask: deps.ask, prompt: await deps.agentPrompt(expert), agentId: expert.id }), undefined)
      if (!review) continue
      expertReviews.push(review)
      const routed = routeObservations(review.conflicts)
      if (routed.immediate.length) {
        immediate.push(...routed.immediate)
        await step('immediate cleanup', errors, () => submitImmediate(routed.immediate, [], deps.check, `cleanup:review:${digest.domainId}:${period.key}`), undefined)
      }
      if (routed.deferred.length) await step('queue', errors, () => deps.check.queue.add(routed.deferred), undefined)
    }
  }

  // 定期檢查：最後確認日期已過領域期限的筆記（54.12 發現時機 3）。
  const due = await step('due notes', errors, () => deps.dueNotes(today, today), [])
  const periodic = await step('periodic check', errors, () => periodicCheck(due.map(note => note.path), deps.check, { limit: deps.periodicLimit ?? 10 }), [])
  for (const result of periodic) immediate.push(...result.immediate)

  // G3 秘書回顧行動。
  const secretary = roster.find(agent => agent.role === 'secretary')
  let actions: { stats: ActionStats, narrative: string } | undefined
  let schedule: Awaited<ReturnType<typeof scheduleProposals>> = []
  if (secretary) {
    const tasks = await step('tasks', errors, deps.tasks, [])
    const events = deps.events ? await step('calendar', errors, () => deps.events!(range), []) : []
    const stats = computeActionStats({ tasks, events, range, today })
    const narrative = await step('secretary', errors, async () => narrateActions(stats, { ask: deps.ask, prompt: await deps.agentPrompt(secretary) }), '')
    actions = { stats, narrative }
    schedule = await step('schedule', errors, () => scheduleProposals(suggestReschedules(stats, tasks, today), {
      readNote: deps.check.readNote, labels: deps.labels.schedule, today,
    }).then(list => list.map(proposal => ({ ...proposal, drafter: { role: 'secretary' as const, agentId: secretary.id } }))), [])
  }

  // 稽核共用工作記憶與工作筆記。
  const memory = await step('memory', errors, deps.memory, { workNotes: [] })
  const auditNotes = await step('audit notes', errors, deps.auditNotes, [])
  const audit = auditMemory(memory, auditNotes)
  const auditExtra = auditProposals(audit, memory, deps.labels.audit)

  // 不急的清理觀察依領域打包。
  const deferred = await step('queue', errors, () => deps.check.queue.take(), [])
  let cleanup: ReturnType<typeof cleanupProposals> = []
  if (deferred.length) {
    cleanup = await step('cleanup bundle', errors, async () => {
      const notes = new Map<string, string>()
      for (const path of new Set(deferred.flatMap(observation => observation.notePaths))) {
        const raw = await deps.check.readNote(path).catch(() => null)
        if (raw !== null) notes.set(path, raw)
      }
      const domains = new Map((await deps.check.domains()).map(domain => [domain.id, domain]))
      return cleanupProposals(deferred, { notes, domains, today, labels: deps.check.labels, words: deps.check.words, immediate: false })
    }, [])
  }

  const [records, dueThisPeriod, stale] = await Promise.all([
    step('records', errors, () => deps.records(range), []),
    // 每週回顧列出接下來這一期會到期的筆記。
    step('due soon', errors, () => deps.dueNotes(today, ymd(new Date(now.getTime() + Math.max(7, Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000)) * 86_400_000))), []),
    step('stale', errors, () => deps.stale(now.getTime()), []),
  ])

  const batch = composeWeeklyReview({
    period,
    labels: deps.labels.weekly,
    commanderName: deps.commanderName,
    domainNames,
    agentNames: new Map(roster.map(agent => [agent.id, agent.name])),
    research,
    expertReviews,
    actions,
    records,
    dueNotes: dueThisPeriod,
    stale,
    audit,
    cleanup,
    schedule,
    auditProposals: auditExtra,
  })
  if (batch) await step('submit', errors, () => deps.submit(batch), undefined)
  await deps.settings.markRun(now.getTime())
  return { ran: true, periodKey: period.key, research, expertReviews, immediate, actions: actions?.stats, audit, batch, errors }
}

/** 頻率到了才跑（關閉時不跑）。 */
export async function maybeRunReview(deps: ReviewRunDeps): Promise<ReviewRunSummary> {
  const { settings, lastRunAt } = await deps.settings.load()
  if (!isReviewDue(settings, lastRunAt, deps.now?.() ?? new Date())) return { ran: false, research: [], expertReviews: [], immediate: [], audit: [], errors: [] }
  return runReview(deps)
}

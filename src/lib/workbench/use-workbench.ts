'use client'

// Fork（almanac ALMNC-54.8）：工作台的資料訂閱——把提案投影、筆記庫任務、資料源表、舊記錄、知識筆記接到純函式投影上。
// 審核分頁、資料源分頁、側欄與今天頁的數字都用這裡，數字才對得上。
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { listAgentSettings } from '@/db/agents'
import { listDomains } from '@/db/v3-domains'
import { describeDomainProposal } from '@/lib/commander/domain-proposal'
import type { RosterAgent } from '@/lib/commander/types'
import { useDecisions } from '@/lib/decide/use-decisions'
import { groupTasks } from '@/lib/today/today-model'
import type { Domain } from '@/lib/v3-model/domain'
import useCollectStore from '@/stores/collect'
import useInboxStore from '@/stores/inbox'
import useVaultIndexStore, { selectAllTasks } from '@/stores/vault-index'
import useWorkbenchStore from '@/stores/workbench'
import { buildReviewCards, type DomainLike, type WorkbenchCard } from './cards'
import { computeDomainProposals, confirmNotesFromIndex, knowledgeNotesFromIndex } from './domain-cards'
import { hiddenCards, visibleCards } from './put-aside'
import { buildSourceRows, sourceTitle, type SourceListRow } from './sources-tab'
import { judgementLine } from './judgement'

const MINUTE = 60_000

/** 每分鐘換一次的「現在」：提醒日期到了、逾期、等多久都靠它。 */
export function useNow(step = MINUTE): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), step)
    return () => clearInterval(timer)
  }, [step])
  return now
}

/** 角色名單（指揮官本名用）；瀏覽器預覽沒有資料庫時讀 window.__almanacAgentsDemo。 */
export function useRoster(): RosterAgent[] {
  const [roster, setRoster] = useState<RosterAgent[]>([])
  useEffect(() => {
    let active = true
    listAgentSettings()
      .then(rows => { if (active) setRoster(rows) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])
  const demo = process.env.NODE_ENV !== 'production' && typeof window !== 'undefined'
    ? (window as unknown as { __almanacAgentsDemo?: RosterAgent[] }).__almanacAgentsDemo : undefined
  return demo ?? roster
}

/** 指揮官的本名（例如 Mia）；名單還沒建立時用角色名稱。 */
export function useCommanderName(): string {
  const roles = useTranslations('agents.roles')
  const roster = useRoster()
  return roster.find(agent => agent.role === 'commander' && agent.enabled)?.name || roles('commander')
}

function useDomains(): Domain[] {
  const [domains, setDomains] = useState<Domain[]>([])
  useEffect(() => {
    let active = true
    listDomains()
      .then(rows => { if (active) setDomains(rows) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])
  return domains
}

export interface ReviewData {
  /** 所有卡片（含先放著的），已排好序。 */
  all: WorkbenchCard[]
  /** 清單上看得到的（先放著的藏起來）。 */
  visible: WorkbenchCard[]
  /** 先放著、還沒到提醒日期的。 */
  aside: WorkbenchCard[]
  now: number
}

export function useReviewData(): ReviewData {
  const t = useTranslations('workbench')
  const commanderT = useTranslations('commander')
  const now = useNow()
  const proposals = useDecisions()
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const sources = useWorkbenchStore(state => state.sources)
  const judgements = useWorkbenchStore(state => state.judgements)
  const aside = useWorkbenchStore(state => state.aside)
  const dismissed = useWorkbenchStore(state => state.dismissed)
  const roster = useRoster()
  const domains = useDomains()
  const commander = roster.find(agent => agent.role === 'commander' && agent.enabled)?.name

  const tasks = useMemo(() => groupTasks(selectAllTasks({ notes, revision }), new Date(now)), [notes, revision, now])
  const noteList = useMemo(() => Array.from(notes.values()), [notes, revision]) // eslint-disable-line react-hooks/exhaustive-deps
  const domainCards = useMemo<DomainLike[]>(() => computeDomainProposals(knowledgeNotesFromIndex(noteList), domains, roster, dismissed)
    .map(proposal => ({ id: proposal.id, ...describeDomainProposal(proposal, commanderT), notePaths: proposal.notePaths, by: commander, at: now })),
  [noteList, domains, roster, dismissed, commanderT, commander, now])
  const confirm = useMemo(() => confirmNotesFromIndex(noteList, now), [noteList, now])

  const all = useMemo(() => buildReviewCards({
    proposals,
    overdueTasks: tasks.overdue,
    otherTasks: tasks.upcoming.flatMap(day => day.tasks),
    awaitingSources: sources
      .filter(source => source.status === 'awaiting_decision' && source.archivedAt === undefined)
      .map(source => {
        // Fork（almanac ALMNC-54.10）：附上初步判斷（R1）；沒有判斷時卡片照樣出現（AC#4），擷取失敗改成重試／刪除。
        const judgement = judgements.get(source.id)
        const failed = judgement?.status === 'capture_failed'
        return {
          id: source.id, title: sourceTitle(source), kindLabel: t(`sources.kind.${kindKey(source.kind)}`),
          judgement: failed ? t('sources.captureFailed') : judgementLine(judgement),
          ...(judgement?.status === 'ready' && judgement.suggestion ? { suggestion: judgement.suggestion } : {}),
          ...(failed ? { failed } : {}),
          origin: source.origin, collectedAt: source.collectedAt,
        }
      }),
    domains: domainCards,
    confirm,
    now,
  }), [proposals, tasks, sources, judgements, domainCards, confirm, now, t])

  return useMemo(() => ({ all, visible: visibleCards(all, aside, now), aside: hiddenCards(all, aside, now), now }), [all, aside, now])
}

function kindKey(kind: string): string {
  return ({ link: 'web', image: 'shot', transcript: 'audio', voice: 'audio', email: 'text' } as Record<string, string>)[kind]
    ?? (['text', 'file', 'todo', 'prompt'].includes(kind) ? kind : 'file')
}

export function useSourceRows(): SourceListRow[] {
  const sources = useWorkbenchStore(state => state.sources)
  const outputCounts = useWorkbenchStore(state => state.outputCounts)
  const edited = useWorkbenchStore(state => state.edited)
  const judgements = useWorkbenchStore(state => state.judgements)
  const records = useInboxStore(state => state.records)
  const processed = useInboxStore(state => state.processed)
  const captures = useCollectStore(state => state.items)
  return useMemo(
    () => buildSourceRows({ sources, outputCounts, records, processed, captures, edited, judgements }),
    [sources, outputCounts, records, processed, captures, edited, judgements],
  )
}

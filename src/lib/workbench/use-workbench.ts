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
import { pendingTaskGroups } from '@/lib/today/today-model'
import type { Domain } from '@/lib/v3-model/domain'
import type { ReconfirmInterval } from '@/lib/cleanup/interval'
import { awaitingToReplies } from '@/lib/threads/awaiting'
import useAwaitingRepliesStore from '@/stores/awaiting-replies'
import useChatStore from '@/stores/chat'
import useCollectStore from '@/stores/collect'
import useInboxStore from '@/stores/inbox'
import useVaultIndexStore, { selectAllTasks } from '@/stores/vault-index'
import useWorkbenchStore from '@/stores/workbench'
import { EMPTY_BLUEPRINTS, useBlueprintStore } from '@/lib/commander/blueprint-store'
import useSettingStore from '@/stores/setting'
import useMocStore from '@/stores/moc'
import { MAX_DOMAINS } from '@/lib/moc/membership'
import useDailySettingsStore from '@/stores/daily-settings'
import { DEFAULT_LEGACY_BATCH_SIZE, legacyPackKey, packsToShow, unmarkedLegacyNotes } from '@/lib/migration/legacy'
import type { IndexedNote } from '@/lib/vault-index/index-note'
import { buildReviewCards, type DomainLike, type DomainLimitLike, type HandLike, type LegacyBatchLike, type ReplyLike, type WorkbenchCard } from './cards'
import { computeDomainProposals, confirmNotesFromIndex, knowledgeNotesFromIndex } from './domain-cards'
import { hiddenCards, isHidden, visibleCards } from './put-aside'
import { buildSourceRows, sourceDisplayKind, sourceTitle, type SourceListRow } from './sources-tab'
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
  const mocs = useMocStore(state => state.mocs)
  useEffect(() => {
    let active = true
    listDomains()
      .then(rows => { if (active) setDomains(rows) })
      .catch(() => undefined)
    return () => { active = false }
  }, [mocs])
  return domains
}

/** Fork（almanac ALMNC-54.12）：各領域的重新確認期限（讀專家的 rules.md）；名單或領域變了就重讀。 */
function useReconfirmIntervals(domains: readonly Domain[], roster: readonly RosterAgent[]): ReadonlyMap<string, ReconfirmInterval> {
  const [intervals, setIntervals] = useState<ReadonlyMap<string, ReconfirmInterval>>(() => new Map())
  useEffect(() => {
    let active = true
    import('@/lib/cleanup/runtime')
      .then(module => module.loadReconfirmIntervals())
      .then(map => { if (active) setIntervals(map) })
      .catch(() => undefined)
    return () => { active = false }
  }, [domains, roster])
  return intervals
}

/** Fork（almanac ALMNC-54.14）：筆記庫裡還沒標記的舊筆記（按批次卡時用；不是 hook，直接讀 store 現況）。 */
export function currentUnmarkedLegacy(): Array<{ path: string, mtime: number }> {
  const daily = useDailySettingsStore.getState()
  return unmarkedLegacyNotes(Array.from(useVaultIndexStore.getState().notes.values()), daily, useWorkbenchStore.getState().legacy.markedIds)
}

function baseName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

/**
 * Fork（almanac ALMNC-54.14）：舊筆記批次卡與判斷不出來的那一包。批次卡的總數＝已標記＋筆記庫裡還沒標記的舊筆記，
 * 所以還沒按過也看得到「舊筆記 N 則」；包一次只出現一包（先放著的另外列在「先放著」）。
 */
function useLegacyInputs(noteList: readonly IndexedNote[], now: number, commander: string | undefined): { legacy?: LegacyBatchLike, hand: HandLike[] } {
  const t = useTranslations('workbench.legacy')
  const roles = useTranslations('agents.roles')
  const legacy = useWorkbenchStore(state => state.legacy)
  const aside = useWorkbenchStore(state => state.aside)
  const dailyFolder = useDailySettingsStore(state => state.dailyFolder)
  const dailyPattern = useDailySettingsStore(state => state.dailyPattern)
  const unmarked = useMemo(() => unmarkedLegacyNotes(noteList, { dailyFolder, dailyPattern }, legacy.markedIds).length,
    [noteList, dailyFolder, dailyPattern, legacy.markedIds])
  return useMemo(() => {
    const name = commander || roles('commander')
    const total = legacy.total + unmarked
    const progress = t('progress', { done: legacy.processed, total })
    const summary = legacy.running
      ? [progress, t(legacy.pausing ? 'pausing' : 'running')].join(' · ')
      : legacy.processed > 0 ? [progress, t('paused')].join(' · ') : t('summary', { name })
    const batch: LegacyBatchLike | undefined = total > legacy.processed
      ? { title: t('title', { count: total }), summary, total, processed: legacy.processed, running: legacy.running, pausing: legacy.pausing, batchSize: DEFAULT_LEGACY_BATCH_SIZE, by: t('by'), at: legacy.firstMarkedAt ?? now }
      : undefined
    const hand: HandLike[] = packsToShow(legacy.packs, key => isHidden(aside[key], now)).map(pack => ({
      key: legacyPackKey(pack.id),
      label: 'source',
      title: baseName(pack.items[0]!.path),
      more: pack.items.length > 1 ? pack.items.length - 1 : undefined,
      summary: t('packSummary', { name }),
      by: commander,
      at: pack.createdAt,
      notePaths: pack.items.map(item => item.path),
      packId: pack.id,
    }))
    return { legacy: batch, hand }
  }, [legacy, unmarked, aside, now, commander, t, roles])
}

/**
 * Fork（almanac ALMNC-54.21）：「等你回話」——秘書在對話裡問你、還在等你回的問題（lib/threads/awaiting.ts）。
 * 你在那段對話送出訊息後自動消失；刪掉的對話不列。
 */
function useReplies(): ReplyLike[] {
  const t = useTranslations('workbench.reply')
  const map = useAwaitingRepliesStore(state => state.map)
  const conversations = useChatStore(state => state.conversations)
  useEffect(() => { void useAwaitingRepliesStore.getState().hydrate() }, [])
  return useMemo(() => awaitingToReplies(map, {
    conversations,
    summary: entry => t('summary', { title: conversations.find(conversation => conversation.id === entry.conversationId)?.title || t('untitled') }),
  }), [map, conversations, t])
}

/** Fork（almanac ALMNC-69.7）：收錄超過 3 個領域的筆記（MOC 重建時發現），每則一張卡請 Scott 選要拿掉哪個領域。 */
function useDomainLimits(notes: ReadonlyMap<string, IndexedNote>): DomainLimitLike[] {
  const t = useTranslations('workbench.domainLimit')
  const overLimit = useMocStore(state => state.overLimit)
  return useMemo(() => overLimit.map(item => {
    const title = notes.get(item.path)?.frontmatter?.title
    return {
      notePath: item.path,
      title: typeof title === 'string' && title.trim() ? title.trim() : baseName(item.path),
      domains: item.after,
      summary: t('summary', { count: item.after.length, limit: MAX_DOMAINS }),
      by: t('by'),
      at: item.at,
    }
  }), [overLimit, notes, t])
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
  const workspace = useSettingStore(state => state.workspacePath)
  const blueprints = useBlueprintStore(state => state.byWorkspace[workspace] ?? EMPTY_BLUEPRINTS)
  const roster = useRoster()
  const domains = useDomains()
  const commander = roster.find(agent => agent.role === 'commander' && agent.enabled)?.name

  // Fork（almanac ALMNC-54.21）：日程列出所有還沒做的任務（含沒排日期、3 天以後才到期的），逾期的排最前面。
  const tasks = useMemo(() => pendingTaskGroups(selectAllTasks({ notes, revision }), new Date(now)), [notes, revision, now])
  const noteList = useMemo(() => Array.from(notes.values()), [notes, revision]) // eslint-disable-line react-hooks/exhaustive-deps
  const domainCards = useMemo<DomainLike[]>(() => computeDomainProposals(knowledgeNotesFromIndex(noteList), domains, roster, dismissed)
    .map(proposal => ({ id: proposal.id, ...describeDomainProposal(proposal, commanderT), notePaths: proposal.notePaths, positioning: proposal.moc.positioning, expertName: proposal.expert.name, by: commander, at: now })),
  [noteList, domains, roster, dismissed, commanderT, commander, now])
  const intervals = useReconfirmIntervals(domains, roster)
  const confirm = useMemo(() => confirmNotesFromIndex(noteList, now, intervals), [noteList, now, intervals])
  const legacyInputs = useLegacyInputs(noteList, now, commander)
  const replies = useReplies()
  const domainLimits = useDomainLimits(notes)

  const all = useMemo(() => buildReviewCards({
    proposals,
    replies,
    overdueTasks: tasks.overdue,
    otherTasks: [...tasks.dated, ...tasks.undated],
    awaitingSources: sources
      .filter(source => source.status === 'awaiting_decision' && source.archivedAt === undefined)
      .map(source => {
        // Fork（almanac ALMNC-54.10）：附上初步判斷（R1）；沒有判斷時卡片照樣出現（AC#4），擷取失敗改成重試／刪除。
        const judgement = judgements.get(source.id)
        const failed = judgement?.status === 'capture_failed'
        return {
          id: source.id, title: sourceTitle(source), kindLabel: t(`sources.kind.${sourceDisplayKind(source.kind)}`),
          judgement: failed ? t('sources.captureFailed') : judgementLine(judgement),
          ...(judgement?.status === 'ready' && judgement.suggestion ? { suggestion: judgement.suggestion } : {}),
          ...(failed ? { failed } : {}),
          origin: source.origin, collectedAt: source.collectedAt,
        }
      }),
    domains: domainCards,
    blueprints: blueprints.map(proposal => ({ proposal, title: t('blueprint.title', { domain: proposal.name }), by: commander })),
    domainLimits,
    confirm,
    hand: legacyInputs.hand,
    legacy: legacyInputs.legacy,
    now,
  }), [proposals, replies, tasks, sources, judgements, domainCards, blueprints, commander, domainLimits, confirm, legacyInputs, now, t])

  return useMemo(() => ({ all, visible: visibleCards(all, aside, now), aside: hiddenCards(all, aside, now), now }), [all, aside, now])
}

/**
 * Fork（almanac ALMNC-54.14）：工作台等你處理的件數（先放著的不算）——側欄與今天頁「工作台 · N 件」用同一個數字。
 * 工作台頁沒開過時資料源表還沒讀，這裡補讀一次，數字才不會少算資料源卡與舊筆記批次卡。
 */
export function useWorkbenchCount(): number {
  const loaded = useWorkbenchStore(state => state.sourcesLoaded)
  useEffect(() => {
    if (loaded) return
    void import('./actions').then(module => module.refreshSources()).catch(() => undefined)
  }, [loaded])
  return useReviewData().visible.length
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

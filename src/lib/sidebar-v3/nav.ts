// Fork（almanac ALMNC-20）：v5 側欄（方案 B）的導覽資料組裝。純函式，不碰 store 與畫面，方便測試。
// 六個導覽項、各項右側的數字、哪個導覽項該亮、代理人區的列與執行中人數，以及舊入口歸到哪一項。
import type { AgentRole } from '@/lib/agents/settings'

// Fork（almanac ALMNC-54.8）：「收集」不再是主導覽，併進工作台的「資料源」分頁（Q36）；decide 這一項顯示為「工作台」。
export const NAV_KEYS = ['today', 'decide', 'threads', 'knowledge', 'plan'] as const
export type NavKey = typeof NAV_KEYS[number]

/** 舊側欄（classic）所有可點的入口。 */
export const LEGACY_ENTRIES = [
  'overview', 'today', 'week', 'decide', 'collect', 'threads', 'inbox', 'prompts',
  'notes', 'timeline', 'canvases', 'noteTags', 'calendar',
] as const
export type LegacyEntry = typeof LEGACY_ENTRIES[number]

/** 舊入口在新側欄的歸屬：整合成五個導覽項，檔案樹留在下半部 MyVault。收集與 Inbox 歸到工作台（資料源分頁）。 */
export const ENTRY_HOME: Record<LegacyEntry, NavKey> = {
  overview: 'today',
  today: 'today',
  decide: 'decide',
  collect: 'decide',
  inbox: 'decide',
  threads: 'threads',
  notes: 'knowledge',
  timeline: 'knowledge',
  canvases: 'knowledge',
  noteTags: 'knowledge',
  prompts: 'knowledge',
  week: 'plan',
  calendar: 'plan',
}

export const COLLECT_TABS = ['collect', 'inbox'] as const
export type CollectTab = typeof COLLECT_TABS[number]
// Fork（almanac ALMNC-54.23）：加上「領域」分頁（第三層知識的領域頁）。
export const KNOWLEDGE_TABS = ['timeline', 'canvases', 'noteTags', 'domains', 'prompts'] as const
export type KnowledgeTab = typeof KNOWLEDGE_TABS[number]

export interface NavVisibility {
  home: boolean
  decide: boolean
  collect: boolean
  inbox: boolean
  threads: boolean
  week: boolean
  knowledge: boolean
  promptLibrary: boolean
}

/** 目前開著的全頁覆蓋層屬於哪個導覽項；都沒開（在工作區看筆記）就是 null。 */
export function activeNavKey(visibility: NavVisibility): NavKey | null {
  if (visibility.home) return 'today'
  if (visibility.decide || visibility.collect || visibility.inbox) return 'decide'
  if (visibility.threads) return 'threads'
  if (visibility.knowledge || visibility.promptLibrary) return 'knowledge'
  if (visibility.week) return 'plan'
  return null
}

export interface NavRow {
  key: NavKey
  /** 右側的待處理數；0 不顯示。 */
  count: number
  active: boolean
}

export interface NavInput {
  /** 工作台審核分頁的件數（先放著的不算）。 */
  decideCount: number
  visibility: NavVisibility
}

export function buildNav(input: NavInput): NavRow[] {
  const active = activeNavKey(input.visibility)
  const counts: Partial<Record<NavKey, number>> = {
    decide: input.decideCount,
  }
  return NAV_KEYS.map(key => ({
    key,
    count: Math.max(0, Math.floor(counts[key] ?? 0)),
    active: key === active,
  }))
}

export interface AgentSource {
  id: string
  name: string
  role: AgentRole
  /** 專家負責的領域，顯示成「領域＋專家」。 */
  domain?: string
  enabled: boolean
}

export interface AgentTaskSource {
  kind: string
  status: string
}

export interface AgentRow extends AgentSource {
  running: boolean
}

const RUNNING_STATUSES = new Set(['queued', 'running'])

/** 設定裡的每位代理人一列；有 queued／running 任務（kind 為 agent:<id>）的算執行中，停用的不算。 */
export function buildAgentRows(agents: readonly AgentSource[], tasks: readonly AgentTaskSource[]): AgentRow[] {
  const busy = new Set<string>()
  for (const task of tasks) {
    if (task.kind.startsWith('agent:') && RUNNING_STATUSES.has(task.status)) busy.add(task.kind.slice('agent:'.length))
  }
  return agents.map(agent => ({ ...agent, running: agent.enabled && busy.has(agent.id) }))
}

export function runningAgentCount(rows: readonly AgentRow[]): number {
  return rows.filter(row => row.running).length
}

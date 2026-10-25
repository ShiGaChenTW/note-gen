// Fork（#35）：知識報告的執行與排程。報告以 Agent 任務（kind 'report'）在背景產出；
// 產出前先估 token，超過上限就暫停等使用者確認。第一次一律由使用者「建立基準」。
import { create } from 'zustand'
import { agentTaskCenter } from '@/lib/agent-tasks'
import type { AgentTask } from '@/lib/agent-tasks/types'
import useVaultIndexStore from '@/stores/vault-index'
import {
  latestReportInIndex,
  loadReportSettings,
  planReport,
  runReport,
  updateSuggestion,
  type ReportSettings,
} from './generate'
import { isReportDue, periodKey, settleSuggestions, type ReportFrequency } from './report'

export interface PendingConfirm {
  period: string
  estimate: number
  limit: number
}

interface ReportUiState {
  drawer: 'report' | 'baseline' | null
  /** 估算超過上限、等使用者確認的一期 */
  pending: PendingConfirm | null
  planning: boolean
  settings: ReportSettings | null
  openDrawer: (drawer: 'report' | 'baseline') => void
  closeDrawer: () => void
  setSettings: (settings: ReportSettings) => void
}

export const useKnowledgeReportStore = create<ReportUiState>(set => ({
  drawer: null,
  pending: null,
  planning: false,
  settings: null,
  openDrawer: drawer => set({ drawer }),
  closeDrawer: () => set({ drawer: null }),
  setSettings: settings => set({ settings }),
}))

function frequencyOf(settings: ReportSettings): ReportFrequency {
  return settings.frequency === 'off' ? 'weekly' : settings.frequency
}

export function activeReportTask(tasks: AgentTask[]): AgentTask | undefined {
  return tasks.find(task => task.kind === 'report' && (task.status === 'queued' || task.status === 'running'))
}

async function enqueueReport(period: string, title: string) {
  if (activeReportTask(agentTaskCenter.list())) return null
  return agentTaskCenter.enqueue({ kind: 'report', title, prompt: title + `\n(${period})` })
}

export interface RequestResult {
  outcome: 'started' | 'needsConfirm' | 'busy'
  estimate: number
  period: string
}

/**
 * 要求產出一期報告：估 token；不超過上限（或 force）就排進任務中心，否則記成待確認。
 * title 是任務標題（依語系，由畫面傳入，例如「產生 2026-W44 知識報告」）。
 */
export async function requestReport(titleFor: (period: string) => string, force = false): Promise<RequestResult> {
  const store = useKnowledgeReportStore.getState()
  const settings = await loadReportSettings()
  const period = periodKey(new Date(), frequencyOf(settings))
  if (activeReportTask(agentTaskCenter.list())) return { outcome: 'busy', estimate: 0, period }
  store.setSettings(settings)
  useKnowledgeReportStore.setState({ planning: true })
  try {
    const plan = await planReport(new Date(), frequencyOf(settings))
    if (!force && plan.estimate > settings.tokenLimit) {
      useKnowledgeReportStore.setState({ pending: { period: plan.period, estimate: plan.estimate, limit: settings.tokenLimit } })
      return { outcome: 'needsConfirm', estimate: plan.estimate, period: plan.period }
    }
    useKnowledgeReportStore.setState({ pending: null })
    const task = await enqueueReport(plan.period, titleFor(plan.period))
    return { outcome: task ? 'started' : 'busy', estimate: plan.estimate, period: plan.period }
  } finally {
    useKnowledgeReportStore.setState({ planning: false })
  }
}

/** 只估算、不產出（建立基準與確認對話框用）。 */
export async function estimateReport(): Promise<{ estimate: number; period: string; limit: number }> {
  const settings = await loadReportSettings()
  const plan = await planReport(new Date(), frequencyOf(settings))
  return { estimate: plan.estimate, period: plan.period, limit: settings.tokenLimit }
}

/** 任務中心的報告執行器。 */
export function registerReportRunner() {
  return agentTaskCenter.registerRunner('report', async (_task, context) => {
    const settings = await loadReportSettings()
    const plan = await planReport(new Date(), frequencyOf(settings))
    const { path } = await runReport(plan, { signal: context.signal, onTokens: context.setTokens, now: () => new Date() })
    return { result: path }
  })
}

/** 排程檢查：已有基準、這一期還沒產出、沒有在跑也沒有待確認，才要求產出。 */
export async function checkSchedule(titleFor: (period: string) => string): Promise<void> {
  if (useVaultIndexStore.getState().status !== 'ready') return
  const settings = await loadReportSettings()
  useKnowledgeReportStore.getState().setSettings(settings)
  if (settings.frequency === 'off') return
  const latest = latestReportInIndex()
  if (!isReportDue(latest?.report ?? null, new Date(), settings.frequency)) return
  const pending = useKnowledgeReportStore.getState().pending
  if (pending && pending.period === periodKey(new Date(), settings.frequency)) return
  // 上一次這一期的任務失敗或被取消，就不自動重試，等使用者按「立即產生」
  const period = periodKey(new Date(), settings.frequency)
  if (agentTaskCenter.list().some(task => task.kind === 'report' && task.prompt.includes(`(${period})`))) return
  await requestReport(titleFor)
}

/** 交給 Agent 的建議，任務完成後標成已處理。 */
export async function settleHandedSuggestions(tasks: AgentTask[]): Promise<void> {
  const latest = latestReportInIndex()
  if (!latest) return
  const byId = new Map(tasks.map(task => [task.id, task.status]))
  for (const change of settleSuggestions(latest.report, id => byId.get(id))) {
    await updateSuggestion(latest.path, change.id, { status: change.status })
  }
}

export { latestReportInIndex, updateSuggestion }

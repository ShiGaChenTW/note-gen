'use client'

// Fork（almanac ALMNC-10）：訂閱兩個來源與今日日誌快取，回傳投影後的清單。首頁、側欄、等你定頁都用這一個。
import { useMemo } from 'react'
import { useAgentTaskStore } from '@/lib/agent-tasks'
import { useJobs } from '@/lib/jobs'
import { useUiV3 } from '@/lib/fork-ui'
import { pendingCountByConversation, staleProposals } from '@/lib/proposals/trail'
import useChatStore from '@/stores/chat'
import useCollectStore from '@/stores/collect'
import useDecideStore from '@/stores/decide'
import useProposalTrailStore from '@/stores/proposals'
import useSettingStore from '@/stores/setting'
import { projectProposals, type DecideItem } from './project'

const NONE: DecideItem[] = []

/**
 * Fork（almanac ALMNC-54.5）：所有還沒決定的提案（含再次討論中的），帶來源對話。
 * 舊介面（classic）一律回空：等你定的入口與擴充都不出現。
 */
export function usePendingProposals(): DecideItem[] {
  const isV3 = useUiV3()
  const items = useCollectStore(state => state.items)
  const tasks = useAgentTaskStore(state => state.tasks)
  const jobs = useJobs(state => state.jobs)
  const journal = useDecideStore(state => state.journal)
  const workspace = useSettingStore(state => state.workspacePath)
  const trail = useProposalTrailStore(state => state.trail)
  const conversations = useChatStore(state => state.conversations)
  return useMemo(
    () => (isV3 ? projectProposals({ items, tasks, journal, jobs, workspace, trail, conversations }) : NONE),
    [isV3, items, tasks, journal, jobs, workspace, trail, conversations],
  )
}

/** 等你接受或放棄的（再次討論中的回到對話，不列在這裡）。 */
export function useDecisions(): DecideItem[] {
  const pending = usePendingProposals()
  return useMemo(() => {
    const waiting = pending.filter(item => item.status === 'wait')
    return waiting.length === pending.length ? pending : waiting
  }, [pending])
}

/** Fork（almanac ALMNC-54.5）：對話 id → 還有幾則提案待決定。 */
export function usePendingCounts(): Map<number, number> {
  const pending = usePendingProposals()
  return useMemo(() => pendingCountByConversation(pending), [pending])
}

/** Fork（almanac ALMNC-54.5）：超過 14 天沒決定、要列進每週回顧的提案（不會因此消失）。now 由呼叫端給，方便固定。 */
export function useStaleProposals(now: number): DecideItem[] {
  const pending = usePendingProposals()
  return useMemo(() => staleProposals(pending, now), [pending, now])
}

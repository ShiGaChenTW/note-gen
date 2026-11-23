import type { AgentTraceEvent } from '@/lib/agent/types'

/** thinking：模型還在輸出思考；done：思考已結束（或這筆紀錄已完成）。 */
export type ReasoningPhase = 'thinking' | 'done'

export type ReasoningLabel =
  | { key: 'thinking' }
  | { key: 'thoughtFor'; seconds: number }
  | { key: 'thoughtBriefly' }
  | { key: 'reasoning' }

/** 沒有思考內容的事件回傳 null，畫面照原本方式顯示。 */
export function getReasoningPhase(
  event: Pick<AgentTraceEvent, 'reasoning' | 'reasoningDuration' | 'status'>,
  isRunning: boolean,
): ReasoningPhase | null {
  if (!event.reasoning?.trim()) return null
  return isRunning && event.status === 'running' && event.reasoningDuration === undefined ? 'thinking' : 'done'
}

/** 舊紀錄沒有 reasoningDuration，只顯示「思考過程」。 */
export function getReasoningLabel(phase: ReasoningPhase, durationMs: number | undefined): ReasoningLabel {
  if (phase === 'thinking') return { key: 'thinking' }
  if (durationMs === undefined || !Number.isFinite(durationMs)) return { key: 'reasoning' }
  if (durationMs < 1000) return { key: 'thoughtBriefly' }
  return { key: 'thoughtFor', seconds: Math.round(durationMs / 1000) }
}

/** 使用者手動切換過就照他的；沒有的話，思考中展開、結束收起。 */
export function isReasoningExpanded(userChoice: boolean | undefined, phase: ReasoningPhase): boolean {
  return userChoice ?? phase === 'thinking'
}

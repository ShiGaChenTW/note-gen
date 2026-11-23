import type { AgentTraceEvent, ToolCall } from '@/lib/agent/types'
import { TOOL_DISPLAY_TITLE_KEY } from '@/lib/agent/tool-display'
import { formatAgentToolName } from './agent-display-utils'

// Fork（almanac ALMNC-75）：runtime 只在工具開始時才建 trace event，同一輪模型一次叫多個工具時，
// 排在後面的工具在輪到之前沒有任何步驟列。這裡從最後一輪 model_response 記下的 toolCalls
// 推出還沒開始的工具，給 V3 任務卡顯示成「尚未開始」。只用於執行中的畫面，不寫進存檔。

interface ModelToolCallPreview {
  id: string
  name: string
  argumentsPreview?: string
}

function readToolCallPreviews(output: unknown): ModelToolCallPreview[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return []
  const toolCalls = (output as { toolCalls?: unknown }).toolCalls
  if (!Array.isArray(toolCalls)) return []
  return toolCalls.filter((call): call is ModelToolCallPreview => Boolean(call)
    && typeof call === 'object'
    && typeof (call as ModelToolCallPreview).id === 'string' && (call as ModelToolCallPreview).id.length > 0
    && typeof (call as ModelToolCallPreview).name === 'string')
}

function readArguments(preview?: string): { input?: Record<string, unknown>; displayTitle?: string } {
  if (!preview) return {}
  try {
    const parsed = JSON.parse(preview) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const input = { ...parsed as Record<string, unknown> }
      const title = input[TOOL_DISPLAY_TITLE_KEY]
      delete input[TOOL_DISPLAY_TITLE_KEY]
      return { input, displayTitle: typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined : undefined }
    }
  } catch {
    // 參數預覽超過 500 字會被截斷，不是合法 JSON；仍試著取出顯示標題。
  }
  const match = preview.match(/"_display_title"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (!match) return {}
  try {
    const title = JSON.parse(`"${match[1]}"`) as string
    return { displayTitle: title.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined }
  } catch {
    return {}
  }
}

/** 最後一輪模型選了、但還沒開始執行的工具，依模型給的順序回傳 pending 步驟。 */
export function getQueuedToolSteps(traceEvents: AgentTraceEvent[], toolCalls: ToolCall[]): AgentTraceEvent[] {
  const lastModelEvent = traceEvents.findLast(event => event.type === 'model_call' || event.type === 'model_response')
  if (!lastModelEvent || lastModelEvent.type !== 'model_response' || lastModelEvent.status !== 'success') return []
  const started = new Set(toolCalls.map(call => call.id))
  const queuedAt = lastModelEvent.timestamp + (lastModelEvent.duration ?? 0)
  return readToolCallPreviews(lastModelEvent.output)
    .filter(call => !started.has(call.id))
    .map(call => {
      const { input, displayTitle } = readArguments(call.argumentsPreview)
      return {
        id: `queued:${call.id}`,
        runId: lastModelEvent.runId,
        type: 'tool_call' as const,
        title: displayTitle || formatAgentToolName(call.name),
        displayTitle,
        status: 'pending' as const,
        timestamp: queuedAt,
        toolName: call.name,
        input,
      }
    })
}

/**
 * 思考耗時：從送出請求算到思考結束。
 * 思考結束 = 有思考內容之後，第一次收到回覆文字或工具呼叫；串流結束時還沒結束就算到現在。
 * 沒有思考內容時回傳 undefined，畫面就不顯示「思考了 N 秒」。
 */
export function computeReasoningDuration({
  startedAt,
  endedAt,
  now,
  hasReasoning,
}: {
  startedAt: number
  endedAt: number
  now: number
  hasReasoning: boolean
}): number | undefined {
  if (!hasReasoning || startedAt <= 0) return undefined
  return Math.max(0, (endedAt > 0 ? endedAt : now) - startedAt)
}

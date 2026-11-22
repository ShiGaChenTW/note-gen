// Fork（almanac ALMNC-47）：今日簡報自己的「已送」紀錄。純函式，存在 store.json 的 einkBriefingLog（只在這台 Mac，不跟著設定同步）。
// 文章的已送狀態在稍後讀清單（read-later.ts）、釘選資料的送出日在釘選清單（pins.ts），這裡只記另外兩件：
//   reviewShown   每日回顧卡最後一次出現的時間（路徑 → 毫秒），「最久沒出現的先抽」看這個
//   report        最後送出的知識報告期別，「有新一期才放」看這個
// 只有 commitSent（真的送出後）會寫；組裝只讀。

export const EINK_BRIEFING_LOG_KEY = 'einkBriefingLog'
/** reviewShown 最多留幾筆（釘選取消後的舊紀錄不會再用到，避免無限長大） */
export const MAX_REVIEW_LOG = 500

export interface BriefingLog {
  reviewShown: Record<string, number>
  report?: { period: string, sentAt: number }
}

export const EMPTY_BRIEFING_LOG: BriefingLog = { reviewShown: {} }

export function normalizeBriefingLog(saved: unknown): BriefingLog {
  const value = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  const shown = (value.reviewShown && typeof value.reviewShown === 'object' && !Array.isArray(value.reviewShown) ? value.reviewShown : {}) as Record<string, unknown>
  const reviewShown: Record<string, number> = {}
  for (const [path, at] of Object.entries(shown)) {
    if (path && typeof at === 'number' && Number.isFinite(at)) reviewShown[path] = at
  }
  const report = value.report as Record<string, unknown> | undefined
  return {
    reviewShown,
    ...(report && typeof report.period === 'string' && typeof report.sentAt === 'number' && Number.isFinite(report.sentAt)
      ? { report: { period: report.period, sentAt: report.sentAt } }
      : {}),
  }
}

/** 真的送出後記下：這幾張回顧卡今天出現過、這一期知識報告送過了。 */
export function applyBriefingSent(log: BriefingLog, sent: { reviewPaths: readonly string[], reportPeriod?: string }, at: number): BriefingLog {
  const reviewShown = { ...log.reviewShown }
  for (const path of sent.reviewPaths) reviewShown[path] = at
  const entries = Object.entries(reviewShown)
  const trimmed = entries.length > MAX_REVIEW_LOG
    ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_REVIEW_LOG))
    : reviewShown
  return {
    reviewShown: trimmed,
    ...(sent.reportPeriod ? { report: { period: sent.reportPeriod, sentAt: at } } : log.report ? { report: log.report } : {}),
  }
}

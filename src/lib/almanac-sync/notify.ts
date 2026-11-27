// Fork（almanac ALMNC-85.2）：V3 同步領域的本機寫入通知（設計 1.9：V3 表寫入後 enqueueAutoDataSync('almanac', 原因)）。
// V3 同步關著時什麼都不做（不讓同步狀態閃一下「排隊中」）；佇列會把連續的 almanac 任務合成一個，所以頻繁呼叫沒關係。
// 只動態載入，避免資料庫模組在 import 時就拉進同步佇列。

export function notifyAlmanacLocalChange(reason: string): void {
  void (async () => {
    const { isAlmanacV3SyncEnabled } = await import('./runtime')
    if (!await isAlmanacV3SyncEnabled()) return
    const { enqueueAutoDataSync } = await import('@/lib/sync/auto-data-sync-queue')
    enqueueAutoDataSync('almanac', reason)
  })().catch(() => undefined)
}

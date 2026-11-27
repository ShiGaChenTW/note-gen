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

/**
 * Fork（almanac ALMNC-85.4，設計 1.9）：fork 程式自己 store.set＋save 一個 V3 key 之後呼叫，依 key 排上傳：
 * V3 同步接手的 key → almanac；裝置層級的 key（almanacUiMode 等）→ 不排；其他 → settings。只動態載入，不在 import 時拉進 Tauri。
 */
export function notifyStoreKeyWritten(key: string): void {
  void import('./store-keys')
    .then(({ enqueueStoreKeySync }) => enqueueStoreKeySync(key))
    .catch(() => undefined)
}

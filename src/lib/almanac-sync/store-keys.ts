// Fork（almanac ALMNC-85.2 骨架）：writeSyncedStoreKey（設計 1.9、同步範圍報告風險 3）。
// fork 程式直接 store.set 寫 V3 key 時不會觸發上傳；改用這個函式：寫入、存檔，再依 key 屬於哪個同步領域排上傳。
// - V3 同步接手的 key（註冊的表的 storeKeys，且已換跑道）→ almanac
// - 設定同步排除的 key（裝置層級）→ 不排
// - 其他 → settings
// 85.4 把現有 fork 程式的 store.set 換成這個函式。
'use client'

import { Store } from '@tauri-apps/plugin-store'
import { getAlmanacLaneExcludedFields, shouldExcludeFromSync } from '@/config/sync-exclusions'
import type { AutoDataSyncDomain } from '@/lib/sync/auto-data-sync-queue'

export function resolveStoreKeySyncDomain(key: string, options: { excludeSensitiveConfig?: boolean } = {}): AutoDataSyncDomain | null {
  if (getAlmanacLaneExcludedFields().includes(key)) return 'almanac'
  if (shouldExcludeFromSync(key, options)) return null
  return 'settings'
}

export async function writeSyncedStoreKey(key: string, value: unknown): Promise<AutoDataSyncDomain | null> {
  const store = await Store.load('store.json')
  if (value === undefined) await store.delete(key)
  else await store.set(key, value)
  await store.save()
  const excludeSensitiveConfig = await store.get<boolean>('excludeSensitiveConfig') !== false
  const domain = resolveStoreKeySyncDomain(key, { excludeSensitiveConfig })
  if (domain) {
    const { enqueueAutoDataSync } = await import('@/lib/sync/auto-data-sync-queue')
    enqueueAutoDataSync(domain, `store:${key}`)
  }
  return domain
}

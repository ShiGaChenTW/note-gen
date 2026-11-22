// Fork（almanac ALMNC-54.12）：不急的觀察（情境不同、重複、封存）先放這裡，等每週回顧時依領域打包成清理提案。
// 衝突或錯誤（矛盾、過時）不進這裡，立刻提案。儲存介面注入；預設存在 store.json（runtime.ts）。
import { CONFLICT_TYPES, type ConflictObservation } from './types'
import { observationKey } from './plan'

export interface CleanupQueue {
  add: (observations: readonly ConflictObservation[]) => Promise<void>
  /** 取出全部並清空。 */
  take: () => Promise<ConflictObservation[]>
}

export const CLEANUP_QUEUE_KEY = 'almanacCleanupPending'

/** 合併：同一類型、同一組筆記只留一筆（新的蓋舊的）。 */
export function mergeQueued(existing: readonly ConflictObservation[], incoming: readonly ConflictObservation[]): ConflictObservation[] {
  const byKey = new Map<string, ConflictObservation>()
  for (const observation of [...existing, ...incoming]) byKey.set(observationKey(observation), observation)
  return [...byKey.values()]
}

/** 讀回存檔：格式不對的丟掉。 */
export function sanitizeQueued(raw: unknown): ConflictObservation[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is ConflictObservation => {
    if (!item || typeof item !== 'object') return false
    const record = item as Partial<ConflictObservation>
    return CONFLICT_TYPES.includes(record.type as ConflictObservation['type'])
      && Array.isArray(record.notePaths) && record.notePaths.length > 0 && record.notePaths.every(path => typeof path === 'string')
      && typeof record.evidence === 'string' && typeof record.trigger === 'string'
  })
}

/** 存在記憶體（測試、或沒有 Tauri 時）。 */
export function memoryQueue(initial: readonly ConflictObservation[] = []): CleanupQueue & { items: () => ConflictObservation[] } {
  let items = [...initial]
  return {
    add: async observations => { items = mergeQueued(items, observations) },
    take: async () => {
      const out = items
      items = []
      return out
    },
    items: () => [...items],
  }
}

/** 包一個鍵值存檔（get／set）成佇列。 */
export function storeQueue(store: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> }, key = CLEANUP_QUEUE_KEY): CleanupQueue {
  return {
    add: async observations => {
      if (!observations.length) return
      await store.set(key, mergeQueued(sanitizeQueued(await store.get(key)), observations))
    },
    take: async () => {
      const items = sanitizeQueued(await store.get(key))
      if (items.length) await store.set(key, [])
      return items
    },
  }
}

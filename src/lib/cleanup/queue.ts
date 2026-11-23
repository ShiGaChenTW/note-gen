import { CONFLICT_TYPES, type ConflictObservation } from './types'
import { observationKey } from './plan'

export interface CleanupQueue {
  add: (observations: readonly ConflictObservation[]) => Promise<void>
  snapshot: () => Promise<ConflictObservation[]>
  acknowledge: (observations: readonly ConflictObservation[]) => Promise<void>
}

export const CLEANUP_QUEUE_KEY = 'almanacCleanupPending'

export function queuedKey(observation: ConflictObservation): string {
  return JSON.stringify([observation.domainId, observationKey(observation)])
}

/** 同一個 MOC、類型與筆記組合只留最新觀察。 */
export function mergeQueued(existing: readonly ConflictObservation[], incoming: readonly ConflictObservation[]): ConflictObservation[] {
  const byKey = new Map<string, ConflictObservation>()
  for (const observation of [...existing, ...incoming]) byKey.set(queuedKey(observation), observation)
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

function unacknowledged(items: ConflictObservation[], done: readonly ConflictObservation[]): ConflictObservation[] {
  const known = new Map(done.map(item => [queuedKey(item), JSON.stringify(item)]))
  return items.filter(item => known.get(queuedKey(item)) !== JSON.stringify(item))
}

/** 存在記憶體（測試用）。 */
export function memoryQueue(initial: readonly ConflictObservation[] = []): CleanupQueue & { items: () => ConflictObservation[] } {
  let items = [...initial]
  return {
    add: async observations => { items = mergeQueued(items, observations) },
    snapshot: async () => [...items],
    acknowledge: async done => { items = unacknowledged(items, done) },
    items: () => [...items],
  }
}

// App 有多個背景比對會同時取佇列；同一個 store 鍵的讀改寫依序執行。
let pending = Promise.resolve()
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.then(operation)
  pending = next.then(() => undefined, () => undefined)
  return next
}

/** 送出每週卡並存檔後才移除觀察；若其間又加入較新的證據，留給下次整理。 */
export function storeQueue(store: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> }, key = CLEANUP_QUEUE_KEY): CleanupQueue {
  const read = async () => sanitizeQueued(await store.get(key))
  return {
    add: observations => serialize(async () => {
      if (observations.length) await store.set(key, mergeQueued(await read(), observations))
    }),
    snapshot: () => serialize(read),
    acknowledge: done => serialize(async () => {
      if (done.length) await store.set(key, unacknowledged(await read(), done))
    }),
  }
}

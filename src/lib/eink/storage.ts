// Fork（almanac ALMNC-45）：電子紙相關資料的 store.json 讀寫。測試可換成記憶體裡的儲存。
export interface EinkStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

let storageOverride: EinkStorage | null = null

/** 測試用：換成記憶體裡的儲存；傳 null 回到 store.json。 */
export function configureEinkStorage(storage: EinkStorage | null): void {
  storageOverride = storage
}

export async function einkStorage(): Promise<EinkStorage> {
  if (storageOverride) return storageOverride
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load('store.json')
}

export async function persistEink(key: string, value: unknown): Promise<void> {
  try {
    const store = await einkStorage()
    await store.set(key, value)
    await store.save()
  } catch (error) {
    // 不印出值（token 不能進 log）
    console.error(`[eink] failed to save ${key}:`, error instanceof Error ? error.message : 'unknown error')
  }
}

export async function readEinkKeys(keys: readonly string[]): Promise<Record<string, unknown>> {
  const store = await einkStorage()
  const values = await Promise.all(keys.map(key => store.get(key)))
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]))
}

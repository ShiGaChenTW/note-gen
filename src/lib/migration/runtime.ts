// Fork（almanac ALMNC-54.14）：把舊筆記遷移（lib/migration/legacy.ts）接到資料庫與指揮官的預設依賴。需要 Tauri，所以不寫單元測試；
// 流程本身的測試在 legacy.test.ts。整個 App 共用一個控制器：工作台批次卡的「開始處理／繼續處理／暫停」都走這裡。
// 不在啟動時自動跑：只有 Scott 按了批次卡才標記與分批，標記時也不讀、不改筆記檔。
import { createLegacyMigration, DEFAULT_LEGACY_BATCH_SIZE, markLegacyNotes, type LegacyRunSummary } from './legacy'

let shared: ReturnType<typeof createLegacyMigration> | undefined
let listeners: Array<() => void> = []

/** 跑的狀態一變（開始、每批做完、停下）就通知（工作台據此重讀資料源與包）。 */
export function onLegacyProgress(listener: () => void): () => void {
  listeners.push(listener)
  return () => { listeners = listeners.filter(entry => entry !== listener) }
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.warn('[legacy] progress listener failed:', error)
    }
  }
}

async function controller(): Promise<ReturnType<typeof createLegacyMigration>> {
  if (shared) return shared
  const [{ createDefaultCommanderDeps }, sourcesDb, packsDb] = await Promise.all([
    import('@/lib/commander/default-deps'),
    import('@/db/v3-sources'),
    import('@/db/v3-legacy-packs'),
  ])
  shared ??= createLegacyMigration({
    commander: await createDefaultCommanderDeps(),
    list: sourcesDb.listLegacyNoteSources,
    addPack: (batchId, items) => packsDb.addLegacyPack(batchId, items),
    newBatchId: () => `legacy_${crypto.randomUUID()}`,
  }, { batchSize: DEFAULT_LEGACY_BATCH_SIZE, onProgress: notify })
  return shared
}

export function legacyRunning(): { running: boolean, pausing: boolean } {
  return { running: shared?.running ?? false, pausing: shared?.pausing ?? false }
}

/**
 * 批次卡的「開始處理／繼續處理」：先把還沒標記的舊筆記標成資料源（重跑不重複），再分批交給指揮官。
 * 回傳這一輪怎麼停下來的（做完、暫停、整批失敗、整批判斷不出來）。
 */
export async function startLegacyMigration(unmarked: ReadonlyArray<{ path: string, mtime?: number }>): Promise<LegacyRunSummary> {
  const sourcesDb = await import('@/db/v3-sources')
  if (unmarked.length) {
    await markLegacyNotes(unmarked, { list: sourcesDb.listLegacyNoteSources, insert: sourcesDb.insertLegacyNoteSources }, Date.now())
  }
  const migration = await controller()
  const run = migration.start()
  notify()
  try {
    return await run
  } finally {
    notify()
  }
}

export function pauseLegacyMigration(): void {
  shared?.pause()
  notify()
}

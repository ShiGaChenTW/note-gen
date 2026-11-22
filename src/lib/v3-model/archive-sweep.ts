// Fork（almanac ALMNC-54.1，AC#6）：不採用的資料源滿 30 天後自動封存（只設 archivedAt，狀態仍是不採用），絕不刪除。
// 這裡是掃描與排程的純邏輯：時鐘、讀取、寫回、計時器全部由呼叫端注入（測試用假的）。
// 規則本身（滿 30 天的判斷、封存）在 source.ts 的 sourcesDueForArchive／archiveSource；接 App 的在 db/v3-sources.ts 與 SourceArchiveService。
import { archiveSource, REJECTED_ARCHIVE_AFTER_MS, sourcesDueForArchive, type Source } from './source'

/** 掃描的依賴。刻意沒有「刪除」：這一層連刪的入口都沒有。 */
export interface ArchiveSweepDeps {
  now: () => number
  /** 還沒封存、狀態是不採用的資料源。 */
  listRejected: () => Promise<readonly Source[]>
  /** 寫回封存後的資料源（只會帶 archivedAt）。 */
  save: (source: Source) => Promise<void>
}

/**
 * 封存不採用滿 30 天（含剛好 30 天）的資料源，回傳這次封存的 id。
 * 冪等：封存過的（archivedAt 有值）不會再被選中，重複掃描不會改它們的封存時間。
 */
export async function sweepRejectedSources(deps: ArchiveSweepDeps, afterMs = REJECTED_ARCHIVE_AFTER_MS): Promise<string[]> {
  const now = deps.now()
  const candidates = await deps.listRejected()
  const due = new Set(sourcesDueForArchive(candidates, now, afterMs))
  const archived: string[] = []
  for (const source of candidates) {
    if (!due.has(source.id)) continue
    await deps.save(archiveSource(source, now))
    archived.push(source.id)
  }
  return archived
}

/** 開著 App 時多久掃一次：一天。 */
export const ARCHIVE_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface ArchiveSchedulerDeps {
  /** 跑一次掃描；回傳這次封存的 id。 */
  sweep: () => Promise<string[]>
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
  /** 這次封存了東西（要重讀清單）。 */
  onArchived?: (ids: string[]) => void
}

export interface ArchiveScheduler {
  /** 啟動：馬上掃一次，之後每天一次。重複呼叫不會開兩個計時器。 */
  start: () => Promise<string[]>
  stop: () => void
  readonly started: boolean
}

export function createArchiveScheduler(deps: ArchiveSchedulerDeps, interval = ARCHIVE_SWEEP_INTERVAL_MS): ArchiveScheduler {
  let timer: unknown
  let started = false
  // 掃描不會同時跑兩輪；後來的接在前一輪後面。
  let chain: Promise<unknown> = Promise.resolve()

  const run = (): Promise<string[]> => {
    const next = chain.then(async () => {
      try {
        const ids = await deps.sweep()
        if (ids.length) deps.onArchived?.(ids)
        return ids
      } catch (error) {
        console.warn('[archive] sweep failed:', error)
        return []
      }
    })
    chain = next
    return next
  }

  return {
    start() {
      if (started) return Promise.resolve([])
      started = true
      timer = deps.setInterval(() => void run(), interval)
      return run()
    },
    stop() {
      if (timer !== undefined) deps.clearInterval(timer)
      timer = undefined
      started = false
    },
    get started() {
      return started
    },
  }
}

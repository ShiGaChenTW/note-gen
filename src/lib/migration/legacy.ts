// Fork（almanac ALMNC-54.14）：舊筆記遷移（路由 R3）。規格見 almanac/2026-11-19_proposal_role-data-model.md
// 第一節 §1「舊筆記：上線時整批標成資料源，由指揮官分批分析；判斷不出來的放進工作台，一次一包」、第四節路由 R3。
// 這裡全是注入依賴的純邏輯（測試用假的）；接資料庫與指揮官的預設依賴在 runtime.ts。
//
// 三步：
//   1. 選：筆記庫裡哪些 Markdown 算舊筆記（selectLegacyNotes）。已經是 V3 筆記（frontmatter 有 type）、每日筆記（一天的容器，
//      不是資料源）、隱藏檔、非 Markdown 都不算。
//   2. 標：每則舊筆記建一列資料源（只存路徑，不改檔、不複製全文），停在「等你決定」；id 由路徑決定，重跑不重複（markLegacyNotes）。
//   3. 分批交給指揮官：Scott 在批次卡按一次，就每批 N 則交給指揮官（runLegacyBatch／createLegacyMigration）。
//      判斷得出來的照常變成提案；判斷不出來的（拆片段失敗只剩保底片段、或讀不到檔）不送提案，整批合成「一包」放回工作台。
//      進度就是資料源狀態：重開 App 後從還沒處理的那則接著做；暫停只是停在這一則做完之後。
import type { IndexedNote } from '@/lib/vault-index/index-note'
import { parseDailyNotePath } from '@/lib/daily/format'
import { NOTE_TYPES } from '@/lib/v3-model/note'
import { createLegacyNoteSource, legacySourceId, type Source } from '@/lib/v3-model/source'
import { analyzeSource } from '@/lib/commander/pipeline'
import type { AnalyzeResult, CommanderDeps, ProposalBatch } from '@/lib/commander/types'

/** 每批交給指揮官幾則。 */
export const DEFAULT_LEGACY_BATCH_SIZE = 20

// ── 1. 選 ────────────────────────────────────────────────────

export interface LegacySelectOptions {
  dailyFolder: string
  dailyPattern?: string
}

export interface LegacySelection {
  /** 算舊筆記的路徑（照路徑排序）。 */
  paths: string[]
  skipped: { v3: number, daily: number, hidden: number, nonMarkdown: number }
}

function trimSlashes(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/** 每日筆記：在每日筆記資料夾裡、檔名符合日期格式（資料夾留空時是根目錄裡符合日期格式的檔案）。 */
export function isDailyNote(path: string, options: LegacySelectOptions): boolean {
  const folder = trimSlashes(options.dailyFolder)
  if (folder) {
    if (!path.toLowerCase().startsWith(`${folder.toLowerCase()}/`)) return false
    return parseDailyNotePath(path.slice(folder.length + 1), '', options.dailyPattern) !== null
  }
  return !path.includes('/') && parseDailyNotePath(path, '', options.dailyPattern) !== null
}

/** 已經是 V3 筆記：frontmatter 的 type 是知識／紀錄／專案之一。 */
export function isV3Note(frontmatter: IndexedNote['frontmatter']): boolean {
  const type = frontmatter?.type
  return typeof type === 'string' && (NOTE_TYPES as readonly string[]).includes(type.trim().toLowerCase())
}

export function selectLegacyNotes(notes: Iterable<Pick<IndexedNote, 'path' | 'frontmatter'>>, options: LegacySelectOptions): LegacySelection {
  const skipped = { v3: 0, daily: 0, hidden: 0, nonMarkdown: 0 }
  const paths: string[] = []
  for (const note of notes) {
    const path = note.path
    if (!/\.md$/i.test(path)) skipped.nonMarkdown++
    else if (path.split('/').some(part => part.startsWith('.'))) skipped.hidden++
    else if (isDailyNote(path, options)) skipped.daily++
    else if (isV3Note(note.frontmatter)) skipped.v3++
    else paths.push(path)
  }
  paths.sort()
  return { paths, skipped }
}

// ── 2. 標 ────────────────────────────────────────────────────

/** 還沒標過的舊筆記（標過的以資料源 id 判斷；不論狀態，分析完的也不再標）。 */
export function unmarkedPaths(paths: readonly string[], marked: Iterable<Pick<Source, 'id'>>): string[] {
  const ids = new Set(Array.from(marked, source => source.id))
  return paths.filter(path => !ids.has(legacySourceId(path)))
}

/** 筆記庫裡還沒標記的舊筆記（帶修改時間，標記時當收集時間）。 */
export function unmarkedLegacyNotes(
  notes: readonly Pick<IndexedNote, 'path' | 'frontmatter' | 'mtime'>[],
  options: LegacySelectOptions,
  markedIds: ReadonlySet<string>,
): Array<{ path: string, mtime: number }> {
  const mtimes = new Map(notes.map(note => [note.path, note.mtime]))
  return selectLegacyNotes(notes, options).paths
    .filter(path => !markedIds.has(legacySourceId(path)))
    .map(path => ({ path, mtime: mtimes.get(path) ?? 0 }))
}

export interface LegacyMarkDeps {
  /** 已經有的舊筆記資料源。 */
  list: () => Promise<Source[]>
  /** 寫入；已經有的 id 要跳過。回傳實際新增幾則。 */
  insert: (sources: readonly Source[]) => Promise<number>
}

/** 標記：只新增還沒標過的；不讀也不改筆記檔。 */
export async function markLegacyNotes(
  notes: ReadonlyArray<{ path: string, mtime?: number }>,
  deps: LegacyMarkDeps,
  now: number,
): Promise<{ added: number, existing: number }> {
  const existing = await deps.list()
  const todo = new Set(unmarkedPaths(notes.map(note => note.path), existing))
  const fresh = notes.filter(note => todo.has(note.path)).map(note => createLegacyNoteSource(note, now))
  const added = fresh.length ? await deps.insert(fresh) : 0
  return { added, existing: notes.length - fresh.length }
}

// ── 3. 分批交給指揮官 ──────────────────────────────────────────

export interface LegacyPackItem {
  sourceId: string
  path: string
}

/** 一包：同一批裡判斷不出來的舊筆記。 */
export interface LegacyPack {
  id: string
  createdAt: number
  items: LegacyPackItem[]
}

/**
 * 判斷不出來：轉不出文字（檔案讀不到），或拆片段只剩保底片段（模型輸出壞掉或沒回應）。
 * 全部判斷成「不採用」不算判斷不出來，那是明確的結論。
 */
export function isUndecided(result: AnalyzeResult): boolean {
  if (result.status === 'skipped') return false
  if (result.conversion.status === 'failed' || result.conversion.status === 'unavailable') return true
  return result.fragments.length > 0 && result.fragments.every(fragment => fragment.fallback)
}

export interface LegacyRunDeps {
  commander: CommanderDeps
  /** 全部的舊筆記資料源。 */
  list: () => Promise<Source[]>
  addPack: (batchId: string, items: readonly LegacyPackItem[]) => Promise<void>
  newBatchId?: () => string
}

export interface LegacyProgress {
  total: number
  /** 已分析或不採用。 */
  processed: number
  /** 還在等（等你決定、待分析、分析中）。 */
  remaining: number
}

export function legacyProgress(sources: readonly Pick<Source, 'status'>[]): LegacyProgress {
  const processed = sources.filter(source => source.status === 'analyzed' || source.status === 'rejected').length
  return { total: sources.length, processed, remaining: sources.length - processed }
}

/** 下一批：先接中斷或失敗退回的（待分析），再拿等你決定的；都照收集時間由舊到新。 */
export function nextBatch(sources: readonly Source[], size: number, exclude: ReadonlySet<string> = new Set()): Source[] {
  const open = sources.filter(source => source.archivedAt === undefined && !exclude.has(source.id))
  const byAge = (a: Source, b: Source) => a.collectedAt - b.collectedAt || a.id.localeCompare(b.id)
  const pending = open.filter(source => source.status === 'pending_analysis').sort(byAge)
  const waiting = open.filter(source => source.status === 'awaiting_decision').sort(byAge)
  return [...pending, ...waiting].slice(0, Math.max(1, size))
}

export interface BatchOutcome {
  batchId: string
  /** 這一批交給指揮官、分析完成的。 */
  done: string[]
  undecided: string[]
  failed: Array<{ sourceId: string, error: string }>
  /** 中途被暫停。 */
  stopped: boolean
}

/** 包一層指揮官依賴：提案先留著，等知道判斷得出來才送；判斷不出來就不送（改放進包裡）。 */
function deferSubmit(deps: CommanderDeps): { deps: CommanderDeps, take: () => ProposalBatch | undefined } {
  let held: ProposalBatch | undefined
  return {
    deps: { ...deps, submitProposals: async batch => { held = batch } },
    take: () => {
      const batch = held
      held = undefined
      return batch
    },
  }
}

/** 跑一批。每則做完都看一次 shouldStop（暫停）；判斷不出來的整批合成一包。 */
export async function runLegacyBatch(
  deps: LegacyRunDeps,
  options: { batchSize?: number, shouldStop?: () => boolean, exclude?: ReadonlySet<string> } = {},
): Promise<BatchOutcome> {
  const batchId = deps.newBatchId?.() ?? `legacy_${Date.now()}`
  const batch = nextBatch(await deps.list(), options.batchSize ?? DEFAULT_LEGACY_BATCH_SIZE, options.exclude)
  const outcome: BatchOutcome = { batchId, done: [], undecided: [], failed: [], stopped: false }
  const pack: LegacyPackItem[] = []
  for (const source of batch) {
    if (options.shouldStop?.()) {
      outcome.stopped = true
      break
    }
    const deferred = deferSubmit(deps.commander)
    try {
      if (source.status === 'awaiting_decision') await deps.commander.sources.setStatus(source.id, 'pending_analysis')
      const result = await analyzeSource(source.id, deferred.deps)
      if (result.status === 'skipped') continue
      const proposals = deferred.take()
      if (isUndecided(result)) {
        outcome.undecided.push(source.id)
        pack.push({ sourceId: source.id, path: source.origin ?? source.content })
      } else {
        if (proposals) {
          try {
            await deps.commander.submitProposals(proposals)
          } catch (error) {
            // 送不出去也不能讓內容掉：放進包裡，Scott 親手整理。
            console.warn('[legacy] submit proposals failed, moving to pack:', error)
            outcome.undecided.push(source.id)
            pack.push({ sourceId: source.id, path: source.origin ?? source.content })
            outcome.done.push(source.id)
            continue
          }
        }
      }
      outcome.done.push(source.id)
    } catch (error) {
      outcome.failed.push({ sourceId: source.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (pack.length) await deps.addPack(batchId, pack)
  return outcome
}

export type LegacyStopReason = 'paused' | 'finished' | 'all_failed' | 'all_undecided'

export interface LegacyRunSummary {
  reason: LegacyStopReason
  done: number
  undecided: number
  failed: number
  packs: number
}

/** 整批判斷不出來（至少這麼多則）時先停下來：多半是模型沒設定或連不上，不該把上千則全倒進包裡。 */
export const ALL_UNDECIDED_STOP_MIN = 3

/**
 * 舊筆記批次的控制器：同一時間只跑一輪；start 一直跑到做完、暫停或出狀況。
 * 第一次 start 先把上次中斷卡在分析中的舊筆記退回待分析（一般佇列不碰舊筆記，見 commander/pipeline.ts）。
 */
export function createLegacyMigration(deps: LegacyRunDeps, options: { batchSize?: number, onProgress?: () => void } = {}) {
  let running: Promise<LegacyRunSummary> | undefined
  let stopRequested = false
  let recovered = false

  const loop = async (): Promise<LegacyRunSummary> => {
    if (!recovered) {
      recovered = true
      for (const source of await deps.list()) {
        if (source.status === 'analyzing') await deps.commander.sources.setStatus(source.id, 'pending_analysis').catch(() => undefined)
      }
    }
    const summary: LegacyRunSummary = { reason: 'finished', done: 0, undecided: 0, failed: 0, packs: 0 }
    const failedThisRun = new Set<string>()
    while (true) {
      if (stopRequested) {
        summary.reason = 'paused'
        break
      }
      const outcome = await runLegacyBatch(deps, { batchSize: options.batchSize, shouldStop: () => stopRequested, exclude: failedThisRun })
      summary.done += outcome.done.length
      summary.undecided += outcome.undecided.length
      summary.failed += outcome.failed.length
      if (outcome.undecided.length) summary.packs++
      for (const failure of outcome.failed) failedThisRun.add(failure.sourceId)
      const attempted = outcome.done.length + outcome.failed.length
      if (attempted > 0) options.onProgress?.()
      if (outcome.stopped) {
        summary.reason = 'paused'
        break
      }
      if (attempted === 0) break
      if (outcome.done.length === 0) {
        summary.reason = 'all_failed'
        break
      }
      if (outcome.done.length >= ALL_UNDECIDED_STOP_MIN && outcome.undecided.length === outcome.done.length) {
        summary.reason = 'all_undecided'
        break
      }
    }
    return summary
  }

  return {
    start(): Promise<LegacyRunSummary> {
      stopRequested = false
      running ??= loop().finally(() => {
        running = undefined
        stopRequested = false
      })
      return running
    },
    /** 暫停：這一則做完就停；沒做完的留在資料源狀態裡，下次 start 接著做。 */
    pause(): void {
      if (running) stopRequested = true
    },
    get running(): boolean {
      return running !== undefined
    },
    get pausing(): boolean {
      return running !== undefined && stopRequested
    },
  }
}

// ── 工作台 ───────────────────────────────────────────────────

/** 一次一包：最舊的、沒被先放著的那包。 */
export function currentPack(packs: readonly LegacyPack[], isAside: (key: string) => boolean = () => false): LegacyPack | undefined {
  return packs.find(pack => pack.items.length > 0 && !isAside(legacyPackKey(pack.id)))
}

/** 要做成卡片的包：先放著的照樣做（才會出現在「先放著」清單），清單上看得到的永遠只有 currentPack 那一包。 */
export function packsToShow(packs: readonly LegacyPack[], isAside: (key: string) => boolean = () => false): LegacyPack[] {
  const current = currentPack(packs, isAside)
  return packs.filter(pack => pack === current || (pack.items.length > 0 && isAside(legacyPackKey(pack.id))))
}

export function legacyPackKey(batchId: string): string {
  return `legacy-pack:${batchId}`
}

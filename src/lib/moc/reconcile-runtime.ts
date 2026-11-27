// Fork（almanac ALMNC-69.10）：Obsidian 手動編輯 MOC 的 App 流程。判斷都在 reconcile.ts（純函式、有測試），這裡只做 I/O：
// - 時機：MocRebuildService（沿用 69.5／69.7：筆記庫索引 ready、每次檔案變動後去抖動 1.5 秒）在重建 domains 前呼叫 runMocReconcile。
//   同一次去抖動收進來的所有 MOC 變動＝「同一批事件」。
// - 上次已知狀態：note.db 的 moc_snapshots（記憶體快取一份）。App 自己寫 MOC（writeNote／commitNoteWrites）的事件由 app-writes 記下，
//   比對前先套進上次已知狀態，所以只有 App 外（Obsidian、其他編輯器、匯入）的修改會被當成 Scott 的手動編輯。
// - 直接生效：修回的斷鏈寫回檔案；會生效的差異記成 ops（actor＝scott，每筆一則活動紀錄，7 天內可復原）；直接生效的收錄修改標 Scott 指定
//   （scott-pins，69.11 接手儲存）；上次已知狀態＝有效內容；格式壞了／斷鏈保留原歸屬時，重建改用有效內容（setMocOverrides）。
//   加入後超過 3 個領域：由接著跑的重建發現，沿用 69.7 的 domainLimit 卡。
// - 整批檢查（batchCheck）：不直接生效——上次已知狀態不動、重建改用上次已知狀態（沒看過的 MOC 先不算），工作台出「整批檢查」卡。
//   全部接受／逐條取消：取消的差異逐條反向套回目前檔案（revertDiffs，只動那幾行），其餘照直接生效記錄。
//   退回：全部差異反向套回目前檔案（保留 Scott 在其他區塊的修改），退回本身記成一筆 MOC 內容修改操作，7 天內可復原。
import { commitNoteWrites } from '@/lib/daily/coordinated-write'
import { readNote } from '@/lib/daily/note-io'
import { buildLinkLookup, resolveWikilinkTargetWithLookup } from '@/lib/vault-index/links'
import type { IndexedNote } from '@/lib/vault-index/index-note'
import type { RecordInput } from '@/lib/ops/service'
import type { OpRecord } from '@/lib/ops/types'
import useMocReconcileStore from '@/stores/moc-reconcile'
import useVaultIndexStore from '@/stores/vault-index'
import { takeAppWrites } from './app-writes'
import { parseMoc } from './parse'
import {
  adoptSyncedBaselines, applyAppWrites, diffToOpSpec, isEffectiveDiff, planReconcile, reconcileMoc, revertDiffs,
  type MocBaseline, type MocFileNow, type NoteRefOf, type PlannedMoc, type ReconcileDiff, type ReconcileOptions, type SyncedMocBaseline,
} from './reconcile'
import { setMocOverrides } from './runtime'
import { blockPinsFromEdit, pinsFromDiffs, recordScottPins } from './scott-pins'
import { entryTargetFor } from './service'

/** 給畫面的提醒（翻譯鍵在 mocReconcile 底下）。 */
export interface ReconcileNotice {
  key: 'broken' | 'malformed' | 'repaired' | 'batch' | 'applied'
  values: Record<string, string | number>
}

export interface ReconcileRunResult {
  notices: ReconcileNotice[]
}

/** 整批檢查卡按下去時，檔案在那之後又被改過：先重新比對（卡片會更新），請 Scott 再確認一次。 */
export class MocBatchStale extends Error {
  constructor(readonly path: string) {
    super(`MOC 在確認前又被修改：${path}`)
    this.name = 'MocBatchStale'
  }
}

let state: { workspace: string, initialized: boolean, baselines: Map<string, MocBaseline> } | null = null
/** 同一次開 App 已經提醒過的（差異鍵＋行文字），不重複提醒。 */
const notified = new Set<string>()

async function workspacePath(): Promise<string> {
  const { default: useSettingStore } = await import('@/stores/setting')
  return useSettingStore.getState().workspacePath ?? ''
}

async function loadState() {
  const workspace = await workspacePath()
  if (state && state.workspace === workspace) return state
  const { mocSnapshotStore } = await import('@/db/moc-snapshots')
  const loaded = await mocSnapshotStore.load()
  state = { workspace, ...loaded }
  return state
}

async function saveBaselines(entries: ReadonlyMap<string, MocBaseline | null>): Promise<void> {
  const { mocSnapshotStore } = await import('@/db/moc-snapshots')
  await mocSnapshotStore.save(entries)
}

/** Fork（almanac ALMNC-85.4）：別台經 V3 同步傳來的上次已知狀態；V3 同步沒開或讀不到時是空的（照原本的比對）。 */
async function syncedBaselines(workspace: string): Promise<SyncedMocBaseline[]> {
  try {
    const [{ getDb }, { listSyncedMocBaselines }] = await Promise.all([import('@/db/index'), import('@/lib/almanac-sync/tables/moc')])
    return await listSyncedMocBaselines(await getDb(), workspace)
  } catch {
    return []
  }
}

function isMocNote(note: IndexedNote): boolean {
  const kind = note.frontmatter?.kind
  return typeof kind === 'string' && kind.trim().toLowerCase() === 'domain'
}

async function readMocFiles(notes: ReadonlyMap<string, IndexedNote>): Promise<MocFileNow[]> {
  const files: MocFileNow[] = []
  for (const note of notes.values()) {
    if (!isMocNote(note)) continue
    const raw = await readNote(note.path).catch(() => null)
    if (raw !== null) files.push({ path: note.path, raw })
  }
  return files
}

function mocIdOf(raw: string): string | undefined {
  return parseMoc(raw).id
}

function baseName(target: string): string {
  return (target.split('/').pop() ?? target).replace(/\.md$/i, '').trim().toLowerCase()
}

/** 連結解析、斷鏈依編號修回、收錄行的連結文字、筆記的編號與標題。 */
async function linkContext(notes: ReadonlyMap<string, IndexedNote>, withRecover: boolean): Promise<Omit<ReconcileOptions, 'path'> & { noteRef: NoteRefOf }> {
  const paths = [...notes.keys()]
  const lookup = buildLinkLookup(paths)
  const resolve = (target: string, mocPath: string) => {
    const path = resolveWikilinkTargetWithLookup(target, lookup, mocPath)
    return path && path !== mocPath && notes.has(path) ? path : null
  }
  const idOf = (path: string) => {
    const id = notes.get(path)?.frontmatter?.id
    return typeof id === 'string' && id.trim() ? id.trim() : undefined
  }
  const noteRef: NoteRefOf = path => {
    const noteId = idOf(path)
    const title = notes.get(path)?.frontmatter?.title
    return { ...(noteId ? { noteId } : {}), noteTitle: typeof title === 'string' && title.trim() ? title.trim() : (path.split('/').pop() ?? path).replace(/\.md$/i, '') }
  }
  let recover: ((target: string) => string | null) | undefined
  if (withRecover) {
    // 依編號索引：連結文字是某則筆記上次記下的檔名 → 那個 N 編號 → 現在帶這個編號的筆記。同名有好幾則時不猜。
    const { listIdIndex } = await import('@/db/id-index')
    const rows = await listIdIndex().catch(() => [])
    const byName = new Map<string, string[]>()
    for (const row of rows) {
      if (row.kind !== 'N' || !row.lastName) continue
      const key = row.lastName.toLowerCase()
      byName.set(key, [...(byName.get(key) ?? []), row.id])
    }
    const byId = new Map<string, string>()
    for (const path of paths) {
      const id = idOf(path)
      if (id) byId.set(id, path)
    }
    recover = target => {
      const ids = byName.get(baseName(target))
      return ids?.length === 1 ? byId.get(ids[0]) ?? null : null
    }
  }
  return { resolve, ...(recover ? { recover } : {}), targetFor: path => entryTargetFor(path, paths), noteRef }
}

function noticesOf(item: PlannedMoc): ReconcileNotice[] {
  const fresh = (diff: ReconcileDiff) => {
    const key = `${diff.id}|${diff.kind === 'malformed' ? diff.text : diff.kind === 'broken' ? diff.target : ''}`
    if (notified.has(key)) return false
    notified.add(key)
    return true
  }
  const moc = item.result.mocName
  const broken = item.result.diffs.filter(diff => diff.kind === 'broken' && !diff.repairedTo && fresh(diff)).length
  const malformed = item.result.diffs.filter(diff => diff.kind === 'malformed' && fresh(diff)).length
  const repaired = item.result.diffs.filter(diff => diff.kind === 'broken' && diff.repairedTo).length
  return [
    ...(repaired ? [{ key: 'repaired' as const, values: { moc, count: repaired } }] : []),
    ...(broken ? [{ key: 'broken' as const, values: { moc, count: broken } }] : []),
    ...(malformed ? [{ key: 'malformed' as const, values: { moc, count: malformed } }] : []),
  ]
}

/** 記下 Scott 直接生效的收錄修改（ops＋活動紀錄＋Scott 指定）。 */
async function recordDiffs(item: PlannedMoc, diffs: ReconcileDiff[], actual: string, batchId: string, noteRef: NoteRefOf): Promise<OpRecord[]> {
  const effective = diffs.filter(isEffectiveDiff)
  if (!effective.length) return []
  const { recordOps } = await import('@/lib/ops/runtime')
  const inputs: RecordInput[] = effective.map(diff => ({ spec: diffToOpSpec(diff, noteRef), after: { [item.path]: actual } }))
  const ops = await recordOps(inputs, { actor: 'scott', actorId: 'scott', batchId })
  await recordScottPins(pinsFromDiffs(effective, Date.now(), { opIds: ops.map(op => op.id), noteIdOf: path => noteRef(path).noteId }))
  return ops
}

function setBaseline(target: NonNullable<typeof state>, dirty: Map<string, MocBaseline | null>, item: PlannedMoc, content: string): void {
  const mocId = mocIdOf(content) ?? item.result.mocId
  const baseline = { content, ...(mocId ? { mocId } : {}) }
  const known = target.baselines.get(item.path)
  if (!item.movedFrom && known?.content === content && known.mocId === baseline.mocId) return
  target.baselines.set(item.path, baseline)
  dirty.set(item.path, baseline)
  if (item.movedFrom) {
    target.baselines.delete(item.movedFrom)
    dirty.set(item.movedFrom, null)
  }
}

/** 寫入（內容和 before 不同才寫）；寫不成回傳 null（下次再處理）。 */
async function writeMoc(path: string, before: string, after: string): Promise<string | null> {
  if (before === after) return before
  try {
    const [done] = await commitNoteWrites([{ path, before, after }], { requireExisting: true })
    return done?.after ?? null
  } catch (error) {
    console.warn('[moc] MOC 寫入跳過（下次再處理）：', path, error)
    return null
  }
}

/**
 * 比對一次：App 外改過的 MOC → 差異 → 直接生效或出整批檢查卡。筆記庫索引還沒準備好時不做事。
 * 之後由呼叫端接著重建 domains（runMocRebuild 會用這裡設定的 MOC 內容）。
 */
export async function runMocReconcile(): Promise<ReconcileRunResult> {
  const vault = useVaultIndexStore.getState()
  if (vault.status !== 'ready') return { notices: [] }
  const current = await loadState()
  const dirty = new Map<string, MocBaseline | null>()
  for (const path of applyAppWrites(current.baselines, takeAppWrites(), mocIdOf)) dirty.set(path, current.baselines.get(path) ?? null)

  const files = await readMocFiles(vault.notes)
  // Fork（almanac ALMNC-85.4）：檔案內容等於別台傳來的上次已知狀態 → 同步來的，不當成手動編輯（設計 2.11 第二層）。
  if (current.initialized && files.some(file => current.baselines.get(file.path)?.content !== file.raw)) {
    for (const [path, baseline] of adoptSyncedBaselines(current.baselines, files, await syncedBaselines(current.workspace), mocIdOf)) dirty.set(path, baseline)
  }
  const differs = current.initialized && files.some(file => current.baselines.get(file.path)?.content !== file.raw)
  const context = await linkContext(vault.notes, differs)
  const plan = planReconcile({ files, baselines: current.baselines, initialized: current.initialized, ...context })

  if (!current.initialized) {
    for (const file of plan.baselineOnly) {
      const mocId = mocIdOf(file.raw)
      const baseline = { content: file.raw, ...(mocId ? { mocId } : {}) }
      current.baselines.set(file.path, baseline)
      dirty.set(file.path, baseline)
    }
    current.initialized = true
    await saveBaselines(dirty)
    setMocOverrides(new Map())
    return { notices: [] }
  }

  const overrides = new Map<string, string | null>()
  const notices: ReconcileNotice[] = []
  const inBatch = (item: PlannedMoc) => plan.check.required && (item.result.diffs.some(isEffectiveDiff) || item.result.unseen)
  const pending = plan.changed.filter(inBatch)
  if (pending.length) {
    const store = useMocReconcileStore.getState()
    const isNew = !store.pending
    const { newBatchId } = await import('@/lib/ops/runtime')
    store.setPending({
      id: newBatchId(),
      at: Date.now(),
      reasons: plan.check.reasons,
      removals: plan.check.removals,
      mocs: pending,
      diffs: pending.flatMap(item => item.result.diffs.filter(isEffectiveDiff)),
      notices: pending.flatMap(item => item.result.diffs.filter(diff => !isEffectiveDiff(diff))),
    })
    for (const item of pending) overrides.set(item.path, item.old)
    if (isNew) notices.push({ key: 'batch', values: { mocs: pending.length, removals: plan.check.removals, changes: pending.reduce((sum, item) => sum + item.result.diffs.filter(isEffectiveDiff).length, 0) } })
  } else if (useMocReconcileStore.getState().pending) {
    useMocReconcileStore.getState().setPending(null)
  }

  const { newBatchId } = await import('@/lib/ops/runtime')
  const batchId = newBatchId()
  let applied = 0
  for (const item of plan.changed) {
    if (pending.includes(item)) continue
    const actual = await writeMoc(item.path, item.current, item.result.repaired)
    if (actual === null) continue
    applied += (await recordDiffs(item, item.result.diffs, actual, batchId, context.noteRef)).length
    // Fork（almanac ALMNC-69.11）：Scott 直接改了區塊（定位問題、從這裡開始、重點結論、待釐清）也標 Scott 指定。
    await recordScottPins(blockPinsFromEdit(item.old, actual, { mocPath: item.path, at: Date.now() }))
    setBaseline(current, dirty, item, item.result.effective)
    if (item.result.effective !== actual) overrides.set(item.path, item.result.effective)
    notices.push(...noticesOf(item))
  }
  if (applied) notices.push({ key: 'applied', values: { count: applied } })
  if (dirty.size) await saveBaselines(dirty).catch(error => console.warn('[moc] 上次已知狀態沒存成：', error))
  setMocOverrides(overrides)
  return { notices }
}

/**
 * 整批檢查卡：accept＝接受（卡上取消的那幾條反向套回檔案，其餘生效）；reject＝退回（全部反向套回檔案）。
 * 檔案在卡片出現後又被改過 → 丟 MocBatchStale（重新比對、卡片更新）。回傳復原（7 天內、以 ops 為準）。
 */
export async function settleMocBatch(mode: 'accept' | 'reject'): Promise<{ undo?: () => Promise<unknown>, applied: number, cancelled: number }> {
  const store = useMocReconcileStore.getState()
  const batch = store.pending
  if (!batch) return { applied: 0, cancelled: 0 }
  const cancelled = new Set(mode === 'reject' ? batch.diffs.map(diff => diff.id) : store.cancelled)
  const vault = useVaultIndexStore.getState()
  const current = await loadState()
  const context = await linkContext(vault.notes, false)
  for (const item of batch.mocs) {
    if (await readNote(item.path).catch(() => null) !== item.current) {
      await runMocReconcile()
      throw new MocBatchStale(item.path)
    }
  }

  const { newBatchId, recordOps, undoRecords, idOfContent, titleOfPath } = await import('@/lib/ops/runtime')
  const [{ newId }, { idExists }] = await Promise.all([import('@/lib/v3-model/identity'), import('@/db/id-index')])
  const batchId = newBatchId()
  const dirty = new Map<string, MocBaseline | null>()
  const ops: OpRecord[] = []
  let cancelledCount = 0
  for (const item of batch.mocs) {
    const revert = item.result.diffs.filter(diff => isEffectiveDiff(diff) && cancelled.has(diff.id))
    cancelledCount += revert.length
    let final = item.result.repaired
    if (revert.length) {
      const chapterId = parseMoc(final, item.path).unsorted ? '' : await newId('C', new Date(), { exists: idExists })
      final = revertDiffs(final, revert, { path: item.path, resolve: context.resolve, newChapterId: () => chapterId })
    }
    const actual = await writeMoc(item.path, item.current, final)
    if (actual === null) throw new MocBatchStale(item.path)
    const again = reconcileMoc(item.old, actual, { path: item.path, ...context })
    ops.push(...await recordDiffs(item, again.diffs, actual, batchId, context.noteRef))
    await recordScottPins(blockPinsFromEdit(item.old, actual, { mocPath: item.path, at: Date.now() }))
    if (mode === 'reject' && actual !== item.current) {
      // 退回本身也能復原：記成 MOC 全文的內容修改（復原＝寫回 Scott 存檔時的內容）。
      const mocId = idOfContent(item.current)
      ops.push(...await recordOps([{ spec: { kind: 'note.edit', ...(mocId ? { noteId: mocId } : {}), path: item.path, title: titleOfPath(item.path), before: item.current, after: actual } }], { actor: 'scott', actorId: 'scott', batchId }))
    }
    setBaseline(current, dirty, item, again.effective)
  }
  await saveBaselines(dirty).catch(error => console.warn('[moc] 上次已知狀態沒存成：', error))
  useMocReconcileStore.getState().setPending(null)
  await runMocReconcile()
  const { runMocRebuild } = await import('./runtime')
  await runMocRebuild()
  const undo = undoRecords(ops)
  return { ...(undo ? { undo } : {}), applied: batch.diffs.length - cancelledCount, cancelled: cancelledCount }
}

// Fork（almanac ALMNC-69.9）：ops 的流程——套用（applyOp）、記錄已完成的寫入（recordOps）、復原（undoOp／undoBatch）。
// I/O 全部注入（App 在 runtime.ts、測試在 testing.ts），這裡只串流程：
// - 每筆記下 payload（以編號描述）、inverse（反向操作）、base_versions（受影響檔案套用後的內容版本）。
// - 復原：7 天內、未復原過；先比對 base_versions 與目前檔案——都沒變才直接還原；有後續變更就不覆蓋，
//   回傳比較卡資料（還原後 vs 目前），Scott 選「仍要復原」時帶 force 再呼叫。還原後的內容由反向操作套在「目前」內容上算出，
//   所以 MOC 收錄的反向只動那一條（依編號），不會蓋掉之後新增的收錄。
// - 同一批（batch_id）整批復原時，每個檔案比對的是這一批最後一次動到它之後的版本。
import { applyActions, planOps, type OpsFs, type OpsWriter } from './execute'
import { inverseOf, touchesMoc } from './inverse'
import { contentVersion } from './version'
import { newOpId } from './ids'

export { newBatchId, newOpId } from './ids'
import { UNDO_WINDOW_MS, type CompareFile, type OpContext, type OpRecord, type OpSpec, type UndoResult, type UndoState } from './types'

/** ops 表（App：note.db；測試：記憶體）。 */
export interface OpsStore {
  /** 寫入；回傳帶 seq 的紀錄。 */
  insert: (records: ReadonlyArray<Omit<OpRecord, 'seq'>>) => Promise<OpRecord[]>
  get: (id: string) => Promise<OpRecord | null>
  listBatch: (batchId: string) => Promise<OpRecord[]>
  /** 依 id 讀（設定頁一次查一頁活動紀錄對應的操作）。 */
  getMany: (ids: readonly string[]) => Promise<OpRecord[]>
  markUndone: (ids: readonly string[], at: number) => Promise<void>
  /** 刪掉早於 before 的紀錄（超過 7 天不再提供復原），回傳刪了幾筆。 */
  prune: (before: number) => Promise<number>
}

export interface OpsDeps {
  fs: OpsFs
  writer: OpsWriter
  store: OpsStore
  now?: () => number
  newOpId?: () => string
  /** 套用或復原之後（例如動到 MOC 要重建 domains）。失敗不影響結果。 */
  afterChange?: (ops: readonly OpSpec[]) => Promise<void>
  /** 寫好之後的紀錄（活動紀錄等）。失敗不影響結果。 */
  onRecorded?: (records: readonly OpRecord[], context: OpContext) => Promise<void>
  onUndone?: (records: readonly OpRecord[]) => Promise<void>
}

/** 要記錄的已完成寫入：操作本身，加上它寫完後動到的檔案內容（沒給就從操作推：新增、修改、搬動、成立領域）。 */
export interface RecordInput {
  spec: OpSpec
  after?: Record<string, string | null>
}

/** 操作推得出的「寫完後」內容；MOC 收錄與搬動要由呼叫端給（MOC 寫完後的全文、搬到的位置的內容）。 */
export function impliedAfter(spec: OpSpec): Record<string, string | null> | null {
  switch (spec.kind) {
    case 'note.create':
    case 'domain.create':
      return { [spec.path]: spec.content }
    case 'note.delete':
    case 'domain.remove':
      return { [spec.path]: null }
    case 'note.edit':
      return { [spec.path]: spec.after }
    default:
      return null
  }
}

function versions(after: Record<string, string | null>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(after).map(([path, content]) => [path, contentVersion(content)]))
}

export function undoState(record: Pick<OpRecord, 'at' | 'undoneAt'>, now: number): UndoState {
  if (record.undoneAt !== null) return 'undone'
  return now - record.at < UNDO_WINDOW_MS ? 'undoable' : 'expired'
}

function order(records: readonly OpRecord[]): OpRecord[] {
  return [...records].sort((a, b) => a.at - b.at || a.seq - b.seq)
}

export function createOpsService(deps: OpsDeps) {
  const now = deps.now ?? Date.now
  const makeId = deps.newOpId ?? (() => newOpId(now()))

  async function settle(specs: readonly OpSpec[]) {
    if (!deps.afterChange || !specs.some(touchesMoc)) return
    await deps.afterChange(specs).catch(error => console.warn('[ops] afterChange failed', error))
  }

  async function save(entries: ReadonlyArray<{ spec: OpSpec, after: Record<string, string | null> }>, context: OpContext, notify = true): Promise<OpRecord[]> {
    if (!entries.length) return []
    const at = now()
    const rows = entries.map(({ spec, after }) => ({
      id: makeId(),
      at,
      actor: context.actor,
      ...(context.actorId ? { actorId: context.actorId } : {}),
      kind: spec.kind,
      payload: spec,
      inverse: inverseOf(spec),
      ...(context.proposalId ? { proposalId: context.proposalId } : {}),
      ...(context.batchId ? { batchId: context.batchId } : {}),
      baseVersions: versions(after),
      undoneAt: null,
    }))
    const records = await deps.store.insert(rows)
    if (notify) await deps.onRecorded?.(records, context).catch(error => console.warn('[ops] onRecorded failed', error))
    return records
  }

  /** 執行操作並記下來（Scott 親自觸發的結構操作、ALMNC-65.3 自動接受的補連結等）。 */
  async function applyOps(specs: readonly OpSpec[], context: OpContext, options?: { requireBefore?: boolean }): Promise<OpRecord[]> {
    const plan = await planOps(specs, deps.fs, options)
    const [action] = plan.actions
    if (options?.requireBefore && (plan.actions.length !== 1 || action.type !== 'write'
      || action.before === null || action.after === null || specs.length !== 1 || specs[0].kind !== 'note.edit')) {
      throw new Error('Expected one guarded edit to an existing note')
    }
    await applyActions(plan.actions, deps.writer)
    let records: OpRecord[] = []
    try {
      records = await save(plan.specs.map((spec, index) => ({ spec, after: plan.touched[index] ?? {} })), context, !options?.requireBefore)
      if (options?.requireBefore) {
        if (records.length !== 1) throw new Error('Missing undo record for automatic acceptance')
        await deps.onRecorded?.(records, context)
      }
    } catch (error) {
      // 自動接受需要有復原與活動紀錄。若記錄失敗，只在檔案仍是這次寫入的版本時還原。
      if (options?.requireBefore && action.type === 'write') {
        await deps.writer.write(action.path, action.after, action.before)
        if (records.length) await deps.store.markUndone(records.map(record => record.id), now())
      }
      throw error
    }
    await settle(specs)
    return records
  }

  /** 記下已經由既有流程寫好的操作（不再寫檔）。 */
  async function recordOps(inputs: readonly RecordInput[], context: OpContext): Promise<OpRecord[]> {
    const entries = inputs.flatMap(input => {
      const after = input.after ?? impliedAfter(input.spec)
      return after ? [{ spec: input.spec, after }] : []
    })
    return save(entries, context)
  }

  async function undoRecords(records: readonly OpRecord[], options: { force?: boolean }): Promise<UndoResult> {
    const pending = order(records).filter(record => record.undoneAt === null)
    if (!pending.length) return { status: 'already-undone' }
    const at = now()
    if (pending.some(record => undoState(record, at) === 'expired')) return { status: 'expired' }

    // 每個檔案比對這一批最後一次動到它之後的版本。
    const expected = new Map<string, string | null>()
    for (const record of pending) for (const [path, version] of Object.entries(record.baseVersions)) expected.set(path, version)
    const changed = new Set<string>()
    for (const [path, version] of expected) {
      if (contentVersion(await deps.fs.read(path)) !== version) changed.add(path)
    }

    const inverses = [...pending].reverse().map(record => record.inverse)
    const plan = await planOps(inverses, deps.fs)
    if (changed.size && !options.force) {
      const paths = [...new Set([...plan.final.keys(), ...changed])]
      const files: CompareFile[] = []
      for (const path of paths) {
        const current = await deps.fs.read(path)
        const restored = plan.final.has(path) ? plan.final.get(path) ?? null : current
        files.push({ path, restored, current, changed: changed.has(path) })
      }
      return { status: 'conflict', ops: pending, files }
    }
    await applyActions(plan.actions, deps.writer)
    await deps.store.markUndone(pending.map(record => record.id), at)
    const undone = pending.map(record => ({ ...record, undoneAt: at }))
    await settle(inverses)
    await deps.onUndone?.(undone).catch(error => console.warn('[ops] onUndone failed', error))
    return { status: 'undone', ops: undone }
  }

  /** 復原一筆。 */
  async function undoOp(id: string, options: { force?: boolean } = {}): Promise<UndoResult> {
    const record = await deps.store.get(id)
    if (!record) return { status: 'not-found' }
    return undoRecords([record], options)
  }

  /** 撤回這次整理：同一批全部復原（依相反順序）。 */
  async function undoBatch(batchId: string, options: { force?: boolean } = {}): Promise<UndoResult> {
    const records = await deps.store.listBatch(batchId)
    if (!records.length) return { status: 'not-found' }
    return undoRecords(records, options)
  }

  /** 清掉超過 7 天的紀錄（之後不再提供復原）。 */
  async function prune(): Promise<number> {
    return deps.store.prune(now() - UNDO_WINDOW_MS)
  }

  return { applyOps, recordOps, undoOp, undoBatch, prune }
}

export type OpsService = ReturnType<typeof createOpsService>

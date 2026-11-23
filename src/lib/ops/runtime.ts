// Fork（almanac ALMNC-69.9）：ops 的 App I/O——讀寫經 note-io 與編輯器協調寫入、編號經系統索引（id_index）解析、
// 紀錄存 note.db 的 ops 表；MOC 變動後重建筆記 domains；Scott 直接做的操作每筆記一筆活動紀錄（帶 op_id），復原記一筆 undone。
// 寫入端（檯面、工作台接受、收集提案、MOC 流程）與設定頁活動紀錄都經過這裡。之後的票（69.10、69.11、69.14、65.3）直接用
// applyOps／recordOps（帶 actor、proposalId、batchId）就有 7 天復原。
import type { ActivityEntryInput } from '@/lib/agent-memory/activity'
import { idOfContent, titleOfPath } from './refs'
import type { OpsFs, OpsWriter } from './execute'
import { describeOp, targetPathOf } from './inverse'
import { createOpsService, newBatchId, undoState, type OpsService, type RecordInput } from './service'
import type { OpContext, OpRecord, OpSpec, UndoResult, UndoState } from './types'

export { newBatchId, idOfContent, titleOfPath }

/** 立即復原（工作台 Z、確認列的「復原」）遇到後續變更：不覆蓋，請 Scott 到活動紀錄看比較卡。 */
export class OpsUndoConflict extends Error {
  constructor(readonly result: Extract<UndoResult, { status: 'conflict' }>) {
    super('OPS_UNDO_CONFLICT')
    this.name = 'OpsUndoConflict'
  }
}

export class OpsWriteConflict extends Error {
  constructor(readonly path: string) {
    super(`檔案在復原前已被修改：${path}`)
    this.name = 'OpsWriteConflict'
  }
}

function folderOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

function createAppFs(): OpsFs {
  return {
    read: async path => (await import('@/lib/daily/note-io')).readNote(path),
    resolveId: async id => (await (await import('@/db/id-index')).getIdEntry(id))?.path ?? null,
    paths: async () => {
      const { default: useVaultIndexStore } = await import('@/stores/vault-index')
      return [...useVaultIndexStore.getState().notes.keys()]
    },
    newId: async kind => {
      const [{ newId }, { idExists }] = await Promise.all([import('@/lib/v3-model/identity'), import('@/db/id-index')])
      return newId(kind, new Date(), { exists: idExists })
    },
  }
}

function createAppWriter(): OpsWriter {
  return {
    write: async (path, before, after) => {
      const [noteIo, { commitNoteWrites }] = await Promise.all([import('@/lib/daily/note-io'), import('@/lib/daily/coordinated-write')])
      if (before === null) {
        if (after !== null) await noteIo.writeNote(path, after, { createNew: true })
        return
      }
      if (after === null) {
        if (await noteIo.readNote(path) !== before) throw new OpsWriteConflict(path)
        await noteIo.removeNote(path)
        return
      }
      // 協調寫入：開著的那篇以編輯器內容為準，和 before 不同就丟 NoteWriteConflict，不覆蓋。
      await commitNoteWrites([{ path, before, after }], { requireExisting: true })
    },
    move: async (from, to) => {
      const [{ moveFileTool }, sources, idIndex] = await Promise.all([
        import('@/lib/agent/tools/note-tools'), import('@/db/v3-sources'), import('@/db/id-index'),
      ])
      const result = await moveFileTool.execute({ filePath: from, targetFolderPath: folderOf(to) })
      if (!result.success) throw new Error(result.error || 'move failed')
      await sources.renameNoteOutputs(from, to).catch(() => undefined)
      await idIndex.moveIdIndexPaths([{ sourcePath: from, targetPath: to }]).catch(() => undefined)
    },
  }
}

const ACTION_OF: Record<OpSpec['kind'], ActivityEntryInput['action']> = {
  'note.create': 'created',
  'note.delete': 'updated',
  'note.edit': 'updated',
  'note.move': 'updated',
  'moc.entry.add': 'linked',
  'moc.entry.remove': 'updated',
  'moc.entry.move': 'updated',
  'domain.create': 'created',
  'domain.remove': 'updated',
}

/** Scott 直接做的操作沒有提案；來源寫 op:<編號>（活動紀錄的來源只有對話、提案兩種，畫面顯示成「直接操作」）。 */
export function opSourceRef(record: Pick<OpRecord, 'id' | 'proposalId'>): string {
  return record.proposalId ?? `op:${record.id}`
}

function clip(text: string): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, 60).join('')
}

/** 一筆操作 → 活動紀錄的輸入（Scott 直接做的；夥伴的提案由接受時那一筆 accepted 帶 op_id）。 */
export function opActivityEntry(record: OpRecord): ActivityEntryInput | null {
  if (record.actor === 'system') return null
  const actorRole = record.actor
  const actorId = actorRole === 'scott' ? 'scott' : record.actorId || actorRole
  return {
    actorId,
    actorRole,
    action: ACTION_OF[record.kind],
    targetLink: `note:${encodeURI(targetPathOf(record.payload))}`,
    source: { kind: 'proposal', ref: opSourceRef(record) },
    note: clip(describeOp(record.payload)),
    opId: record.id,
  }
}

/** 復原 → 一筆 undone（Scott 按的；opId 指向被復原的第一筆，整批時說明加上筆數）。 */
export function undoneActivityEntry(records: readonly OpRecord[]): ActivityEntryInput | null {
  const [first] = records
  if (!first) return null
  const more = records.length > 1 ? ` +${records.length - 1}` : ''
  return {
    actorId: 'scott',
    actorRole: 'scott',
    action: 'undone',
    targetLink: `note:${encodeURI(targetPathOf(first.payload))}`,
    source: { kind: 'proposal', ref: opSourceRef(first) },
    note: clip(`${Array.from(describeOp(first.payload)).slice(0, 50).join('')}${more}`),
    opId: first.id,
  }
}

/** 預設：沒有提案、不是系統的操作（Scott 直接做的）每筆記一筆活動紀錄；提案由接受那一筆記。 */
export function shouldLogEach(context: OpContext & { logActivity?: boolean }): boolean {
  return context.logActivity ?? (!context.proposalId && context.actor !== 'system')
}

async function appendEntries(entries: ReadonlyArray<ActivityEntryInput | null>): Promise<void> {
  const { appendActivity } = await import('@/db/agent-memory')
  for (const entry of entries) {
    if (entry) await appendActivity('system', entry).catch(error => console.error('[ops] activity not logged:', error))
  }
}

let service: OpsService | null = null

export async function opsService(): Promise<OpsService> {
  if (service) return service
  const { opsStore } = await import('@/db/ops')
  service = createOpsService({
    fs: createAppFs(),
    writer: createAppWriter(),
    store: opsStore,
    afterChange: async () => {
      const { runMocRebuild } = await import('@/lib/moc/runtime')
      await runMocRebuild()
    },
    onRecorded: async (records, context) => {
      if (shouldLogEach(context)) await appendEntries(records.map(opActivityEntry))
    },
    onUndone: async records => appendEntries([undoneActivityEntry(records)]),
  })
  // 超過 7 天的不再提供復原：啟動時清掉。
  void service.prune().catch(error => console.debug('[ops] prune skipped:', error))
  return service
}

export type LoggedContext = OpContext & { logActivity?: boolean }

/** 記下已經寫好的操作；記不進去只記錯（寫入已經完成，不讓原本的動作失敗）。 */
export async function recordOps(inputs: readonly RecordInput[], context: LoggedContext): Promise<OpRecord[]> {
  if (!inputs.length) return []
  try {
    return await (await opsService()).recordOps(inputs, context)
  } catch (error) {
    console.error('[ops] record failed:', error)
    return []
  }
}

export async function applyOps(specs: readonly OpSpec[], context: LoggedContext): Promise<OpRecord[]> {
  return (await opsService()).applyOps(specs, context)
}

export async function undoOp(id: string, options: { force?: boolean } = {}): Promise<UndoResult> {
  return (await opsService()).undoOp(id, options)
}

export async function undoBatch(batchId: string, options: { force?: boolean } = {}): Promise<UndoResult> {
  return (await opsService()).undoBatch(batchId, options)
}

/** 立即復原用的閉包：復原這些紀錄（同一批就整批）；有後續變更時丟 OpsUndoConflict，不覆蓋。 */
export function undoRecords(records: readonly OpRecord[]): (() => Promise<boolean>) | undefined {
  if (!records.length) return undefined
  const batchId = records[0].batchId
  const sameBatch = batchId && records.every(record => record.batchId === batchId)
  return async () => {
    let result: UndoResult
    if (sameBatch) result = await undoBatch(batchId)
    else {
      result = { status: 'already-undone' }
      for (const record of [...records].reverse()) {
        result = await undoOp(record.id)
        if (result.status === 'conflict') break
      }
    }
    if (result.status === 'conflict') throw new OpsUndoConflict(result)
    return result.status === 'undone'
  }
}

export interface OpUiState {
  state: UndoState
  batchId?: string
  /** 同一批還能復原的筆數。 */
  batchSize: number
}

/** 設定頁：一頁活動紀錄對應的操作狀態（7 天內、未復原、同一批幾筆）。查不到（已清掉）的不在結果裡。 */
export async function opUiStates(ids: readonly string[], now = Date.now()): Promise<Map<string, OpUiState>> {
  const map = new Map<string, OpUiState>()
  if (!ids.length) return map
  const { opsStore } = await import('@/db/ops')
  const records = await opsStore.getMany(ids)
  const batches = new Map<string, OpRecord[]>()
  for (const record of records) {
    if (record.batchId && !batches.has(record.batchId)) batches.set(record.batchId, await opsStore.listBatch(record.batchId))
  }
  for (const record of records) {
    const batch = record.batchId ? batches.get(record.batchId) ?? [] : [record]
    map.set(record.id, {
      state: undoState(record, now),
      ...(record.batchId ? { batchId: record.batchId } : {}),
      batchSize: batch.filter(item => undoState(item, now) === 'undoable').length,
    })
  }
  return map
}

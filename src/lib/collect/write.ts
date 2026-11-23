// Fork（almanac ALMNC-8）：收下提案＝寫進既有位置，不新增資料表。
// 筆記 → 收件資料夾的新檔；任務、時段 → 今日日誌的「捕捉軌」區塊（時段是帶 ⏰ 的任務行，今日頁的時間軸讀得到）。
import { noteExists, readNote, revealInFileTree, writeNote } from '@/lib/daily/note-io'
import { commitNoteWrites } from '@/lib/daily/coordinated-write'
import { toDateKey } from '@/lib/daily/format'
import { ensureDailyNote } from '@/lib/daily/open-daily-note'
import { capturePath, noteFileName } from '@/lib/home/capture'
import { QUICK_ADD_SECTION, undoWrites, type WriteRecord } from '@/lib/today/today-actions'
import { insertLinesInSection } from '@/lib/today/today-model'
import { proposalNoteContent, proposalTaskLine } from './builders'
import { acceptSlot } from '@/lib/timeslots/apply'
import { writeV3NoteFields } from '@/lib/v3-model/note'
import { newId, type IdExists } from '@/lib/v3-model/identity'
import type { RecordIdInput } from '@/lib/v3-model/id-index'
import type { FileChange, Proposal } from './types'
import { snapshotInputs } from '@/lib/ops/refs'
import type { RecordInput } from '@/lib/ops/service'
import type { FileSnapshot } from '@/lib/ops/version'
import type { OpContext } from '@/lib/ops/types'

export interface AcceptResult {
  /** 寫入的檔案。 */
  path: string
  /** 任務、時段的復原資料；筆記沒有（檔案已出現在檔案樹，要刪從那裡刪）。 */
  record?: WriteRecord
}

/** Fork（almanac ALMNC-54.7）：檔案變更提案寫不進去（檔案在提案後被改過＝CONFLICT，或工具回報失敗）。 */
export class ChangeNotApplied extends Error {
  constructor(readonly conflict: boolean, detail?: string) {
    super(detail ?? (conflict ? 'CONFLICT' : 'change not applied'))
  }
}

export type ApplyChange = (change: FileChange) => Promise<void>

/**
 * 預設的檔案變更寫入：同背景任務草稿的審核（agent-tasks/review.ts applyDraft），用原本的工具照 args 寫入，
 * 寫入前比對提案當下的內容，被改過就不寫。動態載入工具表，收集頁的其他路徑不必連帶載入 agent。
 */
const defaultApplyChange: ApplyChange = async change => {
  const [{ applyDraft }, { agentToolRegistry }] = await Promise.all([
    import('@/lib/agent-tasks/review'),
    import('@/lib/agent/tool-registry'),
  ])
  const result = await applyDraft(
    { ...change, id: `proposal-${Date.now().toString(36)}`, state: 'pending' },
    { readFile: readNote, getTool: name => agentToolRegistry.getTool(name) },
  )
  if (result.state !== 'applied') throw new ChangeNotApplied(result.error === 'CONFLICT', result.error)
}

/** Fork（almanac ALMNC-54.12）：清理、確認、記憶稽核提案的寫入（多則筆記＋領域＋記憶，寫入前比對）。 */
export type ApplyEdits = (proposal: Proposal) => Promise<string[]>

const defaultApplyEdits = async (proposal: Proposal, onWritten?: (changes: FileSnapshot[]) => void) => {
  const [{ applyEdits }, { defaultEditIo }] = await Promise.all([import('@/lib/cleanup/apply'), import('@/lib/cleanup/apply-io')])
  return applyEdits(proposal, await defaultEditIo(), onWritten)
}

/** Fork（almanac ALMNC-69.1）：系統索引（id_index）——撞號檢查與登記。測試注入假的，預設動態載入 db。 */
export interface IdStore {
  exists: IdExists
  record: (input: RecordIdInput) => Promise<unknown>
}

const defaultIdStore: IdStore = {
  exists: async id => (await import('@/db/id-index')).idExists(id),
  record: async input => (await import('@/db/id-index')).recordId(input),
}

/**
 * Fork（almanac ALMNC-69.7）：把新筆記收進提案列的領域——寫進各領域 MOC 的「尚未分章」，再由重建更新 domains
 * （依提案的順序，第一個是主要領域）。測試注入假的，預設動態載入 lib/moc/runtime。
 */
export type AssignDomains = (notePath: string, domains: readonly string[], ops?: OpContext) => Promise<unknown>

const defaultAssignDomains: AssignDomains = async (notePath, domains, ops) => {
  const { assignNoteToDomains } = await import('@/lib/moc/runtime')
  return assignNoteToDomains(notePath, domains, ops ? { ops } : {})
}

/** Fork（almanac ALMNC-69.7）：清理提案（合併、取代）接受後，新筆記承接舊筆記的 MOC 收錄。測試注入假的。 */
export type TransferMemberships = (transfers: ReadonlyArray<{ from: string, to: string }>, ops?: OpContext) => Promise<unknown>

const defaultTransferMemberships: TransferMemberships = async (transfers, ops) => {
  const { transferNoteMemberships } = await import('@/lib/moc/runtime')
  return transferNoteMemberships(transfers, ops ? { ops } : {})
}

/**
 * Fork（almanac ALMNC-69.9）：把接受造成的寫入記成操作（ops 表；7 天內可復原、復原前做版本檢查）。測試注入假的，預設動態載入 lib/ops/runtime。
 * 記不進去只記錯，不讓接受失敗（寫入已經完成）。
 */
export type RecordOps = (inputs: RecordInput[], ops: OpContext) => Promise<unknown>

const defaultRecordOps: RecordOps = async (inputs, ops) => {
  const { recordOps } = await import('@/lib/ops/runtime')
  return recordOps(inputs, ops)
}

export async function acceptProposal(proposal: Proposal, options: { noteFolder: string, now?: Date, applyChange?: ApplyChange, applyEdits?: ApplyEdits, ids?: IdStore, assignDomains?: AssignDomains, transferMemberships?: TransferMemberships, ops?: OpContext, recordOps?: RecordOps }): Promise<AcceptResult> {
  const now = options.now ?? new Date()
  const ops = options.ops
  const record = async (inputs: RecordInput[]) => {
    if (!ops || !inputs.length) return
    await (options.recordOps ?? defaultRecordOps)(inputs, ops).catch(error => console.error('record ops failed', error))
  }
  if (proposal.mocBranch) {
    if (!ops?.proposalId) throw new ChangeNotApplied(false, 'MOC branching requires Workbench approval')
    const { applyMocBranch } = await import('@/lib/moc/branch-runtime')
    const result = await applyMocBranch(proposal.mocBranch, ops)
    return { path: result.path }
  }
  if (proposal.slot) return acceptSlot({ ...proposal, slot: proposal.slot }, now)
  // Fork（almanac ALMNC-69.3）：只貼日誌標籤的卡不寫筆記庫；標籤由 stores/collect 接受後寫進資料源。
  if (proposal.journalTag?.only) return { path: '' }
  if (proposal.edits?.length || proposal.domainEdits?.length || proposal.memoryEdits?.length) {
    const ids = options.ids ?? defaultIdStore
    const created: RecordIdInput[] = []
    const edits = proposal.mocReview && proposal.edits ? await Promise.all(proposal.edits.map(async edit => {
      if (edit.baseContent !== null) return edit
      const id = await newId('N', now, { exists: ids.exists })
      created.push({ id, kind: 'N', path: edit.path })
      return { ...edit, content: writeV3NoteFields(edit.content, { id }) }
    })) : proposal.edits
    const planned = edits === proposal.edits ? proposal : { ...proposal, edits }
    let snapshots: FileSnapshot[] = (edits ?? []).map(edit => ({ path: edit.path, before: edit.baseContent, after: edit.content }))
    const targets = options.applyEdits
      ? await options.applyEdits(planned)
      : await defaultApplyEdits(planned, actual => { snapshots = actual })
    await record(snapshotInputs(snapshots))
    for (const note of created) await ids.record(note).catch(error => console.error('id_index record failed', error))
    if (proposal.membershipTransfers?.length) {
      try {
        const transfer = options.transferMemberships ?? defaultTransferMemberships
        await (ops ? transfer(proposal.membershipTransfers, ops) : transfer(proposal.membershipTransfers))
      } catch (error) {
        // 筆記已寫好；MOC 承接失敗不讓接受失敗（Scott 可以在檯面歸入領域）。
        console.error('transfer memberships failed', error)
      }
    }
    return { path: proposal.edits?.[0]?.path ?? targets[0] ?? '' }
  }
  if (proposal.change) {
    const change = proposal.change
    const paths = [...new Set([change.path, ...(change.targetPath ? [change.targetPath] : [])])].filter(path => /\.md$/i.test(path))
    const read = (path: string) => readNote(path).catch(() => null)
    const before = ops ? await Promise.all(paths.map(read)) : []
    await (options.applyChange ?? defaultApplyChange)(change)
    if (ops) {
      const after = await Promise.all(paths.map(read))
      await record(snapshotInputs(paths.map((path, index) => ({ path, before: before[index], after: after[index] }))))
    }
    return { path: change.targetPath ?? change.path }
  }

  if (proposal.kind === 'note') {
    // Fork（almanac ALMNC-69.1）：檔名就是標題，同名才加序號；舊檔不改名。
    const name = noteFileName(proposal.title, now)
    // Fork（almanac ALMNC-54.21）：卡片上改過存放位置就寫到那裡。
    const folder = proposal.folder ?? options.noteFolder
    let path: string | null = null
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = capturePath(folder, name, attempt)
      if (await noteExists(candidate)) continue
      path = candidate
      break
    }
    if (!path) throw new Error('too many notes with the same name')
    // Fork（almanac ALMNC-54.12）：V3 筆記寫入時記下最後確認日期（重新確認的期限從這天起算）。
    const content = proposalNoteContent(proposal)
    // Fork（almanac ALMNC-69.1）：Scott 接受、檔案建立這一刻才產生 N 編號（草稿不佔編號），寫在 frontmatter 第一行，同時登記到系統索引。
    const ids = options.ids ?? defaultIdStore
    const id = await newId('N', now, { exists: ids.exists })
    const written = writeV3NoteFields(content, proposal.noteType ? { id, lastConfirmed: toDateKey(now) } : { id })
    await writeNote(path, written)
    await record([{ spec: { kind: 'note.create', noteId: id, path, title: proposal.title, content: written } }])
    try {
      await ids.record({ id, kind: 'N', path })
    } catch (error) {
      // 檔案已寫好、編號在檔案身上；索引登記失敗留給掃描補登（ALMNC-69.5），不讓接受失敗。
      console.error('id_index record failed', error)
    }
    if (proposal.domains?.length) {
      try {
        const assign = options.assignDomains ?? defaultAssignDomains
        await (ops ? assign(path, proposal.domains, ops) : assign(path, proposal.domains))
      } catch (error) {
        // 筆記已寫好；收不進 MOC 不讓接受失敗（Scott 可以在檯面再歸入領域）。
        console.error('assign domains failed', error)
      }
    }
    await revealInFileTree(path)
    return { path }
  }

  const { path } = await ensureDailyNote(now)
  const before = await readNote(path) ?? ''
  // Fork（ALMNC-21）：經編輯器協調寫入，日誌開著且有未存文字時把同一行插到最新內容
  const line = proposalTaskLine(proposal, toDateKey(now))
  const insert = (content: string) => insertLinesInSection(content, [line], QUICK_ADD_SECTION)
  const writes = await commitNoteWrites([{ path, before, after: insert(before), rebase: insert }])
  await record(snapshotInputs(writes))
  return { path, record: { writes } }
}

/** 復原任務、時段（檔案被別處改過就不動，回傳 false）。 */
export function undoAccepted(result: AcceptResult): Promise<boolean> {
  return result.record ? undoWrites(result.record) : Promise.resolve(false)
}

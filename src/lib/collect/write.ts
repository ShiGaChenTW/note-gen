// Fork（almanac ALMNC-8）：收下提案＝寫進既有位置，不新增資料表。
// 筆記 → 收件資料夾的新檔；任務、時段 → 今日日誌的「捕捉軌」區塊（時段是帶 ⏰ 的任務行，今日頁的時間軸讀得到）。
import { noteExists, readNote, revealInFileTree, writeNote } from '@/lib/daily/note-io'
import { commitNoteWrites } from '@/lib/daily/coordinated-write'
import { toDateKey } from '@/lib/daily/format'
import { ensureDailyNote } from '@/lib/daily/open-daily-note'
import { captureFileName, capturePath } from '@/lib/home/capture'
import { QUICK_ADD_SECTION, undoWrites, type WriteRecord } from '@/lib/today/today-actions'
import { insertLinesInSection } from '@/lib/today/today-model'
import { proposalNoteContent, proposalTaskLine } from './builders'
import { acceptSlot } from '@/lib/timeslots/apply'
import { writeV3NoteFields } from '@/lib/v3-model/note'
import type { FileChange, Proposal } from './types'

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

const defaultApplyEdits: ApplyEdits = async proposal => {
  const [{ applyEdits }, { defaultEditIo }] = await Promise.all([import('@/lib/cleanup/apply'), import('@/lib/cleanup/apply-io')])
  return applyEdits(proposal, await defaultEditIo())
}

export async function acceptProposal(proposal: Proposal, options: { noteFolder: string, now?: Date, applyChange?: ApplyChange, applyEdits?: ApplyEdits }): Promise<AcceptResult> {
  const now = options.now ?? new Date()
  if (proposal.slot) return acceptSlot({ ...proposal, slot: proposal.slot }, now)
  if (proposal.edits?.length || proposal.domainEdits?.length || proposal.memoryEdits?.length) {
    const targets = await (options.applyEdits ?? defaultApplyEdits)(proposal)
    return { path: proposal.edits?.[0]?.path ?? targets[0] ?? '' }
  }
  if (proposal.change) {
    await (options.applyChange ?? defaultApplyChange)(proposal.change)
    return { path: proposal.change.targetPath ?? proposal.change.path }
  }

  if (proposal.kind === 'note') {
    const name = captureFileName(proposal.title, now)
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
    await writeNote(path, proposal.noteType ? writeV3NoteFields(content, { lastConfirmed: toDateKey(now) }) : content)
    await revealInFileTree(path)
    return { path }
  }

  const { path } = await ensureDailyNote(now)
  const before = await readNote(path) ?? ''
  // Fork（ALMNC-21）：經編輯器協調寫入，日誌開著且有未存文字時把同一行插到最新內容
  const line = proposalTaskLine(proposal, toDateKey(now))
  const insert = (content: string) => insertLinesInSection(content, [line], QUICK_ADD_SECTION)
  const writes = await commitNoteWrites([{ path, before, after: insert(before), rebase: insert }])
  return { path, record: { writes } }
}

/** 復原任務、時段（檔案被別處改過就不動，回傳 false）。 */
export function undoAccepted(result: AcceptResult): Promise<boolean> {
  return result.record ? undoWrites(result.record) : Promise.resolve(false)
}

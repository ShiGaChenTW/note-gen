// Fork（almanac ALMNC-69.9）：以身分編號描述的操作（ops）。判斷規則提案第四節原則 3：
// 每個變更記成一筆可以反向執行的操作，例如「把 N-… 從 M-… 的 C-… 移除」；反向依編號執行，不靠清單位置。
// 路徑（path、notePath、mocPath）只是記錄當下的位置提示：執行時先用編號查系統索引（id_index），查不到才用提示。
import type { AgentRole } from '@/lib/agents/settings'

/** 誰發起：Scott 本人、某個夥伴角色、或系統（例如重建）。 */
export type OpActor = 'scott' | AgentRole | 'system'

/** 一般筆記（含日誌、MOC 以外任何筆記庫檔案）的建立。反向＝移除檔案。 */
export interface NoteCreateOp {
  kind: 'note.create'
  noteId?: string
  path: string
  title: string
  content: string
}

/** 移除檔案（新增筆記的反向）。反向＝依原內容建回來。 */
export interface NoteDeleteOp {
  kind: 'note.delete'
  noteId?: string
  path: string
  title: string
  content: string
}

/** 一般筆記內容修改。反向＝寫回前版本。 */
export interface NoteEditOp {
  kind: 'note.edit'
  noteId?: string
  path: string
  title: string
  before: string
  after: string
}

/** 搬到別的資料夾。反向＝搬回來。 */
export interface NoteMoveOp {
  kind: 'note.move'
  noteId?: string
  title: string
  from: string
  to: string
}

/** MOC 收錄共同欄位：N（筆記）、M（MOC）編號，以及畫面要用的名稱。 */
interface MocEntryRef {
  noteId?: string
  noteTitle: string
  /** 記錄當下筆記的路徑（noteId 查不到時用）。 */
  notePath: string
  mocId?: string
  mocName: string
  mocPath: string
}

/** 把 N 收進 M 的 C（沒有 C＝尚未分章）。反向＝從 M 移除 N。 */
export interface MocEntryAddOp extends MocEntryRef {
  kind: 'moc.entry.add'
  chapterId?: string
  relation?: string
  /** 這次加入時順便補了「尚未分章」那一組（C 編號＝chapterId）；反向移除後那一組空了就一起拿掉。 */
  createdChapter?: boolean
}

/** 把 N 從 M 移除（記下原本在哪一章、關係說明）。反向＝收回 C，關係說明照舊。 */
export interface MocEntryRemoveOp extends MocEntryRef {
  kind: 'moc.entry.remove'
  chapterId?: string
  relation?: string
  createdChapter?: boolean
}

/** 把 N 在 M 裡從 C1 搬到 C2。反向＝搬回 C1。 */
export interface MocEntryMoveOp extends MocEntryRef {
  kind: 'moc.entry.move'
  fromChapterId?: string
  toChapterId?: string
}

/** Fork（almanac ALMNC-69.10）：改 N 在 M 裡的關係說明（Scott 在 Obsidian 改的）。反向＝改回 before。 */
export interface MocEntryRelationOp extends MocEntryRef {
  kind: 'moc.entry.relation'
  chapterId?: string
  before: string
  after: string
}

/** Fork（almanac ALMNC-69.10）：章節改名（依 C 編號，不是刪章加章）。反向＝改回 before。 */
export interface MocChapterRenameOp {
  kind: 'moc.chapter.rename'
  mocId?: string
  mocName: string
  mocPath: string
  chapterId?: string
  before: string
  after: string
}

/** 成立領域：新建 MOC 檔。反向＝移除那個 MOC 檔。 */
export interface DomainCreateOp {
  kind: 'domain.create'
  mocId?: string
  name: string
  path: string
  content: string
}

/** 移除 MOC 檔（成立領域的反向）。 */
export interface DomainRemoveOp {
  kind: 'domain.remove'
  mocId?: string
  name: string
  path: string
  content: string
}

export type OpSpec =
  | NoteCreateOp | NoteDeleteOp | NoteEditOp | NoteMoveOp
  | MocEntryAddOp | MocEntryRemoveOp | MocEntryMoveOp | MocEntryRelationOp | MocChapterRenameOp
  | DomainCreateOp | DomainRemoveOp

export type OpKind = OpSpec['kind']

export const OP_KINDS: readonly OpKind[] = [
  'note.create', 'note.delete', 'note.edit', 'note.move',
  'moc.entry.add', 'moc.entry.remove', 'moc.entry.move', 'moc.entry.relation', 'moc.chapter.rename',
  'domain.create', 'domain.remove',
]

/** 發起的情境：誰、哪一則提案、同一批（「撤回這次整理」以這個為單位）。 */
export interface OpContext {
  actor: OpActor
  /** 夥伴的固定編號；Scott 是 'scott'。 */
  actorId?: string
  proposalId?: string
  batchId?: string
}

/** 存在 ops 表的一筆。 */
export interface OpRecord {
  id: string
  /** 寫入時間（UTC 毫秒）。 */
  at: number
  /** 同一毫秒內的先後（資料表 rowid）；記憶體版用插入順序。 */
  seq: number
  actor: OpActor
  actorId?: string
  kind: OpKind
  payload: OpSpec
  inverse: OpSpec
  proposalId?: string
  batchId?: string
  /** 受影響檔案套用後的內容版本（lib/ops/version contentVersion）；null＝套用後檔案不存在。 */
  baseVersions: Record<string, string | null>
  undoneAt: number | null
}

/** 7 天內、未復原過才能復原。 */
export const UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type UndoState = 'undoable' | 'expired' | 'undone'

/** 比較卡的一個檔案：還原後 vs 目前（null＝檔案不存在）。changed＝這個檔案在操作之後被改過。 */
export interface CompareFile {
  path: string
  restored: string | null
  current: string | null
  changed: boolean
}

export type UndoResult =
  | { status: 'undone', ops: OpRecord[] }
  /** 受影響的檔案在那之後被改過：不覆蓋，回傳比較卡資料；Scott 選「仍要復原」時帶 force 再呼叫一次。 */
  | { status: 'conflict', ops: OpRecord[], files: CompareFile[] }
  | { status: 'expired' | 'already-undone' | 'not-found' }

import type { SlotTarget } from '@/lib/timeslots/model'
import type { NoteType } from '@/lib/v3-model/note'

// Fork（almanac ALMNC-8）：收集頁的資料型別。全是純資料，不碰 I/O，方便單元測試。

export type InputKind = 'text' | 'link' | 'image' | 'file'

/** 使用者丟進收集框的一筆東西。image 帶 data URL 時，AI 可用的話會一起看圖。 */
export interface CollectInput {
  kind: InputKind
  /** 文字內容、連結網址；圖片與檔案放使用者補充的說明（可空）。 */
  text: string
  /** 圖片、檔案的檔名。 */
  name?: string
  imageDataUrl?: string
}

export type ProposalKind = 'note' | 'task' | 'event'

/** 一條提案：收下才會寫入，寫到哪裡由 kind 決定（筆記檔、今日日誌的任務行、今日日誌的帶時間任務行）。 */
export interface Proposal {
  id: string
  kind: ProposalKind
  title: string
  /** 筆記內文；任務與時段通常為空。 */
  body: string
  /** YYYY-MM-DD；沒有日期為空字串。 */
  due: string
  /** HH:mm；只有 event 一定有。 */
  time: string
  /** 不含 #。 */
  tags: string[]
  /** Scheduler proposal for an existing task in the daily note. */
  slot?: SlotTarget
  /** Fork（almanac ALMNC-54.5）：產生這則提案的對話 id；收集頁直接拆出來的沒有。 */
  conversationId?: number
  /** Fork（almanac ALMNC-54.5）：指揮官依「再次討論」修改後重新提出時，被取代的那則提案（工作台項目 key）。 */
  previousProposalId?: string
  // Fork（almanac ALMNC-54.6）：指揮官分析資料源產生的提案才有下面這些欄位。
  /** 來源資料源 id；接受後才寫進 source_outputs 連結表與筆記 frontmatter 的 sources。 */
  sourceIds?: string[]
  /** 筆記類型（知識／紀錄／專案）；只有 note 會有。 */
  noteType?: NoteType
  /** 所屬領域 id；只有 note 會有。 */
  domains?: string[]
  /** 相關的人。 */
  people?: string[]
  /** 所屬專案。 */
  project?: string
  /** 撰寫草稿的角色（C1 專家／C2 指揮官／C3 秘書）與它的固定編號。 */
  drafter?: { role: 'commander' | 'expert' | 'secretary', agentId?: string }
  /**
   * Fork（almanac ALMNC-54.7）：右側欄指揮官想改的既有檔案（新增、修改、刪除、搬移、複製、新增資料夾）。
   * 有這個欄位時 kind 一律是 note，接受時用原本的工具照 args 寫入（同背景任務的草稿審核），寫入前先比對衝突。
   */
  change?: FileChange
}

/** Fork（almanac ALMNC-54.7）：一筆還沒寫入的檔案變更。欄位同背景任務的草稿（agent-tasks/types.ts DraftChange）。 */
export interface FileChange {
  toolName: string
  args: Record<string, unknown>
  kind: 'create' | 'update' | 'delete' | 'move' | 'copy' | 'folder'
  path: string
  targetPath?: string
  /** 新增或修改後的完整內容。 */
  content?: string
  /** 提案當下的原內容；null 表示當時檔案不存在。 */
  baseContent: string | null
  summary: string
}

export type SplitSource = 'ai' | 'rules'

export interface SplitResult {
  proposals: Proposal[]
  source: SplitSource
}

/** 問模型：給 prompt（與可選的圖片），回傳模型的原始文字。注入進來所以拆分邏輯能在沒有 AI 時測試。 */
export type AskModel = (prompt: string, imageDataUrl?: string) => Promise<string>

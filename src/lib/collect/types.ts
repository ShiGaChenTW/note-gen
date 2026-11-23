import type { SlotTarget } from '@/lib/timeslots/model'
import type { MocChange } from '@/lib/moc/edit'
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
  /** Fork（almanac ALMNC-54.21）：新增筆記要存的資料夾（Scott 在工作台卡片上改的）；沒有就是收件資料夾，'' 是筆記庫最上層。 */
  folder?: string
  /**
   * Fork（almanac ALMNC-69.2）：新增筆記的原建議標題與位置——Scott 第一次在卡片上改標題或位置時記下，之後再改不覆蓋。
   * folder 沒有就是收件資料夾（同上面的 folder）。用來在卡片上、接受後與活動紀錄裡說明「原建議 → 你的修改」。
   */
  suggested?: { title: string, folder?: string }
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
  /** Fork（almanac ALMNC-69.3）：指揮官對這個片段的判斷理由（一行）與信心。 */
  rationale?: { reason?: string, confidence?: 'high' | 'low' }
  /**
   * Fork（almanac ALMNC-69.3）：指揮官「判斷為日誌」——掛在這則資料源的分析結果上，卡片顯示一行，Scott 接受時一起替 sourceIds 貼上日誌標籤。
   * only：這則資料源除了貼標籤沒有其他產出，這張卡接受時只貼標籤、不寫筆記。
   */
  journalTag?: { confidence: 'high' | 'low', reason?: string, only?: boolean }
  /** 撰寫草稿的角色（C1 專家／C2 指揮官／C3 秘書）與它的固定編號。 */
  drafter?: { role: 'commander' | 'expert' | 'secretary', agentId?: string }
  /**
   * Fork（almanac ALMNC-54.7）：右側欄指揮官想改的既有檔案（新增、修改、刪除、搬移、複製、新增資料夾）。
   * 有這個欄位時 kind 一律是 note，接受時用原本的工具照 args 寫入（同背景任務的草稿審核），寫入前先比對衝突。
   */
  change?: FileChange
  // Fork（almanac ALMNC-54.12）：清理提案與確認提案——一次改好幾則筆記（寫入前逐一比對提案當下的內容，全部沒被改過才寫）。
  /** 筆記變更（修改、標狀態、補情境、合併、取代時新增的筆記）。有這個欄位時接受不另外新增筆記。 */
  edits?: NoteEdit[]
  /** 領域的變更（例如在總覽的「矛盾與未解問題」加一條）。 */
  domainEdits?: DomainEdit[]
  /**
   * Fork（almanac ALMNC-69.7）：合併、取代時的領域承接——接受後由 to（合併留下的、取代的新筆記）承接 from 在各 MOC 的正式收錄
   * （lib/moc transferMemberships）。domains 不再寫進新筆記的 frontmatter。
   */
  membershipTransfers?: Array<{ from: string, to: string }>
  /** Fork（almanac ALMNC-54.13）：記憶稽核——刪掉工作筆記或目前脈絡裡和筆記重疊的內容（Scott 接受＝Scott 本人寫入）。 */
  memoryEdits?: MemoryEdit[]
  /** 工作台卡片的標籤與動詞（沒有就照種類推）。 */
  card?: ProposalCardHint
  /** 清理提案：這一則涵蓋哪些處理方式、屬於哪個領域、是不是立刻提出（衝突或錯誤）。 */
  cleanup?: { domainId?: string, actions: CleanupActionName[], immediate: boolean }
  /** 同批項目在工作台合為一張每週 MOC 整理卡。 */
  mocReview?: { name: string, week: string }
  /** Fork（almanac ALMNC-54.13）：每週回顧（時期回顧）提案：時期（例如「11 月第 3 週」）與時期鍵。 */
  review?: { period: string, periodKey: string }
}

/** Fork（almanac ALMNC-54.12）：修改、取代、待查證、補情境、合併、封存。 */
export type CleanupActionName = 'modify' | 'replace' | 'verify' | 'supplement' | 'merge' | 'archive'

/** Fork（almanac ALMNC-54.12）：卡片標籤與動詞（值同 lib/workbench/cards.ts 的 CardLabel／CardVerb）。 */
export interface ProposalCardHint {
  label: 'schedule' | 'note' | 'knowledge' | 'source' | 'review'
  verb: 'add' | 'supplement' | 'modify' | 'merge' | 'replace' | 'verify' | 'archive' | 'reschedule' | 'judge' | 'confirm' | 'organize'
}

/** Fork（almanac ALMNC-54.12）：一則筆記的完整新內容。baseContent 是提案當下的原文；null＝新增的筆記（當時不存在）。 */
export interface NoteEdit {
  moc?: { id: string, change: MocChange }
  path: string
  baseContent: string | null
  content: string
  summary: string
}

/** Fork（almanac ALMNC-54.12）：領域總覽改寫；baseOverview 是提案當下的總覽。 */
export interface DomainEdit {
  domainId: string
  baseOverview: string
  overview: string
  summary: string
}

/** Fork（almanac ALMNC-54.13）：記憶稽核的刪除。base 是提案當下的內容，被改過就不寫。 */
export type MemoryEdit =
  | { target: 'work_notes' | 'rules', agent: { id: string, name: string, role: 'commander' | 'expert' | 'secretary' | 'researcher', domain?: string }, baseContent: string, content: string, summary: string }
  | { target: 'context', baseContext: { projects: Array<{ title: string, link?: string }>, weeklyFocus: Array<{ title: string, link?: string }>, people: string[] }, context: { projects: Array<{ title: string, link?: string }>, weeklyFocus: Array<{ title: string, link?: string }>, people: string[] }, summary: string }

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

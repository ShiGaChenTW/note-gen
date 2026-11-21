// Fork（almanac ALMNC-54.6）：指揮官分析流程（C0）的資料型別。
// 規格見 almanac/2026-11-19_proposal_role-data-model.md 第零節（C0 是唯一的匯集點）、第二節「指揮官的分析流程」。
// 每一步都是注入依賴的函式；模型、OCR、抓網頁、轉逐字稿、資料庫都從外面給，測試用假的。
import type { Domain } from '@/lib/v3-model/domain'
import type { NoteType } from '@/lib/v3-model/note'
import type { Source, SourceStatus } from '@/lib/v3-model/source'
import type { AgentRole } from '@/lib/agents/settings'
import type { Proposal } from '@/lib/collect/types'

/** 問模型：給 prompt，回傳模型的原始文字。 */
export type AskModel = (prompt: string) => Promise<string>

// ── 1. 轉文字 ────────────────────────────────────────────────

/** 哪一種轉換器跑過：none＝原本就是文字。 */
export type ConverterName = 'none' | 'ocr' | 'web' | 'transcription' | 'file'

/**
 * text：原本就是文字；converted：轉換成功；
 * unavailable：轉換器沒設定（例如沒裝 OCR、沒設語音模型），保留原檔；failed：轉換器跑了但失敗，保留原檔。
 */
export type ConversionStatus = 'text' | 'converted' | 'unavailable' | 'failed'

export interface ConversionResult {
  text: string
  converter: ConverterName
  status: ConversionStatus
  /** 失敗原因、截短說明等，給提案與紀錄看。 */
  note?: string
}

/** 轉換器沒設定時丟這個錯，toText 會標成 unavailable（不是 failed）。 */
export class ConverterUnavailableError extends Error {
  constructor(message = 'converter unavailable') {
    super(message)
    this.name = 'ConverterUnavailableError'
  }
}

/**
 * 既有的轉換工具包成的介面。少了哪一個就當成沒設定。
 * ref 是原檔參照：檔案路徑、data URL 或網址。
 */
export interface Converters {
  /** 截圖辨識文字（src/lib/image-recognition.ts：VLM → OCR）。 */
  ocrImage?: (ref: string) => Promise<string>
  /** 網頁抓全文（src/lib/web-capture）。 */
  fetchWeb?: (url: string) => Promise<string>
  /** 錄音轉逐字稿（src/lib/audio.ts transcribeRecording）。 */
  transcribe?: (ref: string) => Promise<string>
  /** 讀文字檔。 */
  readFileText?: (ref: string) => Promise<string>
}

// ── 2. 拆開與判斷 ────────────────────────────────────────────

/** 行程、任務、筆記，或不採用。 */
export type FragmentKind = 'event' | 'task' | 'note' | 'reject'

export interface Fragment {
  /** 在這則資料源裡的順序，從 0 開始。 */
  index: number
  kind: FragmentKind
  /** 只有 note 有。 */
  noteType?: NoteType
  title: string
  body: string
  /** YYYY-MM-DD。 */
  date?: string
  /** HH:mm；只有 event 一定有。 */
  time?: string
  people: string[]
  project?: string
  /** 模型猜的領域名稱（知識片段才有意義），用來找專家與累積「未歸屬」的主題。 */
  domainHint?: string
  tags: string[]
  /** 不採用的理由。 */
  reason?: string
  /** 模型輸出壞掉時的保底片段：整則原文原封不動放在 body。 */
  fallback?: boolean
}

// ── 3. 分派 ──────────────────────────────────────────────────

/** C1 專家撰寫、C2 指揮官撰寫、C3 秘書整理；reject 不撰寫，只記成「不採用」。 */
export type Lane = 'C1' | 'C2' | 'C3' | 'reject'

/** 分派需要的角色資訊（src/lib/agents/settings.ts 的 AgentSettings 子集）。 */
export interface RosterAgent {
  id: string
  name: string
  role: AgentRole
  domain?: string
  enabled: boolean
}

export interface Assignment {
  fragment: Fragment
  lane: Lane
  /** 負責撰寫的角色編號；名單裡沒有該角色時為空（仍照 lane 撰寫）。 */
  agentId?: string
  /** 對到的領域 id（領域表裡有的才有）。 */
  domainId?: string
}

// ── 4. 撰寫 ──────────────────────────────────────────────────

export interface SimilarNote {
  path: string
  title: string
}

export interface Draft {
  fragment: Fragment
  lane: Exclude<Lane, 'reject'>
  role: 'commander' | 'expert' | 'secretary'
  agentId?: string
  kind: 'note' | 'task' | 'event'
  noteType?: NoteType
  title: string
  body: string
  date?: string
  time?: string
  people: string[]
  project?: string
  domainIds: string[]
  tags: string[]
  meta: {
    /** ai＝模型寫的；fallback＝模型失敗或漏寫，直接用片段內容。 */
    writtenBy: 'ai' | 'fallback'
    /**
     * 專家比對的類似筆記。'unavailable'＝找類似筆記的工具沒接上或失敗，不假裝比對過。
     * Fork（almanac ALMNC-54.12）：預設由 lib/cleanup/similar.ts（筆記庫索引＋知識搜尋）提供。
     */
    similarNotes?: SimilarNote[] | 'unavailable'
  }
}

// ── 5. 統整 ──────────────────────────────────────────────────

/** 交給工作台的一批提案（目前存成收集項目，工作台由 lib/decide/project.ts 投影出來）。 */
export interface ProposalBatch {
  id: string
  origin: string
  proposals: Proposal[]
  conversationId?: number
}

/** 畫面文字由呼叫端依語系提供（messages 的 commander 命名空間）。 */
export interface CommanderLabels {
  /** 工作台上「來自…」顯示的來源名稱。 */
  origin: (input: { agent: string, source: string }) => string
  /** 轉不出文字時放進片段內文的說明。 */
  unconverted: (input: { origin: string }) => string
}

// ── 6. 整條流程 ──────────────────────────────────────────────

export interface SourceStore {
  get: (id: string) => Promise<Source | undefined>
  setStatus: (id: string, to: SourceStatus) => Promise<Source>
  list: (options: { status: SourceStatus, limit?: number }) => Promise<Source[]>
}

export interface CommanderDeps {
  sources: SourceStore
  converters: Converters
  ask: AskModel
  roster: () => Promise<RosterAgent[]>
  domains: () => Promise<Domain[]>
  /** 角色的工作指示＋個別記憶（ALMNC-54.3 的 loadAgentMemoryPrompt）。 */
  agentPrompt: (agent: RosterAgent | undefined, role: Draft['role']) => Promise<string>
  /** 依領域找類似筆記；沒有就標成 unavailable。 */
  findSimilarNotes?: (domainId: string | undefined, fragment: Fragment) => Promise<SimilarNote[]>
  /** 把提案送到工作台。只放進「等 Scott 決定」，不寫筆記庫。 */
  submitProposals: (batch: ProposalBatch) => Promise<void>
  /** 活動紀錄；失敗不影響分析。 */
  logActivity?: (entry: { sourceId: string, batchId?: string, status: SourceStatus, note: string }) => Promise<void>
  labels: CommanderLabels
  now?: () => Date
  /** Fork（almanac ALMNC-54.10）：Scott 選了「照建議處理」時的初步判斷；沒有就回傳 undefined。失敗不影響分析。 */
  sourceHint?: (sourceId: string) => Promise<string | undefined>
}

export interface AnalyzeOptions {
  /** 從處理對話送來分析時，那段對話的 id；提案會記住它。 */
  conversationId?: number
}

export type AnalyzeResult =
  | { status: 'skipped', sourceId: string, reason: 'not_found' | 'not_pending' }
  | {
      status: 'analyzed' | 'rejected'
      sourceId: string
      conversion: ConversionResult
      fragments: Fragment[]
      assignments: Assignment[]
      drafts: Draft[]
      /** 判斷為不採用的片段；不產生草稿或提案，只記錄。 */
      rejected: Fragment[]
      batch?: ProposalBatch
    }

// Fork（almanac ALMNC-54.12）：衝突偵測與清理提案的資料型別。
// 規格見 almanac/2026-11-19_proposal_role-data-model.md 第一節 §4「衝突與清理」。
// 流程：專家發現（只讀，只提出觀察）→ 指揮官接手（必要時查外部資料）→ 提案 → Scott 決定 → 筆記狀態改變、領域同步更新。
import type { CleanupActionName } from '@/lib/collect/types'
import type { V3NoteFields } from '@/lib/v3-model/note'

/** 過時、矛盾、情境不同、重複，加上指揮官判斷「已經沒用」的封存。 */
export const CONFLICT_TYPES = ['outdated', 'contradiction', 'context', 'duplicate', 'obsolete'] as const
export type ConflictType = typeof CONFLICT_TYPES[number]

export type CleanupAction = CleanupActionName
export const CLEANUP_ACTIONS: readonly CleanupAction[] = ['modify', 'replace', 'verify', 'supplement', 'merge', 'archive']

/**
 * 發現時機：written＝接受提案、新筆記寫入後；handwritten＝Scott 在檯面存了親手寫的筆記；
 * periodic＝定期檢查（最後確認日期超過領域的期限）；review＝專家回顧領域（G2）；recheck＝確認卡「交給指揮官」。
 */
export type ConflictTrigger = 'written' | 'handwritten' | 'periodic' | 'review' | 'recheck'

/** 比對用的筆記：路徑、標題、V3 欄位、原文與內文。 */
export interface NoteText {
  path: string
  title: string
  raw: string
  body: string
  fields: V3NoteFields
}

/** 指揮官查到的外部資料（研究員的工具）；只當證據，不直接寫進筆記。 */
export interface ExternalEvidence {
  title: string
  url: string
  snippet: string
}

/** 專家（或指揮官重新確認時）提出的一個觀察。專家只讀、只提出觀察；怎麼處理由指揮官決定。 */
export interface ConflictObservation {
  type: ConflictType
  /**
   * 牽涉的筆記。過時：第一則是過時的那則，第二則（有的話）是較新的；重複：第一則是保留的那則；
   * 矛盾、情境不同：兩則都會被標記。
   */
  notePaths: string[]
  /** 證據：哪裡說法不同、為什麼過時。 */
  evidence: string
  /** 過時才有意義：結論改變（取代）還是只有事實細節變了（修改）。 */
  conclusionChanged?: boolean
  /** 修改、取代、合併時模型提供的新內文（Markdown，不含 frontmatter）。 */
  revisedBody?: string
  /** 補情境：每則筆記的適用條件（路徑 → 一句話）。 */
  contexts?: Record<string, string>
  /** 外部資料的網址（指揮官查證時）。 */
  externalUrls?: string[]
  domainId?: string
  by?: { role: 'expert' | 'commander' | 'researcher', agentId?: string }
  trigger: ConflictTrigger
}

/** 一次比對：新筆記（或到期的筆記）對上同領域的類似筆記。模型藏在這個介面後面，測試用假的。 */
export type ConflictDetector = (note: NoteText, candidates: readonly NoteText[], options: DetectOptions) => Promise<ConflictObservation[]>

export interface DetectOptions {
  trigger: ConflictTrigger
  domainId?: string
  by?: ConflictObservation['by']
  /** 專家的工作指示＋個別記憶。 */
  agentPrompt?: string
  external?: readonly ExternalEvidence[]
  /** 使用整份 MOC 索引時，指定這組觀察的起點路徑。 */
  anchor?: string
}

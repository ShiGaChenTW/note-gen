// Fork（almanac ALMNC-54.1）：V3 資料三層架構的第一層「資料源」——型別、狀態流轉、送出鎖定、改版與封存規則。
// 規格見 almanac/2026-11-19_proposal_role-data-model.md 第一節 §1；術語見 almanac/GLOSSARY.md「資料源」。
// 這裡全是純函式，SQL 放在 src/db/v3-sources.ts。

/** 三大來源：外部擷取、自己寫的、系統產生的。 */
export type SourceType = 'external' | 'self' | 'system'

/** 內容形式（文字、連結、截圖…），只做標示，不影響流程。 */
export type SourceKind = 'text' | 'link' | 'image' | 'file' | 'transcript' | 'email' | 'voice' | (string & {})

/**
 * 等你決定（只有外部擷取）→ 待分析 → 分析中 → 已分析／不採用。
 * 「封存」不是狀態，而是 archivedAt 有值；封存後狀態仍是 rejected，資料不刪除。
 */
export type SourceStatus = 'awaiting_decision' | 'pending_analysis' | 'analyzing' | 'analyzed' | 'rejected'

export const SOURCE_TYPES: readonly SourceType[] = ['external', 'self', 'system']
export const SOURCE_STATUSES: readonly SourceStatus[] = ['awaiting_decision', 'pending_analysis', 'analyzing', 'analyzed', 'rejected']

export interface Source {
  id: string
  sourceType: SourceType
  kind: SourceKind
  /** 原始內容；送出（lockedAt 有值）後不再原地修改。 */
  content: string
  /** 來處：網址、檔名或對話參照。 */
  origin?: string
  collectedAt: number
  /** 收集者：scott 或代理人名稱。 */
  collector: string
  status: SourceStatus
  /** 狀態最後一次改變的時間；30 天封存從進入 rejected 的這一刻起算。 */
  statusChangedAt: number
  /** 版本號，第一版是 1。 */
  version: number
  /** 上一版的 id；第一版沒有。 */
  previousId?: string
  lockedAt?: number
  archivedAt?: number
  createdAt: number
  updatedAt: number
  /**
   * Fork（almanac ALMNC-69.3）：日誌標籤——Scott 親手寫的事件記錄，原文不拆、不搬，仍可抽出知識。
   * 舊資料沒有這個欄位（false）。有標籤的資料源不會被轉成不採用，讀過沒有內容就停在已分析。
   */
  journal: boolean
}

/** 不採用的資料源保留多久後自動封存。 */
export const REJECTED_ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000

const TRANSITIONS: Record<SourceStatus, readonly SourceStatus[]> = {
  awaiting_decision: ['pending_analysis', 'rejected'],
  pending_analysis: ['analyzing'],
  // 分析中斷時退回待分析重排，不算新的決定。
  analyzing: ['analyzed', 'rejected', 'pending_analysis'],
  analyzed: [],
  // Fork（almanac ALMNC-54.8）：工作台資料源分頁的「改回等你決定」（v14）；只有還沒送出（未鎖定）的外部擷取才能改回，見 transitionSource。
  rejected: ['awaiting_decision'],
}

export function initialStatus(sourceType: SourceType): SourceStatus {
  return sourceType === 'external' ? 'awaiting_decision' : 'pending_analysis'
}

export function canTransition(from: SourceStatus, to: SourceStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isSourceType(value: unknown): value is SourceType {
  return typeof value === 'string' && (SOURCE_TYPES as readonly string[]).includes(value)
}

export function isSourceStatus(value: unknown): value is SourceStatus {
  return typeof value === 'string' && (SOURCE_STATUSES as readonly string[]).includes(value)
}

export function isLocked(source: Pick<Source, 'lockedAt'>): boolean {
  return source.lockedAt !== undefined
}

export interface NewSourceInput {
  id: string
  sourceType: SourceType
  kind: SourceKind
  content: string
  origin?: string
  collector: string
  /** 預設等於 now。 */
  collectedAt?: number
  /** Fork（almanac ALMNC-69.3）：Scott 在新增資料源時勾了「這是日誌」。 */
  journal?: boolean
}

/**
 * 建立第一版資料源。自己寫的與系統產生的一進來就交給指揮官分析，等於已送出，所以直接鎖定；
 * 外部擷取的先等 Scott 決定，送出前是可修改的草稿。
 */
export function createSource(input: NewSourceInput, now: number): Source {
  const status = initialStatus(input.sourceType)
  return {
    id: input.id,
    sourceType: input.sourceType,
    kind: input.kind,
    content: input.content,
    origin: input.origin || undefined,
    collectedAt: input.collectedAt ?? now,
    collector: input.collector,
    status,
    statusChangedAt: now,
    version: 1,
    previousId: undefined,
    lockedAt: status === 'pending_analysis' ? now : undefined,
    archivedAt: undefined,
    createdAt: now,
    updatedAt: now,
    journal: input.journal === true,
  }
}

// Fork（almanac ALMNC-54.14）：舊筆記（R3）。上線時整批「標成」資料源：一則舊筆記一列，內容只存 vault 相對路徑（參照），
// 不複製全文（上千則筆記不必在 SQLite 裡再存一份；分析時才讀檔）。來源類型是「自己寫的」（Scott 自己寫的舊筆記），
// 但不照 R2 自動分析：R3 規定合成一張卡、按一次才分批處理，所以一開始停在「等你決定」——那張批次卡就是 Scott 的決定。
// id 由路徑決定，重跑標記不會重複（insert … on conflict do nothing）。

/** 舊筆記資料源的形式。指揮官的一般佇列會跳過它，只由舊筆記批次（lib/migration/legacy.ts）處理。 */
export const LEGACY_NOTE_KIND = 'legacy_note'

export function legacySourceId(path: string): string {
  return `src_legacy:${path}`
}

export function isLegacyNote(source: Pick<Source, 'kind'>): boolean {
  return source.kind === LEGACY_NOTE_KIND
}

/** 建立一則舊筆記資料源：等你決定、未鎖定；collectedAt 用檔案修改時間（取不到就是現在）。 */
export function createLegacyNoteSource(input: { path: string, mtime?: number }, now: number): Source {
  return {
    id: legacySourceId(input.path),
    sourceType: 'self',
    kind: LEGACY_NOTE_KIND,
    content: input.path,
    origin: input.path,
    collectedAt: input.mtime && input.mtime > 0 ? input.mtime : now,
    collector: 'system',
    status: 'awaiting_decision',
    statusChangedAt: now,
    version: 1,
    previousId: undefined,
    lockedAt: undefined,
    archivedAt: undefined,
    createdAt: now,
    updatedAt: now,
    journal: false,
  }
}

export function transitionSource(source: Source, to: SourceStatus, now: number): Source {
  if (source.archivedAt !== undefined) throw new Error('已封存的資料源不能再改狀態')
  if (!canTransition(source.status, to)) throw new Error(`資料源狀態不能從 ${source.status} 改成 ${to}`)
  if (to === 'awaiting_decision' && source.lockedAt !== undefined) throw new Error('已送出的資料源不能改回等你決定')
  if (to === 'rejected' && source.journal) throw new Error('帶日誌標籤的資料源不會被不採用')
  return {
    ...source,
    status: to,
    statusChangedAt: now,
    // 進入待分析就是送出：原始內容從此鎖定。
    lockedAt: source.lockedAt ?? (to === 'pending_analysis' ? now : undefined),
    updatedAt: now,
  }
}

/** Fork（almanac ALMNC-69.3）：日誌資料源讀過沒有產出時的終點：已分析，不是不採用。 */
export function finalStatusAfterAnalysis(source: Pick<Source, 'journal'>, hasProposals: boolean): 'analyzed' | 'rejected' {
  return hasProposals || source.journal ? 'analyzed' : 'rejected'
}

/**
 * Fork（almanac ALMNC-69.3）：貼上或拿掉日誌標籤。已封存的不能改；不採用的資料源不能貼（日誌不會在不採用裡）。
 * 標籤不鎖定原文，也不改狀態。
 */
export function setJournalTag(source: Source, journal: boolean, now: number): Source {
  if (source.journal === journal) return source
  if (source.archivedAt !== undefined) throw new Error('已封存的資料源不能改標籤')
  if (journal && source.status === 'rejected') throw new Error('不採用的資料源不能貼日誌標籤')
  return { ...source, journal, updatedAt: now }
}

/** 送出分析（Scott 選「處理」）：等你決定 → 待分析，並鎖定原始內容。 */
export function submitSource(source: Source, now: number): Source {
  return transitionSource(source, 'pending_analysis', now)
}

export type SourceEditResult =
  /** 還沒送出：原地修改同一列。 */
  | { kind: 'updated'; source: Source }
  /** 已送出：舊版原封不動，產生新版交給指揮官分析差異。 */
  | { kind: 'versioned'; previous: Source; source: Source }

/**
 * 修改原始內容。草稿原地改；已鎖定的產生新版本（previousId 連回舊版、版本號 +1），
 * 新版一建立就是送出狀態（待分析、已鎖定），舊版保留不動。
 */
export function editSourceContent(source: Source, content: string, now: number, newId: string): SourceEditResult {
  if (source.archivedAt !== undefined) throw new Error('已封存的資料源不能修改')
  if (!isLocked(source)) return { kind: 'updated', source: { ...source, content, updatedAt: now } }
  if (newId === source.id) throw new Error('新版本需要新的 id')
  return {
    kind: 'versioned',
    previous: source,
    source: {
      ...source,
      id: newId,
      content,
      status: 'pending_analysis',
      statusChangedAt: now,
      version: source.version + 1,
      previousId: source.id,
      lockedAt: now,
      archivedAt: undefined,
      createdAt: now,
      updatedAt: now,
    },
  }
}

/**
 * Fork（almanac ALMNC-54.10）：擷取失敗的卡片可以「刪除」。只有還沒送出（等你決定、未鎖定）的外部擷取、而且沒有任何產出的才能刪；
 * 其他資料源照原規則只封存、不刪除。
 */
export function canDeleteUnsent(source: Pick<Source, 'sourceType' | 'status' | 'lockedAt'>, outputCount = 0): boolean {
  return source.sourceType === 'external' && source.status === 'awaiting_decision' && source.lockedAt === undefined && outputCount === 0
}

/** 不採用滿 30 天、還沒封存的資料源 id；呼叫端只設 archivedAt，絕不刪除。 */
export function sourcesDueForArchive(
  sources: readonly Pick<Source, 'id' | 'status' | 'statusChangedAt' | 'archivedAt'>[],
  now: number,
  afterMs = REJECTED_ARCHIVE_AFTER_MS
): string[] {
  return sources
    .filter(source => source.status === 'rejected' && source.archivedAt === undefined && now - source.statusChangedAt >= afterMs)
    .map(source => source.id)
}

/** 資料源的搜尋比對：原文、來處、形式任一包含關鍵字（不分大小寫）；封存的不採用資料源也照樣找得到。 */
export function searchSources<T extends Pick<Source, 'content' | 'origin' | 'kind'>>(sources: readonly T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return [...sources]
  return sources.filter(source => {
    const haystack = `${source.content}\n${source.origin ?? ''}\n${source.kind}`.toLowerCase()
    return terms.every(term => haystack.includes(term))
  })
}

export function archiveSource(source: Source, now: number): Source {
  if (source.status !== 'rejected') throw new Error('只有不採用的資料源會封存')
  if (source.archivedAt !== undefined) return source
  return { ...source, archivedAt: now, updatedAt: now }
}

/** 從某一版往回找到第一版，回傳由舊到新的版本鏈。 */
export function versionChain(sources: readonly Source[], id: string): Source[] {
  const byId = new Map(sources.map(source => [source.id, source]))
  const chain: Source[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    current = current.previousId ? byId.get(current.previousId) : undefined
  }
  return chain
}

/** 只留每條版本鏈的最新一版（沒有被任何資料源當成上一版的）。 */
export function latestVersions(sources: readonly Source[]): Source[] {
  const superseded = new Set(sources.map(source => source.previousId).filter((id): id is string => !!id))
  return sources.filter(source => !superseded.has(source.id))
}

// ── 資料庫列 ↔ 模型 ──────────────────────────────────────────

/** src/db/v3-sources.ts 以別名選出的列（欄位已轉成 camelCase）。 */
export interface SourceRow {
  id: string
  sourceType: string
  kind: string
  content: string
  origin: string | null
  collectedAt: number
  collector: string
  status: string
  statusChangedAt: number
  version: number
  previousId: string | null
  lockedAt: number | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
  /** Fork（almanac ALMNC-69.3）：is_journal（0／1；舊資料庫還沒加欄位前讀不到就是沒有）。 */
  isJournal?: number | null
}

export function sourceFromRow(row: SourceRow): Source {
  if (!isSourceType(row.sourceType)) throw new Error(`未知的來源類型：${row.sourceType}`)
  if (!isSourceStatus(row.status)) throw new Error(`未知的資料源狀態：${row.status}`)
  return {
    id: row.id,
    sourceType: row.sourceType,
    kind: row.kind,
    content: row.content,
    origin: row.origin ?? undefined,
    collectedAt: row.collectedAt,
    collector: row.collector,
    status: row.status,
    statusChangedAt: row.statusChangedAt,
    version: row.version,
    previousId: row.previousId ?? undefined,
    lockedAt: row.lockedAt ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    journal: Number(row.isJournal ?? 0) === 1,
  }
}

/** 依 insert 欄位順序排好的值。 */
export function sourceToValues(source: Source): (string | number | null)[] {
  return [
    source.id,
    source.sourceType,
    source.kind,
    source.content,
    source.origin ?? null,
    source.collectedAt,
    source.collector,
    source.status,
    source.statusChangedAt,
    source.version,
    source.previousId ?? null,
    source.lockedAt ?? null,
    source.archivedAt ?? null,
    source.createdAt,
    source.updatedAt,
    source.journal ? 1 : 0,
  ]
}

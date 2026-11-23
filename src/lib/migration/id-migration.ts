// Fork（almanac ALMNC-69.4）：既有資料補身分編號、追溯關係改存編號。純函式：給一份「筆記庫＋note.db」的快照，
// 算出要改的每一項（檔案 before/after、資料庫列 before/after），不碰任何檔案或資料庫。
// 預覽與套用（含備份檢查、版本檢查）在 id-migration-cli.ts；規格見 almanac/2026-11-23_proposal_note-type-rules.md 第五節、
// 差距報告 2.1、2.2。
//
// 做的事：
// 1. V3 筆記（type 是 knowledge／record／log／project）沒有 id 的補 `id: N-…`，時間用原建立時間（優先順序見 noteCreatedAt）。
// 2. 資料源 id（src_<uuid>、src_legacy:…、src_email:… 等）換成 S 編號，時間用資料源的 created_at；舊 id 存進 sources.legacy_id，
//    匯入去重與舊筆記標記改認 legacy_id。引用資料源 id 的地方一起改：筆記 frontmatter sources、sources.previous_id、
//    source_outputs.source_id、source_judgements、legacy_undecided。
// 3. source_outputs.target_ref 從 vault 相對路徑改成 N 編號；行動的「路徑#提案 id」改成「N-…#提案 id」（目標檔沒有編號時保留路徑）。
// 4. 筆記 domains: [dom_…] 換成領域名稱；每個領域產生一個 M 編號，記在 id_index（kind M、name＝領域名稱）。
// 5. 日誌筆記 type: record → log；中文 status（有效、待查證、已被取代、封存）換成英文值。
//
// 可重跑：已有合法編號的筆記、已是 S 編號的資料源、target_ref 已是編號的連結、已登記 M 編號的領域都跳過。
import { isMap, parseDocument } from 'yaml'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { idStamp, isId, parseId, shortCode, type IdKind, type RandomSource } from '@/lib/v3-model/identity'
import { lastNameOf } from '@/lib/v3-model/id-index'
import { writeV3NoteFields, type NoteStatus, type V3NoteFieldsPatch } from '@/lib/v3-model/note'

// ── 快照 ────────────────────────────────────────────────────

export interface MigrationNoteFile {
  /** vault 相對路徑。 */
  path: string
  raw: string
  /** 檔案建立時間（毫秒）；取不到就省略。 */
  birthtime?: number
  mtime?: number
}

export interface MigrationSourceRow {
  id: string
  createdAt: number
  previousId?: string | null
  legacyId?: string | null
}

export interface MigrationOutputRow {
  sourceId: string
  targetType: string
  targetRef: string
  createdAt: number
}

export interface MigrationDomainRow {
  id: string
  name: string
  createdAt: number
}

export interface MigrationIdIndexRow {
  id: string
  kind: string
  path?: string | null
  name?: string | null
}

export interface IdMigrationSnapshot {
  notes: readonly MigrationNoteFile[]
  sources: readonly MigrationSourceRow[]
  sourceOutputs: readonly MigrationOutputRow[]
  domains: readonly MigrationDomainRow[]
  idIndex: readonly MigrationIdIndexRow[]
  /** source_judgements.source_id。 */
  judgementSourceIds?: readonly string[]
  /** legacy_undecided.source_id。 */
  legacyPackSourceIds?: readonly string[]
}

export interface IdMigrationOptions {
  random?: RandomSource
  /** 檔名時間前綴（`YYYY-MM-DD HHmm`）是本機時間；這裡給本機與 UTC 的差（同 Date#getTimezoneOffset，台灣是 -480）。 */
  timezoneOffsetMinutes?: number
  /** 現在時間（毫秒）；建立時間晚於現在時改用現在。 */
  now?: number
}

// ── 計畫 ────────────────────────────────────────────────────

export type NoteChangeKind = 'id' | 'sources' | 'domains' | 'type' | 'status'

/** 新 N 編號的時間從哪裡來。 */
export type CreatedAtSource = 'frontmatter' | 'filename' | 'link' | 'birthtime' | 'mtime' | 'index' | 'now'

export interface FrontmatterSummary {
  id?: string
  type?: string
  status?: string
  sources: string[]
  domains: string[]
}

export interface NoteFileChange {
  path: string
  kinds: NoteChangeKind[]
  /** 補上的 N 編號（沒有補就省略）。 */
  newId?: string
  createdAtSource?: CreatedAtSource
  createdAt?: number
  beforeSummary: FrontmatterSummary
  afterSummary: FrontmatterSummary
  /** 套用時做版本檢查：檔案現在的內容要和 before 完全一樣才寫。 */
  before: string
  after: string
}

export interface SourceIdChange {
  before: { id: string, legacyId: string | null }
  after: { id: string, legacyId: string }
  createdAt: number
}

export interface PreviousIdChange {
  before: string
  after: string
}

export interface OutputRowKey {
  sourceId: string
  targetType: string
  targetRef: string
}

export interface OutputChange {
  before: OutputRowKey
  /** update：改寫成 after；delete：after 已經有一列了（重複），刪掉 before。 */
  action: 'update' | 'delete'
  after: OutputRowKey
}

export interface SourceRefChange {
  table: 'source_judgements' | 'legacy_undecided'
  before: string
  after: string
}

export interface IdIndexChange {
  action: 'insert' | 'update_path'
  id: string
  kind: IdKind
  path?: string
  name?: string
  /** 編號時間（毫秒），寫進 created_at。 */
  createdAt: number
  /** update_path 時原本記的路徑。 */
  previousPath?: string
}

export interface DomainMocChange {
  domainId: string
  name: string
  mocId: string
}

export interface IdMigrationPlan {
  notes: NoteFileChange[]
  sources: SourceIdChange[]
  previousIds: PreviousIdChange[]
  outputs: OutputChange[]
  sourceRefs: SourceRefChange[]
  idIndex: IdIndexChange[]
  domainMocs: DomainMocChange[]
  /** 不處理、留給 Scott 或 ALMNC-69.5 的狀況。 */
  warnings: string[]
  stats: IdMigrationStats
}

export interface IdMigrationStats {
  notesScanned: number
  v3Notes: number
  notesChanged: number
  notesNewId: number
  notesSourcesRewritten: number
  notesDomainsRewritten: number
  notesTypeToLog: number
  notesStatusToEnglish: number
  sourcesRenamed: number
  sourcesAlreadyS: number
  outputsRewritten: number
  outputsDeduped: number
  outputsUnresolved: number
  domainsWithNewMoc: number
  idIndexInserted: number
}

// ── 常數與小工具 ─────────────────────────────────────────────

const V3_TYPES = new Set(['knowledge', 'record', 'log', 'project'])

/** 中文狀態 → 英文值（note.ts NOTE_STATUSES；畫面另外顯示中文）。專案狀態（進行中等）不在 V3 欄位，不動。 */
export const CHINESE_STATUS: Readonly<Record<string, NoteStatus>> = {
  有效: 'valid',
  待查證: 'disputed',
  已被取代: 'superseded',
  封存: 'archived',
}

/** frontmatter 裡可能記建立時間的欄位，依序取第一個有效的。 */
const CREATED_KEYS = ['created', 'createdAt', 'created_at', 'date created', 'dateCreated']

/** 舊檔名的時間前綴：`YYYY-MM-DD HHmm 標題.md`（lib/home/capture.ts captureFileName）。 */
const FILENAME_STAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(?:[ .]|$)/

function stringList(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string' || typeof item === 'number').map(item => String(item).trim()).filter(Boolean)
}

function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(values))
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/** frontmatter 原始值（不經 parseV3Note，才看得到 log、中文 status 這類 V3 不認的值）。解析失敗回傳 null。 */
export function readFrontmatter(raw: string): Record<string, unknown> | null {
  const { block } = splitFrontmatter(raw)
  if (!block) return {}
  const lines = block.replace(/^﻿/, '').split(/\r\n|\n|\r/)
  let end = lines.length - 1
  while (end > 0 && !/^\s*(---|\.\.\.)\s*$/.test(lines[end])) end--
  const doc = parseDocument(lines.slice(1, end).join('\n'), { uniqueKeys: true })
  if (doc.errors.length) return null
  if (doc.contents && !isMap(doc.contents)) return null
  return (doc.toJS() as Record<string, unknown> | null) ?? {}
}

function summaryOf(data: Record<string, unknown>): FrontmatterSummary {
  return {
    ...(typeof data.id === 'string' ? { id: data.id } : {}),
    ...(typeof data.type === 'string' ? { type: data.type } : {}),
    ...(typeof data.status === 'string' ? { status: data.status } : {}),
    sources: stringList(data.sources),
    domains: stringList(data.domains),
  }
}

function isV3Type(value: unknown): boolean {
  return typeof value === 'string' && V3_TYPES.has(value.trim().toLowerCase())
}

/** 解析 frontmatter 的時間：Date、ISO 字串、`YYYY-MM-DD[ HH:mm[:ss]]`（沒有時區時當本機時間）。 */
function parseFrontmatterTime(value: unknown, offsetMinutes: number): number | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.getTime()
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text)
  if (local) {
    const [, y, mo, d, h = '0', mi = '0', s = '0'] = local
    return localToUtc(+y, +mo, +d, +h, +mi, +s, offsetMinutes)
  }
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? undefined : parsed
}

function localToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, offsetMinutes: number): number | undefined {
  const utc = Date.UTC(y, mo - 1, d, h, mi, s)
  const check = new Date(utc)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return undefined
  return utc + offsetMinutes * 60_000
}

/** 檔名時間前綴 → 毫秒（本機時間換成 UTC）。 */
export function filenameTime(path: string, offsetMinutes: number): number | undefined {
  const name = path.split('/').pop() ?? ''
  const match = FILENAME_STAMP.exec(name)
  if (!match) return undefined
  const [, y, mo, d, h, mi] = match
  return localToUtc(+y, +mo, +d, +h, +mi, 0, offsetMinutes)
}

function validTime(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * 筆記的原建立時間。優先順序：
 * 1. frontmatter 的建立時間欄位（created、createdAt、created_at、date created、dateCreated）；
 * 2. 檔名的時間前綴 `YYYY-MM-DD HHmm`（舊版接受提案、快速記錄的檔名，本機時間）；
 * 3. source_outputs 裡指向這個路徑最早的一列 created_at（接受提案寫檔時同時寫入）；
 * 4. 檔案 birthtime 與 mtime 取較早的（複製或同步過的檔案 birthtime 可能比 mtime 晚）。
 * 文章發佈日、信件日期、frontmatter 的 date（事件日期）都不採用（規格：編號時間只代表進到筆記庫的時間）。
 */
export function noteCreatedAt(
  file: MigrationNoteFile,
  data: Record<string, unknown>,
  linkTimes: ReadonlyMap<string, number>,
  offsetMinutes: number,
): { at: number, source: CreatedAtSource } | undefined {
  for (const key of CREATED_KEYS) {
    const at = parseFrontmatterTime(data[key], offsetMinutes)
    if (validTime(at)) return { at, source: 'frontmatter' }
  }
  const fromName = filenameTime(file.path, offsetMinutes)
  if (validTime(fromName)) return { at: fromName, source: 'filename' }
  const linked = linkTimes.get(file.path)
  if (validTime(linked)) return { at: linked, source: 'link' }
  const birth = validTime(file.birthtime) ? file.birthtime : undefined
  const modified = validTime(file.mtime) ? file.mtime : undefined
  if (birth !== undefined && (modified === undefined || birth <= modified)) return { at: birth, source: 'birthtime' }
  if (modified !== undefined) return { at: modified, source: 'mtime' }
  return undefined
}

/** 「路徑#錨點」拆成兩段（行動的 target_ref 是「每日筆記路徑#提案 id」）。 */
export function splitRef(ref: string): { base: string, anchor?: string } {
  const index = ref.indexOf('#')
  return index < 0 ? { base: ref } : { base: ref.slice(0, index), anchor: ref.slice(index + 1) }
}

// ── 主函式 ─────────────────────────────────────────────────

/** 算出遷移計畫；不改輸入、不做任何 I/O。 */
export function planIdMigration(snapshot: IdMigrationSnapshot, options: IdMigrationOptions = {}): IdMigrationPlan {
  const offset = options.timezoneOffsetMinutes ?? new Date().getTimezoneOffset()
  const now = options.now ?? Date.now()
  const warnings: string[] = []

  // 本機已經有的編號，產生新的時避開。
  const taken = new Set<string>()
  for (const row of snapshot.idIndex) taken.add(row.id)
  for (const row of snapshot.sources) if (isId(row.id)) taken.add(row.id)
  const parsedNotes = snapshot.notes.map(file => {
    let data: Record<string, unknown> | null = null
    try {
      data = readFrontmatter(file.raw)
    } catch {
      data = null
    }
    if (data && typeof data.id === 'string' && isId(data.id)) taken.add(data.id)
    return { file, data }
  })
  const generate = (kind: IdKind, at: number): string => {
    const stamp = idStamp(new Date(Math.min(at, now)))
    for (let attempt = 0; attempt < 50; attempt++) {
      const id = `${kind}-${stamp}-${shortCode(options.random)}`
      if (!taken.has(id)) {
        taken.add(id)
        return id
      }
    }
    throw new Error(`編號連續撞號，放棄產生（${kind} ${stamp}）`)
  }

  // ── 資料源 ──
  const sourceMap = new Map<string, string>()
  const sources: SourceIdChange[] = []
  let sourcesAlreadyS = 0
  const sortedSources = [...snapshot.sources].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  for (const row of sortedSources) {
    if (isId(row.id, 'S')) {
      sourcesAlreadyS++
      // 重跑：之後還引用舊 id 的地方（例如遷移後才寫入的筆記）照樣換成現在的 S 編號。
      if (row.legacyId) sourceMap.set(row.legacyId, row.id)
      continue
    }
    if (isId(row.id)) {
      warnings.push(`資料源 ${row.id} 的編號類別不是 S，沒有處理`)
      continue
    }
    const at = validTime(row.createdAt) ? row.createdAt : now
    const id = generate('S', at)
    if (row.legacyId) warnings.push(`資料源 ${row.id} 已有 legacy_id ${row.legacyId}，改存成 ${row.id}`)
    sourceMap.set(row.id, id)
    sources.push({ before: { id: row.id, legacyId: row.legacyId ?? null }, after: { id, legacyId: row.id }, createdAt: at })
  }
  const previousIds: PreviousIdChange[] = unique(snapshot.sources.map(row => row.previousId ?? '').filter(id => id && sourceMap.has(id) && sourceMap.get(id) !== id))
    .map(before => ({ before, after: sourceMap.get(before)! }))
  const sourceRefs: SourceRefChange[] = [
    ...unique(snapshot.judgementSourceIds ?? []).filter(id => sourceMap.has(id) && sourceMap.get(id) !== id)
      .map(before => ({ table: 'source_judgements' as const, before, after: sourceMap.get(before)! })),
    ...unique(snapshot.legacyPackSourceIds ?? []).filter(id => sourceMap.has(id) && sourceMap.get(id) !== id)
      .map(before => ({ table: 'legacy_undecided' as const, before, after: sourceMap.get(before)! })),
  ]

  // ── 領域 → M 編號 ──
  const domainNameById = new Map(snapshot.domains.map(domain => [domain.id, domain.name.trim()]))
  const mocByName = new Map<string, string>()
  for (const row of snapshot.idIndex) if (row.kind === 'M' && row.name?.trim() && !mocByName.has(row.name.trim())) mocByName.set(row.name.trim(), row.id)
  const domainMocs: DomainMocChange[] = []
  const idIndex: IdIndexChange[] = []
  // 筆記庫裡已經有的 MOC 檔（frontmatter id 是 M 編號，例如範例 vault 的「20 領域/時間管理.md」）：名稱取 title 或檔名，
  // 同名的領域沿用它的 M 編號，不另外產生；還沒登記的一起登記（含路徑）。
  const indexedIds = new Set(snapshot.idIndex.map(row => row.id))
  for (const { file, data } of parsedNotes) {
    if (!data || typeof data.id !== 'string' || !isId(data.id, 'M')) continue
    const name = (typeof data.title === 'string' && data.title.trim()) || lastNameOf(file.path)
    if (!mocByName.has(name)) mocByName.set(name, data.id)
    if (!indexedIds.has(data.id)) {
      indexedIds.add(data.id)
      idIndex.push({ action: 'insert', id: data.id, kind: 'M', path: file.path, name, createdAt: parseId(data.id)!.at.getTime() })
    }
  }
  const sortedDomains = [...snapshot.domains].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const namesSeen = new Map<string, string>()
  for (const domain of sortedDomains) {
    const name = domain.name.trim()
    if (!name) continue
    if (namesSeen.has(name)) {
      warnings.push(`領域 ${domain.id} 與 ${namesSeen.get(name)} 同名「${name}」，共用同一個 M 編號；筆記 domains 換成名稱後兩者合一`)
      continue
    }
    namesSeen.set(name, domain.id)
    if (mocByName.has(name)) continue
    const at = validTime(domain.createdAt) ? domain.createdAt : now
    const mocId = generate('M', at)
    mocByName.set(name, mocId)
    domainMocs.push({ domainId: domain.id, name, mocId })
    idIndex.push({ action: 'insert', id: mocId, kind: 'M', name, createdAt: parseId(mocId)!.at.getTime() })
  }

  // ── 筆記 ──
  const linkTimes = new Map<string, number>()
  for (const row of snapshot.sourceOutputs) {
    if (row.targetType !== 'note' || isId(row.targetRef)) continue
    const current = linkTimes.get(row.targetRef)
    if (validTime(row.createdAt) && (current === undefined || row.createdAt < current)) linkTimes.set(row.targetRef, row.createdAt)
  }
  const indexById = new Map(snapshot.idIndex.map(row => [row.id, row]))
  const indexedNoteByPath = new Map<string, string>()
  for (const row of snapshot.idIndex) if (row.kind === 'N' && row.path && !indexedNoteByPath.has(row.path)) indexedNoteByPath.set(row.path, row.id)

  const idOwner = new Map<string, string>()
  /** 路徑 → 最終的 N 編號（含原本就有的），給 target_ref 用。 */
  const noteIdByPath = new Map<string, string>()
  const notes: NoteFileChange[] = []
  let v3Notes = 0
  const counts = { newId: 0, sources: 0, domains: 0, type: 0, status: 0 }

  for (const { file, data } of parsedNotes) {
    if (data === null) {
      if (/^﻿?---/.test(file.raw)) warnings.push(`${file.path}：frontmatter 解析失敗，沒有處理`)
      continue
    }
    const existingId = typeof data.id === 'string' && isId(data.id) ? data.id : undefined
    if (existingId) {
      const owner = idOwner.get(existingId)
      if (owner) warnings.push(`${file.path} 與 ${owner} 的 id 相同（${existingId}），留給掃描補號（ALMNC-69.5）處理`)
      else idOwner.set(existingId, file.path)
      if (isId(existingId, 'N') && !noteIdByPath.has(file.path)) noteIdByPath.set(file.path, existingId)
    }
    if (!isV3Type(data.type)) continue
    v3Notes++

    const kinds: NoteChangeKind[] = []
    const patch: V3NoteFieldsPatch = {}
    let newId: string | undefined
    let createdAtSource: CreatedAtSource | undefined
    let createdAt: number | undefined

    if (data.id !== undefined && data.id !== null && data.id !== '' && !existingId) {
      warnings.push(`${file.path}：id「${String(data.id)}」格式不對，沒有處理（留給 ALMNC-69.5）`)
    } else if (!existingId) {
      const fromIndex = indexedNoteByPath.get(file.path)
      if (fromIndex && !idOwner.has(fromIndex)) {
        newId = fromIndex
        createdAtSource = 'index'
        createdAt = parseId(fromIndex)?.at.getTime()
      } else {
        const created = noteCreatedAt(file, data, linkTimes, offset)
        createdAt = created?.at ?? now
        createdAtSource = created?.source ?? 'now'
        if (createdAt > now) {
          warnings.push(`${file.path}：建立時間晚於現在，改用現在時間`)
          createdAt = now
          createdAtSource = 'now'
        }
        newId = generate('N', createdAt)
      }
      idOwner.set(newId, file.path)
      noteIdByPath.set(file.path, newId)
      patch.id = newId
      kinds.push('id')
    }

    const beforeSources = stringList(data.sources)
    const afterSources = unique(beforeSources.map(id => sourceMap.get(id) ?? id))
    if (!sameList(beforeSources, afterSources)) {
      patch.sources = afterSources
      kinds.push('sources')
    }

    const beforeDomains = stringList(data.domains)
    const afterDomains = unique(beforeDomains.map(entry => domainNameById.get(entry) ?? entry))
    for (const entry of beforeDomains) {
      if (/^dom_/.test(entry) && !domainNameById.has(entry)) warnings.push(`${file.path}：領域 ${entry} 不在領域表，保留原值`)
    }
    if (!sameList(beforeDomains, afterDomains)) {
      patch.domains = afterDomains
      kinds.push('domains')
    }

    if (typeof data.type === 'string' && data.type.trim().toLowerCase() === 'record') {
      // writeV3NoteFields 把 record 寫成 log（ALMNC-69.4）。
      patch.type = 'record'
      kinds.push('type')
    }

    if (typeof data.status === 'string' && CHINESE_STATUS[data.status.trim()]) {
      patch.status = CHINESE_STATUS[data.status.trim()]
      kinds.push('status')
    }

    const finalId = existingId ?? newId
    if (finalId && isId(finalId, 'N')) {
      const indexed = indexById.get(finalId)
      if (!indexed) idIndex.push({ action: 'insert', id: finalId, kind: 'N', path: file.path, createdAt: parseId(finalId)!.at.getTime() })
      else if (indexed.path !== file.path) idIndex.push({ action: 'update_path', id: finalId, kind: 'N', path: file.path, createdAt: parseId(finalId)!.at.getTime(), ...(indexed.path ? { previousPath: indexed.path } : {}) })
    }

    if (!kinds.length) continue
    let after: string
    try {
      after = writeV3NoteFields(file.raw, patch)
    } catch (error) {
      warnings.push(`${file.path}：寫回 frontmatter 失敗（${error instanceof Error ? error.message : String(error)}），沒有處理`)
      continue
    }
    if (after === file.raw) continue
    if (kinds.includes('id')) counts.newId++
    if (kinds.includes('sources')) counts.sources++
    if (kinds.includes('domains')) counts.domains++
    if (kinds.includes('type')) counts.type++
    if (kinds.includes('status')) counts.status++
    notes.push({
      path: file.path,
      kinds,
      ...(newId ? { newId } : {}),
      ...(createdAtSource ? { createdAtSource } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      beforeSummary: summaryOf(data),
      afterSummary: summaryOf(readFrontmatter(after) ?? {}),
      before: file.raw,
      after,
    })
  }
  // id_index 已登記、但檔案還沒有 id 的路徑：重跑時沿用同一個編號（上面已處理）；沒對到檔案的不動。

  // ── source_outputs ──
  const keyOf = (row: OutputRowKey) => `${row.sourceId}\u0000${row.targetType}\u0000${row.targetRef}`
  const finalKeys = new Set<string>()
  const pending: Array<{ before: OutputRowKey, after: OutputRowKey }> = []
  let outputsUnresolved = 0
  for (const row of snapshot.sourceOutputs) {
    const before: OutputRowKey = { sourceId: row.sourceId, targetType: row.targetType, targetRef: row.targetRef }
    const sourceId = sourceMap.get(row.sourceId) ?? row.sourceId
    let targetRef = row.targetRef
    const { base, anchor } = splitRef(row.targetRef)
    if (!isId(base)) {
      const id = noteIdByPath.get(base)
      if (id) targetRef = anchor !== undefined ? `${id}#${anchor}` : id
      else {
        outputsUnresolved++
        if (row.targetType === 'note') warnings.push(`連結 ${row.sourceId} → ${row.targetRef}：找不到這則筆記（可能已刪除或搬走），target_ref 保留路徑`)
      }
    }
    const after: OutputRowKey = { sourceId, targetType: row.targetType, targetRef }
    if (keyOf(after) === keyOf(before)) finalKeys.add(keyOf(before))
    else pending.push({ before, after })
  }
  const outputs: OutputChange[] = []
  for (const change of pending) {
    const key = keyOf(change.after)
    if (finalKeys.has(key)) outputs.push({ ...change, action: 'delete' })
    else {
      finalKeys.add(key)
      outputs.push({ ...change, action: 'update' })
    }
  }

  const stats: IdMigrationStats = {
    notesScanned: snapshot.notes.length,
    v3Notes,
    notesChanged: notes.length,
    notesNewId: counts.newId,
    notesSourcesRewritten: counts.sources,
    notesDomainsRewritten: counts.domains,
    notesTypeToLog: counts.type,
    notesStatusToEnglish: counts.status,
    sourcesRenamed: sources.length,
    sourcesAlreadyS,
    outputsRewritten: outputs.filter(change => change.action === 'update').length,
    outputsDeduped: outputs.filter(change => change.action === 'delete').length,
    outputsUnresolved,
    domainsWithNewMoc: domainMocs.length,
    idIndexInserted: idIndex.filter(change => change.action === 'insert').length,
  }
  return { notes, sources, previousIds, outputs, sourceRefs, idIndex, domainMocs, warnings, stats }
}

/** 計畫是不是什麼都不用做（重跑時應該是）。 */
export function isEmptyPlan(plan: IdMigrationPlan): boolean {
  return !plan.notes.length && !plan.sources.length && !plan.previousIds.length && !plan.outputs.length
    && !plan.sourceRefs.length && !plan.idIndex.length && !plan.domainMocs.length
}

// ── 預覽報告 ─────────────────────────────────────────────────

const CREATED_LABEL: Record<CreatedAtSource, string> = {
  frontmatter: 'frontmatter 建立時間',
  filename: '檔名時間前綴',
  link: '最早的追溯連結時間',
  birthtime: '檔案建立時間',
  mtime: '檔案修改時間',
  index: '系統索引已有',
  now: '找不到，用現在時間',
}

const KIND_LABEL: Record<NoteChangeKind, string> = {
  id: '補編號',
  sources: '來源換 S',
  domains: '領域換名稱',
  type: 'record→log',
  status: '狀態換英文',
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function list(values: readonly string[]): string {
  return values.length ? values.join(', ') : '—'
}

function utc(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z')
}

export interface ReportContext {
  vault?: string
  db?: string
  generatedAt?: number
  /** 套用時：跳過的項目（版本檢查沒過）。 */
  skipped?: string[]
  title?: string
}

/** 預覽（或套用結果）的 Markdown：統計＋逐項清單。 */
export function renderIdMigrationReport(plan: IdMigrationPlan, context: ReportContext = {}): string {
  const s = plan.stats
  const lines: string[] = []
  lines.push(`# ${context.title ?? '身分編號遷移預覽（ALMNC-69.4）'}`, '')
  if (context.generatedAt) lines.push(`- 產生時間：${utc(context.generatedAt)}`)
  if (context.vault) lines.push(`- 筆記庫：\`${context.vault}\``)
  if (context.db) lines.push(`- note.db：\`${context.db}\``)
  lines.push('- 編號時間一律 UTC。這份預覽沒有改任何檔案或資料庫。', '')
  if (isEmptyPlan(plan)) lines.push('**沒有需要遷移的項目**（已經遷移過，或沒有舊資料）。', '')

  lines.push('## 統計', '', '| 項目 | 數量 |', '|---|---|')
  const rows: Array<[string, number]> = [
    ['掃描的 Markdown 檔', s.notesScanned],
    ['V3 筆記（knowledge／record／log／project）', s.v3Notes],
    ['要改的筆記檔', s.notesChanged],
    ['　補 N 編號', s.notesNewId],
    ['　frontmatter sources 換成 S 編號', s.notesSourcesRewritten],
    ['　frontmatter domains 換成領域名稱', s.notesDomainsRewritten],
    ['　type record → log', s.notesTypeToLog],
    ['　中文 status 換成英文', s.notesStatusToEnglish],
    ['資料源換 S 編號', s.sourcesRenamed],
    ['資料源已是 S 編號（跳過）', s.sourcesAlreadyS],
    ['sources.previous_id 改寫', plan.previousIds.length],
    ['source_outputs 改寫', s.outputsRewritten],
    ['source_outputs 合併重複（刪除）', s.outputsDeduped],
    ['source_outputs 目標找不到編號（保留路徑）', s.outputsUnresolved],
    ['source_judgements／legacy_undecided 改寫', plan.sourceRefs.length],
    ['領域登記 M 編號', s.domainsWithNewMoc],
    ['id_index 新增', s.idIndexInserted],
    ['警告', plan.warnings.length],
  ]
  for (const [label, count] of rows) lines.push(`| ${label} | ${count} |`)
  lines.push('')

  if (context.skipped?.length) {
    lines.push('## 套用時跳過（版本檢查沒過）', '')
    for (const item of context.skipped) lines.push(`- ${item}`)
    lines.push('')
  }

  if (plan.warnings.length) {
    lines.push('## 警告', '')
    for (const warning of plan.warnings) lines.push(`- ${warning}`)
    lines.push('')
  }

  if (plan.domainMocs.length) {
    lines.push('## 領域 → M 編號', '', '| 領域 id | 名稱 | M 編號 |', '|---|---|---|')
    for (const entry of plan.domainMocs) lines.push(`| ${entry.domainId} | ${cell(entry.name)} | ${entry.mocId} |`)
    lines.push('')
  }

  if (plan.notes.length) {
    lines.push('## 筆記檔', '', '| 檔案 | 變更 | 編號（時間來源） | 之前 | 之後 |', '|---|---|---|---|---|')
    for (const note of plan.notes) {
      const id = note.newId ? `${note.newId}（${CREATED_LABEL[note.createdAtSource ?? 'now']}）` : '—'
      const describe = (summary: FrontmatterSummary) => cell([
        `type: ${summary.type ?? '—'}`,
        `status: ${summary.status ?? '—'}`,
        `sources: ${list(summary.sources)}`,
        `domains: ${list(summary.domains)}`,
      ].join('；'))
      lines.push(`| ${cell(note.path)} | ${note.kinds.map(kind => KIND_LABEL[kind]).join('、')} | ${id} | ${describe(note.beforeSummary)} | ${describe(note.afterSummary)} |`)
    }
    lines.push('')
  }

  if (plan.sources.length) {
    lines.push('## 資料源（sources 表）', '', '| 舊 id | 新 S 編號 | 建立時間 |', '|---|---|---|')
    for (const change of plan.sources) lines.push(`| ${cell(change.before.id)} | ${change.after.id} | ${utc(change.createdAt)} |`)
    lines.push('')
  }

  if (plan.previousIds.length) {
    lines.push('## 版本鏈（sources.previous_id）', '')
    for (const change of plan.previousIds) lines.push(`- ${change.before} → ${change.after}`)
    lines.push('')
  }

  if (plan.outputs.length) {
    lines.push('## 追溯連結（source_outputs）', '', '| 動作 | 之前 | 之後 |', '|---|---|---|')
    for (const change of plan.outputs) {
      const show = (row: OutputRowKey) => cell(`${row.sourceId} → ${row.targetType}:${row.targetRef}`)
      lines.push(`| ${change.action === 'update' ? '改寫' : '刪除重複'} | ${show(change.before)} | ${show(change.after)} |`)
    }
    lines.push('')
  }

  if (plan.sourceRefs.length) {
    lines.push('## 其他引用資料源的表', '')
    for (const change of plan.sourceRefs) lines.push(`- ${change.table}：${change.before} → ${change.after}`)
    lines.push('')
  }

  if (plan.idIndex.length) {
    lines.push('## 系統索引（id_index）', '', '| 動作 | 編號 | 路徑或名稱 |', '|---|---|---|')
    for (const change of plan.idIndex) {
      const target = change.kind === 'M' ? `名稱：${change.name ?? ''}` : `${change.previousPath ? `${change.previousPath} → ` : ''}${change.path ?? ''}`
      lines.push(`| ${change.action === 'insert' ? '新增' : '更新路徑'} | ${change.id} | ${cell(target)} |`)
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

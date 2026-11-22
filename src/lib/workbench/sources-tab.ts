// Fork（almanac ALMNC-54.8）：工作台「資料源」分頁（原收集箱，Q36）的清單模型。純函式、無 I/O。
// 三個來處併成一條清單：
//   1. V3 資料源表 sources（#109，只取每條版本鏈的最新一版）
//   2. 舊的 Inbox 記錄（marks＋record_processed）
//   3. 舊收集頁丟進來的項目（store.json 的 collectItems；指揮官送來的提案批次不算，那是產出不是資料源）
// 舊資料交給指揮官整理或編輯時，會建立一則 id 固定的資料源（rec_<記錄 id>、cap_<項目 id>），之後清單只列那則資料源，不重複。
// 狀態篩選：全部／等你決定／未整理／已整理／不採用（v14）；沒有輸入框和搜尋列。
import type { Source } from '@/lib/v3-model/source'
import { judgementLine, type SourceJudgement } from './judgement'

export type SourceRowStatus = 'wait' | 'todo' | 'ing' | 'edited' | 'done' | 'no'
export const SOURCE_FILTERS = ['all', 'wait', 'todo', 'done', 'no'] as const
export type SourceFilter = typeof SOURCE_FILTERS[number]

/**
 * 顯示用的內容形式（v14 的類型字：網頁、文字、截圖、插圖、檔案、錄音、待辦、素材）。
 * Fork（almanac ALMNC-57）：加上 Email、RSS、會議，資料源分頁看得出是從哪個入口進來的。
 */
export type SourceDisplayKind = 'web' | 'text' | 'shot' | 'img' | 'file' | 'audio' | 'todo' | 'prompt' | 'email' | 'rss' | 'meeting'

export type SourceRowOrigin = 'source' | 'record' | 'capture'

export interface SourceListRow {
  /** src:<id>、rec:<記錄 id>、cap:<項目 id>。 */
  id: string
  origin: SourceRowOrigin
  kind: SourceDisplayKind
  title: string
  /** 清單第二行（最多兩行）。 */
  excerpt: string
  /** 完整原文（閱讀與編輯用）。 */
  content: string
  /** 來處：網址、檔名或「隨手記」。 */
  from: string
  at: number
  status: SourceRowStatus
  /** 已整理的產出數（source_outputs；舊記錄有轉成筆記算 1）。 */
  outputs: number
  /** V3 資料源的版本號；舊資料是 1。 */
  version: number
  sourceId?: string
  markId?: number
  captureId?: string
  /** Fork（almanac ALMNC-54.10）：等你決定的資料源的初步判斷一行（沒有就是空字串）。 */
  judgement?: string
  /** 判斷裡有建議（才顯示「照建議處理」）。 */
  suggestion?: string
  /** 擷取失敗：重試／刪除。 */
  captureFailed?: boolean
}

// —— 輸入（結構型別） ——

export interface RecordLike {
  id: number
  type: 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording' | 'todo' | 'prompt-draft'
  content?: string
  desc?: string
  url: string
  createdAt: number
}

export interface CaptureLike {
  id: string
  input: { kind: 'text' | 'link' | 'image' | 'file', text: string, name?: string }
  createdAt: number
  state: 'reading' | 'ready'
  proposals: ReadonlyArray<{ status: 'wait' | 'ok' | 'no' }>
  recordId?: number
}

export interface SourcesTabInput {
  /** 已是最新版本的資料源（latestVersions）。 */
  sources: readonly Source[]
  /** 資料源 id → 產出數。 */
  outputCounts?: ReadonlyMap<string, number>
  records?: readonly RecordLike[]
  /** 已整理的記錄 id → 轉成的筆記路徑（沒有就是 null）。 */
  processed?: ReadonlyMap<number, { notePath: string | null }>
  captures?: readonly CaptureLike[]
  /** 改過、還沒送給指揮官的資料源 id（v14「v2 未送出」）。 */
  edited?: ReadonlySet<string>
  /** Fork（almanac ALMNC-54.10）：資料源 id → 初步判斷。 */
  judgements?: ReadonlyMap<string, SourceJudgement>
}

export const RECORD_SOURCE_PREFIX = 'rec_'
export const CAPTURE_SOURCE_PREFIX = 'cap_'

export function recordSourceId(markId: number): string {
  return `${RECORD_SOURCE_PREFIX}${markId}`
}

export function captureSourceId(captureId: string): string {
  return `${CAPTURE_SOURCE_PREFIX}${captureId}`
}

const SOURCE_KIND: Record<string, SourceDisplayKind> = {
  text: 'text', link: 'web', image: 'shot', file: 'file', transcript: 'audio', voice: 'audio', email: 'email', todo: 'todo', prompt: 'prompt',
  rss: 'rss', meeting: 'meeting',
}

/** V3 資料源的形式 → 顯示用的類型字（不認得的當檔案）。 */
export function sourceDisplayKind(kind: string): SourceDisplayKind {
  return SOURCE_KIND[kind] ?? 'file'
}
const RECORD_KIND: Record<RecordLike['type'], SourceDisplayKind> = {
  scan: 'shot', text: 'text', image: 'img', link: 'web', file: 'file', recording: 'audio', todo: 'todo', 'prompt-draft': 'prompt',
}
const CAPTURE_KIND: Record<CaptureLike['input']['kind'], SourceDisplayKind> = { text: 'text', link: 'web', image: 'img', file: 'file' }

function clip(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('')
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.replace(/^#+\s*/, '').trim()
}

function excerptOf(text: string, title: string): string {
  const body = text.trim().split('\n').map(line => line.trim()).filter(Boolean)
  if (body[0] && body[0].replace(/^#+\s*/, '') === title) body.shift()
  return clip(body.join(' '), 160)
}

/** 從 V3 資料源的原文取標題：第一行（data: 網址等不能讀的改用來處）。 */
export function sourceTitle(source: Pick<Source, 'content' | 'origin' | 'kind'>): string {
  const line = firstLine(source.content)
  if (line && !/^data:/i.test(line)) return clip(line, 60)
  return clip(source.origin || source.kind, 60)
}

function sourceStatus(source: Source, edited: ReadonlySet<string> | undefined): SourceRowStatus {
  switch (source.status) {
    case 'awaiting_decision': return 'wait'
    case 'pending_analysis': return edited?.has(source.id) ? 'edited' : 'todo'
    case 'analyzing': return 'ing'
    case 'analyzed': return 'done'
    case 'rejected': return 'no'
  }
}

function sourceRow(source: Source, input: SourcesTabInput): SourceListRow {
  const title = sourceTitle(source)
  const readable = /^data:/i.test(source.content.trim()) ? '' : source.content
  return {
    id: `src:${source.id}`,
    origin: 'source',
    kind: sourceDisplayKind(source.kind),
    title,
    excerpt: excerptOf(readable, title),
    content: readable,
    from: source.origin ?? '',
    at: source.collectedAt,
    status: sourceStatus(source, input.edited),
    outputs: input.outputCounts?.get(source.id) ?? 0,
    version: source.version,
    sourceId: source.id,
    ...judgementFields(source, input.judgements?.get(source.id)),
  }
}

/** 只有等你決定的資料源才帶初步判斷。 */
function judgementFields(source: Source, judgement: SourceJudgement | undefined): Pick<SourceListRow, 'judgement' | 'suggestion' | 'captureFailed'> {
  if (source.status !== 'awaiting_decision' || !judgement) return {}
  if (judgement.status === 'capture_failed') return { captureFailed: true }
  const line = judgementLine(judgement)
  return line ? { judgement: line, ...(judgement.suggestion ? { suggestion: judgement.suggestion } : {}) } : {}
}

function recordRow(record: RecordLike, input: SourcesTabInput): SourceListRow {
  const text = record.content || record.desc || ''
  const title = clip(firstLine(record.desc || '') || firstLine(text) || record.url || record.type, 60)
  const done = input.processed?.get(record.id)
  return {
    id: `rec:${record.id}`,
    origin: 'record',
    kind: RECORD_KIND[record.type] ?? 'text',
    title,
    excerpt: excerptOf(text, title),
    content: text,
    from: record.url || '',
    at: record.createdAt,
    status: done ? 'done' : 'todo',
    outputs: done?.notePath ? 1 : 0,
    version: 1,
    markId: record.id,
  }
}

function captureRow(item: CaptureLike): SourceListRow {
  const title = clip(item.input.name || firstLine(item.input.text) || item.input.kind, 60)
  const kept = item.proposals.filter(proposal => proposal.status !== 'no').length
  const status: SourceRowStatus = item.state === 'reading'
    ? 'ing'
    : !item.proposals.length ? 'todo' : kept ? 'done' : 'no'
  return {
    id: `cap:${item.id}`,
    origin: 'capture',
    kind: CAPTURE_KIND[item.input.kind] ?? 'text',
    title,
    excerpt: excerptOf(item.input.text, title),
    content: item.input.text,
    from: item.input.kind === 'link' ? item.input.text.trim() : item.input.name ?? '',
    at: item.createdAt,
    status,
    outputs: status === 'done' ? kept : 0,
    version: 1,
    captureId: item.id,
  }
}

/** 指揮官的提案批次也放在 collectItems 裡，但沒有原文；那不是資料源。 */
export function isUserCapture(item: Pick<CaptureLike, 'input' | 'recordId'>): boolean {
  return item.recordId !== undefined || item.input.text.trim() !== ''
}

/** 三個來處併成一條清單，新的在前。已橋接成資料源的舊資料只列資料源那一則。 */
export function buildSourceRows(input: SourcesTabInput): SourceListRow[] {
  const ids = new Set(input.sources.map(source => source.id))
  const rows: SourceListRow[] = input.sources.map(source => sourceRow(source, input))
  const recordIds = new Set<number>()
  for (const record of input.records ?? []) {
    recordIds.add(record.id)
    if (ids.has(recordSourceId(record.id))) continue
    rows.push(recordRow(record, input))
  }
  for (const item of input.captures ?? []) {
    if (!isUserCapture(item) || ids.has(captureSourceId(item.id))) continue
    // 從 Inbox 記錄拆進收集的項目：清單上已經有那則記錄（或它的資料源），不再列一次。
    if (item.recordId !== undefined && (recordIds.has(item.recordId) || ids.has(recordSourceId(item.recordId)))) continue
    rows.push(captureRow(item))
  }
  return rows.sort((a, b) => b.at - a.at)
}

export function matchesFilter(row: Pick<SourceListRow, 'status'>, filter: SourceFilter): boolean {
  switch (filter) {
    case 'all': return true
    case 'wait': return row.status === 'wait'
    case 'todo': return row.status === 'todo' || row.status === 'ing' || row.status === 'edited'
    case 'done': return row.status === 'done'
    case 'no': return row.status === 'no'
  }
}

export function filterRows(rows: readonly SourceListRow[], filter: SourceFilter): SourceListRow[] {
  return rows.filter(row => matchesFilter(row, filter))
}

export function filterCounts(rows: readonly SourceListRow[]): Record<SourceFilter, number> {
  return Object.fromEntries(SOURCE_FILTERS.map(filter => [filter, filterRows(rows, filter).length])) as Record<SourceFilter, number>
}

/** 「N / M 已整理」。 */
export function organisedSummary(rows: readonly SourceListRow[]): { done: number, total: number } {
  return { done: rows.filter(row => row.status === 'done').length, total: rows.length }
}

/** 分頁上的數字：等你決定的件數。 */
export function waitingCount(rows: readonly SourceListRow[]): number {
  return rows.filter(row => row.status === 'wait').length
}

// —— 勾選 ——

export function togglePick(picked: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(picked)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** 全選框的狀態：目前清單全勾、部分勾、沒勾。 */
export function pickState(visibleIds: readonly string[], picked: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const on = visibleIds.filter(id => picked.has(id)).length
  if (on && on === visibleIds.length) return 'all'
  return picked.size ? 'some' : 'none'
}

/** 按全選：目前清單沒全勾就全勾，全勾了就全部取消（只動目前清單的）。 */
export function toggleAll(visibleIds: readonly string[], picked: ReadonlySet<string>): Set<string> {
  const next = new Set(picked)
  const all = visibleIds.length > 0 && visibleIds.every(id => next.has(id))
  for (const id of visibleIds) {
    if (all) next.delete(id)
    else next.add(id)
  }
  return next
}

// —— 交給指揮官整理 ——

export type HandStep =
  /** 等你決定 → 送出（待分析）。 */
  | { op: 'submit', sourceId: string }
  /** 已整理或不採用的再整理一次：另存同內容的新版本交給指揮官（舊版保留）。 */
  | { op: 'reanalyze', sourceId: string, content: string }
  /** 已經在等分析（含改過還沒送的）：只要叫佇列跑。 */
  | { op: 'kick', sourceId: string }
  /** 舊記錄、舊收集項目：建立固定 id 的資料源交給指揮官。 */
  | { op: 'bridge', row: SourceListRow }

export function planHandToCommander(rows: readonly SourceListRow[]): { steps: HandStep[], reorganise: number } {
  const steps: HandStep[] = []
  let reorganise = 0
  for (const row of rows) {
    if (row.origin !== 'source') {
      if (row.status === 'done') reorganise++
      steps.push({ op: 'bridge', row })
      continue
    }
    const sourceId = row.sourceId!
    if (row.status === 'wait') steps.push({ op: 'submit', sourceId })
    else if (row.status === 'done' || row.status === 'no') {
      if (row.status === 'done') reorganise++
      steps.push({ op: 'reanalyze', sourceId, content: row.content })
    } else if (row.status === 'todo' || row.status === 'edited') steps.push({ op: 'kick', sourceId })
    // 分析中的不用再交一次
  }
  return { steps, reorganise }
}

/** 舊資料橋接成資料源時的欄位：連結是外部擷取，其他是自己寫的（R2，一進來就交給指揮官）。 */
export function bridgeInput(row: SourceListRow, content = row.content): { id: string, sourceType: 'external' | 'self', kind: string, content: string, origin?: string, collectedAt: number } {
  const id = row.markId !== undefined ? recordSourceId(row.markId) : captureSourceId(row.captureId ?? row.id)
  const kind = row.kind === 'web' ? 'link' : row.kind === 'shot' || row.kind === 'img' ? 'image' : row.kind === 'audio' ? 'transcript' : row.kind
  return {
    id,
    sourceType: row.kind === 'web' ? 'external' : 'self',
    kind,
    content: content || row.from || row.title,
    origin: row.from || undefined,
    collectedAt: row.at,
  }
}

// —— 日期分段（v14：今天／昨天／本週／更早） ——

export type DayBucket = 'today' | 'yesterday' | 'week' | 'earlier'

export function dayBucket(at: number, now: number): DayBucket {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  if (at >= today) return 'today'
  if (at >= today - 86_400_000) return 'yesterday'
  if (at >= today - 6 * 86_400_000) return 'week'
  return 'earlier'
}

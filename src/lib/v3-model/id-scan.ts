// Fork（almanac ALMNC-69.5）：掃描補號與斷鏈修復。純函式：給一份「筆記庫檔案＋系統索引 id_index」的快照，
// 算出要做的動作與每個檔案的 before/after，不碰任何檔案或資料庫。I/O 在 id-scan-runner.ts。
// 規格：almanac/2026-11-23_proposal_note-type-rules.md 第五節〈例外處理〉、差距報告 2.1。
//
// 範圍：V3 筆記（type 是 knowledge／record／log／project）→ N；MOC（kind: domain）→ M；
// MOC「章節」區（標題含「章節」的 ## 區塊）裡的每個 ### 章節 → 標題下一行 `<!-- C-… -->`。
//
// 五種例外：
// 1. 沒有編號（Obsidian 新建）：補新編號。N／M 的時間沿用 69.4 的 noteCreatedAt（frontmatter 建立時間 → 檔名時間前綴 →
//    birthtime 與 mtime 取早）；新章節用 MOC 本身補號的時間，MOC 已有編號時用現在。
// 2. 複本重號（同一個編號出現在兩處）：原檔依序看 id_index 記的上次路徑 → 上次檔名 → birthtime 最早 → 路徑排序；
//    其他複本換新編號（時間用複本的 birthtime），並通知。
// 3. 編號被刪或改壞：依 id_index 補回原編號——同路徑（章節再比章節名稱），找不到再找「同檔名、舊路徑已不存在」的；
//    都沒有才當成第 1 種補新號。補回會通知。
// 4. 時鐘異常（門檻 CLOCK_TOLERANCE_MS＝5 分鐘）：現在時間比本機既有最大編號時間早超過門檻（時鐘倒退，新編號會排在舊的前面）、
//    檔案上的編號或檔案建立時間晚於現在超過門檻、筆記編號早於 frontmatter sources 裡資料源編號超過門檻 → 提醒，不改任何東西。
// 5. 檔名在 App 外被改：依編號找到新路徑，更新 id_index；舊路徑已經不存在時，用 rewriteLinksForMoves（App 內改名同一套）
//    把指向舊檔名的連結改到新檔名，並通知。
//
// 一次要補號的檔案超過 maxAssign（預設 20）時不自動補，只回報 held：大量沒有編號的舊筆記應該走 69.4 的遷移（先出預覽）。
import { readFrontmatter, noteCreatedAt } from '@/lib/migration/id-migration'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { mapMovedPath, normalizeVaultPath, rewriteLinksForMoves, unmapMovedPath, type PathMove } from '@/lib/markdown/wikilink-rewrite'
import { idStamp, isId, parseId, shortCode, type IdKind, type RandomSource } from './identity'
import { lastNameOf } from './id-index'
import { isV3NoteTypeValue, writeV3NoteFields } from './note'

// ── 快照 ────────────────────────────────────────────────────

export interface ScanFile {
  /** vault 相對路徑。 */
  path: string
  raw: string
  /** 檔案建立時間（毫秒）；取不到就省略。 */
  birthtime?: number
  mtime?: number
}

export interface ScanIndexRow {
  id: string
  kind: string
  path?: string | null
  name?: string | null
}

export interface ScanSnapshot {
  /** 要檢查的檔案（V3 筆記、MOC、可能要改連結的檔案）；不必是整個筆記庫。 */
  files: readonly ScanFile[]
  /** 筆記庫裡全部的 .md 路徑（判斷舊路徑還在不在、解析連結用）；省略時用 files 的路徑。 */
  paths?: readonly string[]
  idIndex: readonly ScanIndexRow[]
}

export interface ScanOptions {
  now?: number
  random?: RandomSource
  /** 檔名時間前綴是本機時間；同 Date#getTimezoneOffset（台灣 -480）。 */
  timezoneOffsetMinutes?: number
  /** 一次最多自動補號幾個檔案；超過就整批不補（held）。 */
  maxAssign?: number
}

// ── 結果 ────────────────────────────────────────────────────

export const CLOCK_TOLERANCE_MS = 5 * 60_000
export const DEFAULT_MAX_ASSIGN = 20

export type ClockReason = 'behind' | 'future' | 'before-source'

export type ScanAction =
  | { type: 'assign', path: string, id: string, kind: IdKind, heading?: string }
  | { type: 'renumber', path: string, oldId: string, id: string, keptPath: string, heading?: string }
  | { type: 'restore', path: string, id: string, heading?: string }
  | { type: 'rename', id: string, from: string, to: string }
  | { type: 'relink', path: string, count: number }
  /** id：有問題的編號（檔案建立時間在未來、整批補號被擋下時沒有）。 */
  | { type: 'clock', reason: ClockReason, id?: string, path?: string, sourceId?: string }
  | { type: 'held', paths: string[] }

export interface ScanWrite {
  path: string
  before: string
  after: string
}

export interface ScanIndexUpsert {
  id: string
  kind: IdKind
  path?: string
  name?: string
  /** 這筆要等這個檔案寫入成功才登記（編號是寫進檔案才生效的）。 */
  dependsOn?: string
  /** 檔名被改（例外 5）的路徑更新：要等所有改連結的檔案都寫入成功才登記，否則下次掃描才會再修一次。 */
  afterRelink?: boolean
}

export interface ScanPlan {
  actions: ScanAction[]
  writes: ScanWrite[]
  index: ScanIndexUpsert[]
  warnings: string[]
}

// ── 章節 ────────────────────────────────────────────────────

export interface ParsedChapter {
  heading: string
  /** 在內文（frontmatter 之後）的 0 起算行號。 */
  line: number
  /** 標題下一行是 `<!-- … -->` 註解時的行號（不論內容合不合格式）。 */
  commentLine?: number
  /** 註解裡的合格 C 編號。 */
  id?: string
}

const CHAPTER_SECTION = /^##\s+.*章節/
const LEVEL_1_OR_2 = /^#{1,2}\s/
const CHAPTER_HEADING = /^###\s+(.+?)\s*#*\s*$/
const COMMENT_LINE = /^\s*<!--\s*(.*?)\s*-->\s*$/

function lines(text: string): string[] {
  return text.split('\n')
}

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/** MOC 內文裡「章節」區的 ### 章節。 */
export function parseChapters(body: string): ParsedChapter[] {
  const all = lines(body).map(stripCr)
  const chapters: ParsedChapter[] = []
  let inSection = false
  let fence = false
  for (let i = 0; i < all.length; i++) {
    const line = all[i]
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    if (LEVEL_1_OR_2.test(line)) {
      inSection = CHAPTER_SECTION.test(line)
      continue
    }
    if (!inSection) continue
    const heading = CHAPTER_HEADING.exec(line)
    if (!heading) continue
    const chapter: ParsedChapter = { heading: heading[1], line: i }
    const comment = i + 1 < all.length ? COMMENT_LINE.exec(all[i + 1]) : null
    if (comment) {
      chapter.commentLine = i + 1
      if (isId(comment[1], 'C')) chapter.id = comment[1]
    }
    chapters.push(chapter)
  }
  return chapters
}

/** 依章節行號寫入 C 編號：有註解行就換掉，沒有就在標題下一行插入。 */
function writeChapterIds(body: string, chapters: readonly ParsedChapter[], ids: ReadonlyMap<number, string>): string {
  if (ids.size === 0) return body
  const out = lines(body)
  // 由後往前改，插入行不影響前面的行號
  for (const chapter of [...chapters].sort((a, b) => b.line - a.line)) {
    const id = ids.get(chapter.line)
    if (!id) continue
    const eol = out[chapter.line].endsWith('\r') ? '\r' : ''
    const text = `<!-- ${id} -->${eol}`
    if (chapter.commentLine !== undefined) out[chapter.commentLine] = text
    else out.splice(chapter.line + 1, 0, text)
  }
  return out.join('\n')
}

// ── 主函式 ─────────────────────────────────────────────────

type Category = 'N' | 'M'

interface ParsedFile {
  file: ScanFile
  data: Record<string, unknown> | null
  category: Category | null
  /** frontmatter 裡合格的編號。 */
  fmId?: string
  /** frontmatter 有 id 但格式不對。 */
  badId?: string
  chapters: ParsedChapter[]
}

interface Occurrence {
  id: string
  kind: IdKind
  file: number
  /** 章節才有：章節在 chapters 裡的位置。 */
  chapter?: number
}

function validTime(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function categoryOf(data: Record<string, unknown> | null): Category | null {
  if (!data) return null
  if (typeof data.kind === 'string' && data.kind.trim().toLowerCase() === 'domain') return 'M'
  if (isV3NoteTypeValue(data.type)) return 'N'
  return null
}

function mocName(parsed: ParsedFile): string {
  const title = parsed.data?.title
  return (typeof title === 'string' && title.trim()) || lastNameOf(parsed.file.path)
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return [value.trim()]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map(item => item.trim())
}

/** 算出掃描計畫；不改輸入、不做任何 I/O。 */
export function planScan(snapshot: ScanSnapshot, options: ScanOptions = {}): ScanPlan {
  const now = options.now ?? Date.now()
  const offset = options.timezoneOffsetMinutes ?? new Date().getTimezoneOffset()
  const maxAssign = options.maxAssign ?? DEFAULT_MAX_ASSIGN
  const actions: ScanAction[] = []
  const warnings: string[] = []
  const index: ScanIndexUpsert[] = []

  const files = snapshot.files.map(file => ({ ...file, path: normalizeVaultPath(file.path) }))
  const paths = (snapshot.paths ?? files.map(file => file.path)).map(normalizeVaultPath)
  const pathSet = new Set(paths)
  const indexById = new Map<string, ScanIndexRow>()
  for (const row of snapshot.idIndex) indexById.set(row.id, { ...row, path: row.path ? normalizeVaultPath(row.path) : row.path })

  // ── 解析 ──
  const parsed: ParsedFile[] = files.map(file => {
    let data: Record<string, unknown> | null = null
    try {
      data = readFrontmatter(file.raw)
    } catch {
      data = null
    }
    if (data === null && /^﻿?---/.test(file.raw)) warnings.push(`${file.path}：frontmatter 解析失敗，沒有處理`)
    const category = categoryOf(data)
    const rawId = data?.id
    const fmId = typeof rawId === 'string' && isId(rawId) ? rawId : undefined
    const badId = !fmId && rawId !== undefined && rawId !== null && rawId !== '' ? String(rawId) : undefined
    const chapters = category === 'M' ? parseChapters(splitFrontmatter(file.raw).body) : []
    return { file, data, category, fmId, badId, chapters }
  })

  const occurrences: Occurrence[] = []
  parsed.forEach((item, fileIndex) => {
    if (item.fmId) {
      const kind = item.fmId[0] as IdKind
      if (kind === 'N' || kind === 'M') {
        if (item.category && item.category !== kind) warnings.push(`${item.file.path}：編號 ${item.fmId} 的類別和檔案種類（${item.category}）不符，沒有更動`)
        occurrences.push({ id: item.fmId, kind, file: fileIndex })
      } else {
        warnings.push(`${item.file.path}：frontmatter 的編號 ${item.fmId} 不是筆記或 MOC 編號，略過`)
      }
    }
    item.chapters.forEach((chapter, chapterIndex) => {
      if (chapter.id) occurrences.push({ id: chapter.id, kind: 'C', file: fileIndex, chapter: chapterIndex })
    })
  })

  // 本機已經有的編號，產生新的時避開。
  const taken = new Set<string>(indexById.keys())
  for (const occ of occurrences) taken.add(occ.id)
  for (const item of parsed) for (const id of stringList(item.data?.sources)) if (isId(id)) taken.add(id)
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

  // ── 例外 4：時鐘（先看既有的編號，新產生的在後面補） ──
  let latest: { id: string, at: number } | undefined
  for (const id of taken) {
    const at = parseId(id)?.at.getTime()
    if (at !== undefined && (!latest || at > latest.at)) latest = { id, at }
  }
  if (latest && now < latest.at - CLOCK_TOLERANCE_MS) actions.push({ type: 'clock', reason: 'behind', id: latest.id })
  const futureSeen = new Set<string>()
  for (const occ of occurrences) {
    const at = parseId(occ.id)!.at.getTime()
    if (at > now + CLOCK_TOLERANCE_MS && !futureSeen.has(occ.id)) {
      futureSeen.add(occ.id)
      actions.push({ type: 'clock', reason: 'future', id: occ.id, path: parsed[occ.file].file.path })
    }
  }
  for (const item of parsed) {
    if (!item.fmId || !isId(item.fmId, 'N')) continue
    const noteAt = parseId(item.fmId)!.at.getTime()
    for (const sourceId of stringList(item.data?.sources)) {
      const source = isId(sourceId, 'S') ? parseId(sourceId) : null
      if (source && noteAt < source.at.getTime() - CLOCK_TOLERANCE_MS) {
        actions.push({ type: 'clock', reason: 'before-source', id: item.fmId, path: item.file.path, sourceId })
      }
    }
  }

  // 每個檔案要改的地方：frontmatter 編號、章節編號（章節行號 → 編號）。
  const fmEdits = new Map<number, string>()
  const chapterEdits = new Map<number, Map<number, string>>()
  const setChapterId = (fileIndex: number, chapterIndex: number, id: string) => {
    const map = chapterEdits.get(fileIndex) ?? new Map<number, string>()
    map.set(parsed[fileIndex].chapters[chapterIndex].line, id)
    chapterEdits.set(fileIndex, map)
  }
  const occPath = (occ: Occurrence) => parsed[occ.file].file.path
  const occHeading = (occ: Occurrence) => (occ.chapter !== undefined ? parsed[occ.file].chapters[occ.chapter].heading : undefined)
  const nameFor = (kind: IdKind, fileIndex: number, heading?: string) => (kind === 'M' ? mocName(parsed[fileIndex]) : kind === 'C' ? heading : undefined)

  // ── 例外 2：複本重號 ──
  const groups = new Map<string, Occurrence[]>()
  for (const occ of occurrences) groups.set(occ.id, [...(groups.get(occ.id) ?? []), occ])
  const kept: Occurrence[] = []
  for (const [id, group] of groups) {
    if (group.length === 1) {
      kept.push(group[0])
      continue
    }
    const entry = indexById.get(id)
    const rank = (occ: Occurrence): number[] => {
      const path = occPath(occ)
      const samePath = entry?.path === path ? 0 : 1
      const sameHeading = occ.kind === 'C' && entry?.name && entry.name === occHeading(occ) ? 0 : 1
      const sameName = entry?.path && lastNameOf(entry.path) === lastNameOf(path) ? 0 : 1
      const birth = validTime(parsed[occ.file].file.birthtime) ? parsed[occ.file].file.birthtime! : Number.MAX_SAFE_INTEGER
      return [samePath, sameHeading, sameName, birth]
    }
    const sorted = [...group].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]
      return occPath(a).localeCompare(occPath(b)) || (a.chapter ?? 0) - (b.chapter ?? 0)
    })
    const [keeper, ...copies] = sorted
    kept.push(keeper)
    for (const copy of copies) {
      const file = parsed[copy.file].file
      const at = validTime(file.birthtime) ? file.birthtime : now
      const fresh = generate(copy.kind, at)
      const heading = occHeading(copy)
      if (copy.chapter !== undefined) setChapterId(copy.file, copy.chapter, fresh)
      else fmEdits.set(copy.file, fresh)
      actions.push({ type: 'renumber', path: file.path, oldId: id, id: fresh, keptPath: occPath(keeper), ...(heading ? { heading } : {}) })
      index.push({ id: fresh, kind: copy.kind, path: file.path, ...(nameFor(copy.kind, copy.file, heading) ? { name: nameFor(copy.kind, copy.file, heading) } : {}), dependsOn: file.path })
    }
  }

  // ── 例外 5：依編號比對路徑；順便登記索引裡還沒有的 ──
  const presentIds = new Set(kept.map(occ => occ.id))
  const moves: PathMove[] = []
  const movedFrom = new Map<number, string>() // 檔案 → 它在索引裡的舊路徑（章節補回時用）
  for (const occ of kept) {
    const path = occPath(occ)
    const heading = occHeading(occ)
    const entry = indexById.get(occ.id)
    const name = nameFor(occ.kind, occ.file, heading)
    if (!entry) {
      index.push({ id: occ.id, kind: occ.kind, path, ...(name ? { name } : {}) })
      continue
    }
    if (occ.kind === 'C') {
      if (entry.path !== path || (entry.name ?? undefined) !== heading) index.push({ id: occ.id, kind: 'C', path, ...(heading ? { name: heading } : {}) })
      continue
    }
    if (entry.path && entry.path !== path) {
      actions.push({ type: 'rename', id: occ.id, from: entry.path, to: path })
      movedFrom.set(occ.file, entry.path)
      if (!pathSet.has(entry.path)) moves.push({ sourcePath: entry.path, targetPath: path })
      // MOC 的名稱 ↔ M 編號（筆記 domains 用）不在這裡改，留給 MOC 重建（ALMNC-69.7）。
      index.push({ id: occ.id, kind: occ.kind, path, ...(entry.name ? { name: entry.name } : name ? { name } : {}), afterRelink: true })
    } else if (!entry.path || (occ.kind === 'M' && !entry.name)) {
      index.push({ id: occ.id, kind: occ.kind, path, ...(entry.name ? { name: entry.name } : name ? { name } : {}) })
    }
  }

  // ── 例外 3 與 1：沒有編號的檔案（先補回，再補新號） ──
  const used = new Set<string>()
  const indexRows = [...indexById.values()]
  const restorable = (row: ScanIndexRow) => !presentIds.has(row.id) && !used.has(row.id)
  const assignments: Array<{ fileIndex: number, chapter?: number, kind: IdKind, at: number, future?: boolean }> = []
  const newMoc = new Map<number, number>() // MOC 檔 → 補號時間（新章節沿用）

  parsed.forEach((item, fileIndex) => {
    if (!item.category || item.fmId) return
    const path = item.file.path
    const kind = item.category
    const byPath = indexRows.find(row => row.kind === kind && row.path === path && restorable(row))
    const byName = byPath ? undefined : indexRows.filter(row => row.kind === kind && row.path && !pathSet.has(row.path) && lastNameOf(row.path) === lastNameOf(path) && restorable(row))
    const row = byPath ?? (byName && byName.length === 1 ? byName[0] : undefined)
    if (row) {
      used.add(row.id)
      fmEdits.set(fileIndex, row.id)
      actions.push({ type: 'restore', path, id: row.id })
      if (row.path !== path) {
        actions.push({ type: 'rename', id: row.id, from: row.path!, to: path })
        movedFrom.set(fileIndex, row.path!)
        moves.push({ sourcePath: row.path!, targetPath: path })
      }
      if (item.badId) warnings.push(`${path}：id「${item.badId}」格式不對，依系統索引補回 ${row.id}`)
      const name = kind === 'M' ? row.name ?? mocName(item) : undefined
      index.push({ id: row.id, kind, path, ...(name ? { name } : {}), dependsOn: path, ...(row.path !== path ? { afterRelink: true } : {}) })
      return
    }
    const created = noteCreatedAt(item.file, item.data ?? {}, new Map(), offset)
    const at = created?.at ?? now
    if (item.badId) warnings.push(`${path}：id「${item.badId}」格式不對、系統索引也找不到，換成新編號`)
    assignments.push({ fileIndex, kind, at, future: at > now + CLOCK_TOLERANCE_MS })
    if (kind === 'M') newMoc.set(fileIndex, at)
  })

  parsed.forEach((item, fileIndex) => {
    item.chapters.forEach((chapter, chapterIndex) => {
      if (chapter.id) return
      const mocPaths = new Set([item.file.path, movedFrom.get(fileIndex)].filter((path): path is string => !!path))
      const row = indexRows.find(candidate => candidate.kind === 'C' && candidate.path && mocPaths.has(candidate.path) && candidate.name === chapter.heading && restorable(candidate))
      if (row) {
        used.add(row.id)
        setChapterId(fileIndex, chapterIndex, row.id)
        actions.push({ type: 'restore', path: item.file.path, id: row.id, heading: chapter.heading })
        index.push({ id: row.id, kind: 'C', path: item.file.path, name: chapter.heading, dependsOn: item.file.path })
        return
      }
      assignments.push({ fileIndex, chapter: chapterIndex, kind: 'C', at: newMoc.get(fileIndex) ?? now })
    })
  })

  // 大量補號 → 不自動做，交給遷移（先出預覽）。
  const assignedFiles = [...new Set(assignments.map(item => item.fileIndex))]
  if (assignedFiles.length > maxAssign) {
    actions.push({ type: 'held', paths: assignedFiles.map(fileIndex => parsed[fileIndex].file.path) })
    for (const assignment of assignments) if (assignment.future) actions.push({ type: 'clock', reason: 'future', path: parsed[assignment.fileIndex].file.path })
  } else {
    for (const assignment of assignments) {
      const item = parsed[assignment.fileIndex]
      const id = generate(assignment.kind, assignment.at)
      const heading = assignment.chapter !== undefined ? item.chapters[assignment.chapter].heading : undefined
      if (assignment.chapter !== undefined) setChapterId(assignment.fileIndex, assignment.chapter, id)
      else fmEdits.set(assignment.fileIndex, id)
      actions.push({ type: 'assign', path: item.file.path, id, kind: assignment.kind, ...(heading ? { heading } : {}) })
      // 檔案建立時間在未來：編號已經壓回現在，但仍提醒時鐘可能有問題。
      if (assignment.future) actions.push({ type: 'clock', reason: 'future', id, path: item.file.path })
      const name = nameFor(assignment.kind, assignment.fileIndex, heading)
      index.push({ id, kind: assignment.kind, path: item.file.path, ...(name ? { name } : {}), dependsOn: item.file.path })
    }
  }

  // ── 套用到內容：章節 → frontmatter → 連結 ──
  const contents = parsed.map((item, fileIndex) => {
    let raw = item.file.raw
    const chapterIds = chapterEdits.get(fileIndex)
    if (chapterIds?.size) {
      const { block, body } = splitFrontmatter(raw)
      raw = block + writeChapterIds(body, item.chapters, chapterIds)
    }
    const fmId = fmEdits.get(fileIndex)
    if (fmId) raw = writeV3NoteFields(raw, { id: fmId })
    return raw
  })

  if (moves.length > 0) {
    const pathsBefore = paths.map(path => unmapMovedPath(path, moves))
    parsed.forEach((item, fileIndex) => {
      const path = item.file.path
      const result = rewriteLinksForMoves({
        content: contents[fileIndex],
        sourcePathBefore: unmapMovedPath(path, moves),
        sourcePathAfter: mapMovedPath(path, moves),
        moves,
        pathsBefore,
        pathsAfter: paths,
      })
      if (result.count > 0) {
        contents[fileIndex] = result.content
        actions.push({ type: 'relink', path, count: result.count })
      }
    })
  }

  const writes: ScanWrite[] = []
  parsed.forEach((item, fileIndex) => {
    if (contents[fileIndex] !== item.file.raw) writes.push({ path: item.file.path, before: item.file.raw, after: contents[fileIndex] })
  })

  return { actions, writes, index, warnings }
}

// ── 通知摘要 ────────────────────────────────────────────────

export interface ScanSummary {
  assigned: number
  renumbered: Array<{ path: string, keptPath: string }>
  restored: string[]
  renamed: Array<{ from: string, to: string }>
  relinkedFiles: number
  relinkedLinks: number
  clock: Array<Extract<ScanAction, { type: 'clock' }>>
  held: number
}

/** 動作 → 給通知用的摘要（同一個檔案只算一次）。 */
export function summarizeScan(actions: readonly ScanAction[]): ScanSummary {
  const summary: ScanSummary = { assigned: 0, renumbered: [], restored: [], renamed: [], relinkedFiles: 0, relinkedLinks: 0, clock: [], held: 0 }
  const assignedPaths = new Set<string>()
  const restoredPaths = new Set<string>()
  for (const action of actions) {
    switch (action.type) {
      case 'assign': assignedPaths.add(action.path); break
      case 'renumber': summary.renumbered.push({ path: action.path, keptPath: action.keptPath }); break
      case 'restore': restoredPaths.add(action.path); break
      case 'rename': summary.renamed.push({ from: action.from, to: action.to }); break
      case 'relink': summary.relinkedFiles++; summary.relinkedLinks += action.count; break
      case 'clock': summary.clock.push(action); break
      case 'held': summary.held = action.paths.length; break
    }
  }
  summary.assigned = assignedPaths.size
  summary.restored = [...restoredPaths]
  return summary
}

// ── 候選檔案（I/O 層用：只讀需要的檔案，不必讀整個筆記庫） ─────────────

export interface CandidateNote {
  path: string
  frontmatter: Record<string, unknown> | null
  links: ReadonlyArray<{ target: string }>
}

/**
 * 從筆記庫索引挑出要讀的檔案：V3 筆記、MOC、frontmatter 有編號的檔案，
 * 以及連結指向「索引記的路徑已經不在筆記庫」的檔名的檔案（例外 5 可能要改它們的連結）。
 */
export function scanCandidates(notes: Iterable<CandidateNote>, idIndex: readonly ScanIndexRow[]): string[] {
  const all = [...notes]
  const present = new Set(all.map(note => normalizeVaultPath(note.path)))
  const missingNames = new Set<string>()
  for (const row of idIndex) {
    if ((row.kind === 'N' || row.kind === 'M') && row.path && !present.has(normalizeVaultPath(row.path))) missingNames.add(lastNameOf(row.path).toLowerCase())
  }
  const out: string[] = []
  for (const note of all) {
    const data = note.frontmatter
    const own = !!data && (categoryOf(data) !== null || isId(data.id))
    const linksMissing = missingNames.size > 0 && note.links.some(link => missingNames.has(lastNameOf(link.target.split('#')[0]).toLowerCase()))
    if (own || linksMissing) out.push(note.path)
  }
  return out
}

// ── 通知 ────────────────────────────────────────────────────

export type ScanNoticeKey = 'renumbered' | 'renumberedMany' | 'restored' | 'renamed' | 'renamedNoLinks' | 'clockBehind' | 'clockFuture' | 'clockBeforeSource' | 'held'

export interface ScanNotice {
  key: ScanNoticeKey
  values: Record<string, string | number>
  /** 時鐘與大量補號的提醒每次掃描都會再算出來，用這個鍵在同一次開 App 期間只通知一次。 */
  onceKey?: string
}

/** 摘要 → 要通知 Scott 的訊息（i18n 鍵＋參數，命名空間 idScan）。補新號（例外 1）不通知。 */
export function scanNotices(summary: ScanSummary): ScanNotice[] {
  const notices: ScanNotice[] = []
  if (summary.renumbered.length === 1) {
    const [{ path, keptPath }] = summary.renumbered
    notices.push({ key: 'renumbered', values: { path: lastNameOf(path), kept: lastNameOf(keptPath) } })
  } else if (summary.renumbered.length > 1) {
    notices.push({ key: 'renumberedMany', values: { count: summary.renumbered.length } })
  }
  if (summary.restored.length) notices.push({ key: 'restored', values: { count: summary.restored.length, path: lastNameOf(summary.restored[0]) } })
  if (summary.renamed.length) {
    const values = { count: summary.renamed.length, name: lastNameOf(summary.renamed[0].to), files: summary.relinkedFiles, links: summary.relinkedLinks }
    notices.push({ key: summary.relinkedLinks ? 'renamed' : 'renamedNoLinks', values })
  }
  const clock = (reason: ClockReason) => summary.clock.filter(item => item.reason === reason)
  if (clock('behind').length) notices.push({ key: 'clockBehind', values: {}, onceKey: 'clock-behind' })
  const future = clock('future')
  if (future.length) notices.push({ key: 'clockFuture', values: { count: future.length, path: lastNameOf(future[0].path ?? future[0].id ?? '') }, onceKey: `clock-future:${future.map(item => item.id ?? item.path).sort().join(',')}` })
  const beforeSource = clock('before-source')
  if (beforeSource.length) notices.push({ key: 'clockBeforeSource', values: { count: beforeSource.length, path: lastNameOf(beforeSource[0].path ?? '') }, onceKey: `clock-source:${beforeSource.map(item => `${item.id}>${item.sourceId}`).sort().join(',')}` })
  if (summary.held) notices.push({ key: 'held', values: { count: summary.held }, onceKey: `held:${summary.held}` })
  return notices
}

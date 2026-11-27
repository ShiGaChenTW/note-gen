// Fork（almanac ALMNC-69.10）：Scott 在 Obsidian（App 外）直接改 MOC 時的判斷。純函式、不丟例外。
// 規格：almanac/2026-11-23_proposal_note-type-rules.md 第二節〈在 Obsidian 直接改 MOC 時〉〈整批檢查〉；GLOSSARY（整批檢查、正式收錄、
// Scott 指定、章節）；差距報告 2.9。I/O（上次已知狀態、寫檔、ops、工作台卡）在 reconcile-runtime.ts。
//
// reconcileMoc(舊, 新)：拿「上次已知狀態」（舊原文）和現在的檔案（新原文）的章節區正式收錄比對，得到差異清單。七種判斷：
//   刪掉一條收錄行   → remove（移除這個 MOC 的歸屬）
//   搬到另一章       → move（搬動，不是移除再新增）
//   改了關係說明     → relation（只改說明；標 Scott 指定）
//   新增一條收錄行   → add（加入歸屬；超過 3 個領域由重建出 domainLimit 卡）
//   連結指向不存在   → broken：先問 recover（依編號索引：改名前的檔名 → 現在的筆記）修回連結（寫回檔案）；修不回就標斷鏈、
//                      不改歸屬（同一章剛好有一條消失的舊收錄 → 視為同一條，保留原歸屬）
//   收錄行格式壞了   → malformed：當作沒改，原本的歸屬保留（沒有 [[ ]]、連結不在最前面、跑到章節外；少了 ── 的仍算收錄，只提醒）
//   改了章節標題     → chapter-rename：依標題下的 C 編號判斷是改名，不是刪章加章
// 收錄依「連到哪一則筆記」配對（resolve；連不到的用連結文字），章節依 C 編號配對、沒有編號才比名稱。
// 只有章節區的收錄算數；從這裡開始、重點結論、待釐清、分家清單（引用）改了都不影響。
//
// 輸出除了差異，還有兩份內容：
// - repaired：新原文修好可修回的斷鏈（系統修復，寫回檔案）。
// - effective：repaired 再把「格式壞了／斷鏈但保留原歸屬」的行換回舊收錄行——它是系統認定的收錄狀態，
//   存成新的「上次已知狀態」，重建 domains 時也用它（檔案本身不動，等 Scott 自己修正）。
//
// batchCheck(差異)：一次存檔移除 5 條以上、同一批事件改到 2 個以上 MOC、或整批匯入時不直接生效，改出整批檢查卡。
import { addMocEntry, moveMocEntry, removeMocEntry, renameMocChapter, renderEntryLine, sameTarget, setMocEntryRelation, type ChapterRef } from './edit'
import type { OpSpec } from '@/lib/ops/types'
import { formalEntries, parseMoc, splitLinkInner, targetKey, type MocChapter, type MocEntry, type MocProblemReason, type ParsedMoc } from './parse'

// ── 型別 ────────────────────────────────────────────────────

export type ReconcileDiffKind = 'remove' | 'move' | 'relation' | 'add' | 'broken' | 'malformed' | 'chapter-rename'

interface DiffBase {
  /** 差異的穩定鍵（同一個 MOC、同一則筆記／章節、同一種判斷 → 同一個鍵；卡片逐條取消用）。 */
  id: string
  mocPath: string
  mocId?: string
  mocName: string
}

interface EntryDiffBase extends DiffBase {
  /** 收錄連到的筆記（筆記庫相對路徑）。 */
  notePath: string
  /** 收錄行的連結目標（筆記標題或路徑）。 */
  target: string
  alias?: string
}

export interface RemoveDiff extends EntryDiffBase {
  kind: 'remove'
  chapterId?: string
  chapterTitle: string
  relation: string
}

export interface AddDiff extends EntryDiffBase {
  kind: 'add'
  chapterId?: string
  chapterTitle: string
  relation: string
}

export interface MoveDiff extends EntryDiffBase {
  kind: 'move'
  fromChapterId?: string
  fromChapterTitle: string
  toChapterId?: string
  toChapterTitle: string
}

export interface RelationDiff extends EntryDiffBase {
  kind: 'relation'
  chapterId?: string
  chapterTitle: string
  before: string
  after: string
}

export interface ChapterRenameDiff extends DiffBase {
  kind: 'chapter-rename'
  chapterId: string
  before: string
  after: string
}

export interface BrokenDiff extends DiffBase {
  kind: 'broken'
  /** 新原文裡指向不存在筆記的連結目標。 */
  target: string
  /** 行號（新原文）。 */
  line: number
  /** 依編號索引修回：改寫成這個連結目標（repaired 已套用）。 */
  repairedTo?: string
  /** 修不回、但視為同一條而保留原歸屬的舊收錄（筆記路徑）。 */
  keptNote?: string
}

export interface MalformedDiff extends DiffBase {
  kind: 'malformed'
  reason: MocProblemReason
  line: number
  text: string
  /** 視為同一條、保留原歸屬的舊收錄（筆記路徑）；沒有就是單純格式提醒。 */
  keptNote?: string
}

export type ReconcileDiff = RemoveDiff | AddDiff | MoveDiff | RelationDiff | ChapterRenameDiff | BrokenDiff | MalformedDiff

/** 會改到歸屬或 MOC 結構、要記成操作的差異（其餘只提醒）。 */
export type EffectiveDiff = RemoveDiff | AddDiff | MoveDiff | RelationDiff | ChapterRenameDiff

export function isEffectiveDiff(diff: ReconcileDiff): diff is EffectiveDiff {
  return diff.kind !== 'broken' && diff.kind !== 'malformed'
}

export interface ReconcileOptions {
  /** MOC 的筆記庫相對路徑。 */
  path: string
  /** 收錄連結目標 → 筆記路徑；連不到回傳 null。 */
  resolve: (target: string, mocPath: string) => string | null
  /** 斷鏈時依編號索引找回筆記（改名前的檔名 → 現在的路徑）；沒有就不修。 */
  recover?: (target: string) => string | null
  /** 修回連結時要寫的連結目標（預設：檔名去掉 .md）。 */
  targetFor?: (notePath: string) => string
}

export interface ReconcileResult {
  diffs: ReconcileDiff[]
  /** 新原文修好可修回的斷鏈（和新原文不同時要寫回檔案）。 */
  repaired: string
  /** 系統認定的收錄狀態（新的上次已知狀態；重建 domains 用）。 */
  effective: string
  /** 舊原文是 null（系統沒看過這個 MOC）。 */
  unseen: boolean
  /** 新原文的正式收錄條數（整批匯入判斷用）。 */
  entries: number
  mocId?: string
  mocName: string
}

// ── 工具 ────────────────────────────────────────────────────

function allChapters(moc: ParsedMoc): MocChapter[] {
  return [...moc.chapters, ...(moc.unsorted ? [moc.unsorted] : [])]
}

function baseName(target: string): string {
  return (target.split('/').pop() ?? target).replace(/\.md$/i, '').trim()
}

function defaultTargetFor(notePath: string): string {
  return baseName(notePath)
}

/** 舊章節 → 新章節：尚未分章對尚未分章；先依 C 編號，沒對上的再依名稱。 */
function mapChapters(oldMoc: ParsedMoc, newMoc: ParsedMoc): Map<MocChapter, MocChapter> {
  const map = new Map<MocChapter, MocChapter>()
  const used = new Set<MocChapter>()
  if (oldMoc.unsorted && newMoc.unsorted) {
    map.set(oldMoc.unsorted, newMoc.unsorted)
    used.add(newMoc.unsorted)
  }
  for (const chapter of oldMoc.chapters) {
    if (!chapter.id) continue
    const hit = newMoc.chapters.find(item => item.id === chapter.id && !used.has(item))
    if (hit) {
      map.set(chapter, hit)
      used.add(hit)
    }
  }
  for (const chapter of oldMoc.chapters) {
    if (map.has(chapter)) continue
    const hit = newMoc.chapters.find(item => !used.has(item) && item.title === chapter.title && (!item.id || !chapter.id))
    if (hit) {
      map.set(chapter, hit)
      used.add(hit)
    }
  }
  return map
}

interface Located {
  key: string
  notePath: string | null
  entry: MocEntry
  chapter: MocChapter
}

function locate(moc: ParsedMoc, keyOf: (entry: MocEntry) => { key: string, notePath: string | null }): Map<string, Located> {
  const map = new Map<string, Located>()
  for (const { entry, chapter } of formalEntries(moc)) {
    const { key, notePath } = keyOf(entry)
    if (!map.has(key)) map.set(key, { key, notePath, entry, chapter })
  }
  return map
}

function lineEol(line: string): string {
  return line.endsWith('\r') ? '\r' : ''
}

/** 章節參照（反向套回用）：有 C 編號用編號，尚未分章用 unsorted，否則用名稱。 */
function chapterRef(id: string | undefined, title: string, unsorted: boolean): ChapterRef {
  if (id) return { id }
  if (unsorted) return { unsorted: true }
  return { title }
}

// ── reconcileMoc ────────────────────────────────────────────

/**
 * 比對上次已知狀態（old；null＝系統沒看過）與現在的 MOC 原文（next），回傳差異清單與修好／有效的內容。
 * old 為 null 時，現有的正式收錄全部算新增。
 */
export function reconcileMoc(old: string | null, next: string, options: ReconcileOptions): ReconcileResult {
  const { path, resolve } = options
  const targetFor = options.targetFor ?? defaultTargetFor
  const oldMoc = old === null ? null : parseMoc(old, path)
  const firstPass = parseMoc(next, path)
  const mocName = firstPass.name
  const mocId = firstPass.id ?? oldMoc?.id
  const base = { mocPath: path, ...(mocId ? { mocId } : {}), mocName }
  const mocKey = mocId ?? path
  const diffs: ReconcileDiff[] = []

  const resolveKey = (entry: MocEntry) => {
    const notePath = resolve(entry.target, path)
    return { key: notePath ?? `?${targetKey(entry.target)}`, notePath }
  }

  // 1. 斷鏈先依編號修回：只看這次新出現或改過的連結（沒改過的斷鏈是筆記被改名，由 69.5 掃描修）。
  const oldTargets = new Set(oldMoc ? formalEntries(oldMoc).map(({ entry }) => targetKey(entry.target)) : [])
  const lines = next.split('\n')
  for (const { entry } of formalEntries(firstPass)) {
    if (resolve(entry.target, path) || oldTargets.has(targetKey(entry.target))) continue
    const recovered = options.recover?.(entry.target) ?? null
    if (!recovered) continue
    const repairedTo = targetFor(recovered)
    lines[entry.line] = `${renderEntryLine({ target: repairedTo, alias: entry.alias, relation: entry.relation })}${lineEol(lines[entry.line])}`
    diffs.push({ ...base, id: `broken:${mocKey}:${targetKey(entry.target)}`, kind: 'broken', target: entry.target, line: entry.line, repairedTo })
  }
  const repaired = lines.join('\n')
  const newMoc = repaired === next ? firstPass : parseMoc(repaired, path)
  const newMap = locate(newMoc, resolveKey)
  const entries = newMap.size

  if (!oldMoc) {
    for (const item of newMap.values()) {
      if (!item.notePath) {
        diffs.push({ ...base, id: `broken:${mocKey}:${item.key}`, kind: 'broken', target: item.entry.target, line: item.entry.line })
        continue
      }
      diffs.push({
        ...base, id: `add:${mocKey}:${item.notePath}`, kind: 'add', notePath: item.notePath, target: item.entry.target,
        ...(item.entry.alias ? { alias: item.entry.alias } : {}),
        ...(item.chapter.id ? { chapterId: item.chapter.id } : {}), chapterTitle: item.chapter.title, relation: item.entry.relation,
      })
    }
    return { diffs, repaired, effective: repaired, unseen: true, entries: [...newMap.values()].filter(item => item.notePath).length, ...(mocId ? { mocId } : {}), mocName }
  }

  const oldMap = locate(oldMoc, resolveKey)
  const chapters = mapChapters(oldMoc, newMoc)

  // 2. 章節改名（依 C 編號）。
  for (const [before, after] of chapters) {
    if (before.unsorted || !before.id || before.id !== after.id || before.title === after.title) continue
    diffs.push({ ...base, id: `chapter-rename:${mocKey}:${before.id}`, kind: 'chapter-rename', chapterId: before.id, before: before.title, after: after.title })
  }

  // 3. 兩邊都有的收錄：搬動、改說明。
  const oldProblemTexts = new Set(oldMoc.problems.map(problem => problem.text.trim()))
  const vanished: Located[] = []
  for (const item of oldMap.values()) {
    const now = newMap.get(item.key)
    if (!now) {
      vanished.push(item)
      continue
    }
    if (!item.notePath) continue
    const entryBase = { ...base, notePath: item.notePath, target: now.entry.target, ...(now.entry.alias ? { alias: now.entry.alias } : {}) }
    const mapped = chapters.get(item.chapter)
    if (mapped !== now.chapter) {
      diffs.push({
        ...entryBase, id: `move:${mocKey}:${item.notePath}`, kind: 'move',
        ...(item.chapter.id ? { fromChapterId: item.chapter.id } : {}), fromChapterTitle: item.chapter.title,
        ...(now.chapter.id ? { toChapterId: now.chapter.id } : {}), toChapterTitle: now.chapter.title,
      })
    }
    if (now.entry.malformed && !item.entry.malformed) {
      // 少了 ──：仍算收錄（歸屬不變），說明視為沒改，只提醒。
      diffs.push({ ...base, id: `malformed:${mocKey}:${item.notePath}`, kind: 'malformed', reason: now.entry.malformed, line: now.entry.line, text: now.entry.raw, keptNote: item.notePath })
      continue
    }
    if (now.entry.relation !== item.entry.relation && !now.entry.malformed) {
      diffs.push({
        ...entryBase, id: `relation:${mocKey}:${item.notePath}`, kind: 'relation',
        ...(now.chapter.id ? { chapterId: now.chapter.id } : {}), chapterTitle: now.chapter.title,
        before: item.entry.relation, after: now.entry.relation,
      })
    }
  }

  // 4. 只在舊的：先看是不是格式壞了（同一條還在、只是看不出連結），再看是不是斷鏈換掉的，剩下的才是刪掉。
  const kept: Array<{ old: Located, line: number, inPlace: boolean }> = []
  const take = (predicate: (item: Located) => boolean): Located | undefined => {
    const index = vanished.findIndex(predicate)
    return index < 0 ? undefined : vanished.splice(index, 1)[0]
  }
  const chapterAt = (line: number) => allChapters(newMoc).find(chapter => chapter.line < line && line < chapter.endLine) ?? null
  for (const problem of newMoc.problems) {
    if (problem.reason !== 'no-link' && problem.reason !== 'link-not-first' && problem.reason !== 'outside-chapter') continue
    const text = problem.text
    const lower = text.toLowerCase()
    const inner = /\[\[([^\]\n]+)\]\]/.exec(text)
    const linked = inner ? splitLinkInner(inner[1]).target : null
    const hit = take(item => {
      if (!item.notePath) return false
      if (linked) return resolve(linked, path) === item.notePath || sameTarget(linked, item.entry.target)
      const name = baseName(item.entry.target).toLowerCase()
      const alias = item.entry.alias?.toLowerCase()
      return (name.length > 0 && lower.includes(name)) || Boolean(alias && lower.includes(alias))
    })
    if (!hit && oldProblemTexts.has(text.trim())) continue
    const keyPart = hit?.notePath ?? `line:${problem.line}`
    diffs.push({ ...base, id: `malformed:${mocKey}:${keyPart}`, kind: 'malformed', reason: problem.reason, line: problem.line, text, ...(hit?.notePath ? { keptNote: hit.notePath } : {}) })
    if (hit) kept.push({ old: hit, line: problem.line, inPlace: problem.reason !== 'outside-chapter' && chapterAt(problem.line) !== null })
  }

  // 5. 只在新的：連得到 → 新增；連不到（修不回） → 斷鏈（同一章剛好有消失的舊收錄就視為同一條，保留原歸屬）。
  for (const item of newMap.values()) {
    if (oldMap.has(item.key)) continue
    if (item.notePath) {
      diffs.push({
        ...base, id: `add:${mocKey}:${item.notePath}`, kind: 'add', notePath: item.notePath, target: item.entry.target,
        ...(item.entry.alias ? { alias: item.entry.alias } : {}),
        ...(item.chapter.id ? { chapterId: item.chapter.id } : {}), chapterTitle: item.chapter.title, relation: item.entry.relation,
      })
      continue
    }
    const hit = take(candidate => Boolean(candidate.notePath) && chapters.get(candidate.chapter) === item.chapter)
    diffs.push({ ...base, id: `broken:${mocKey}:${item.key}`, kind: 'broken', target: item.entry.target, line: item.entry.line, ...(hit?.notePath ? { keptNote: hit.notePath } : {}) })
    if (hit) kept.push({ old: hit, line: item.entry.line, inPlace: true })
  }

  // 6. 剩下消失的舊收錄 → 刪掉（移除歸屬）。舊的本來就連不到的不算歸屬，不記。
  for (const item of vanished) {
    if (!item.notePath) continue
    diffs.push({
      ...base, id: `remove:${mocKey}:${item.notePath}`, kind: 'remove', notePath: item.notePath, target: item.entry.target,
      ...(item.entry.alias ? { alias: item.entry.alias } : {}),
      ...(item.chapter.id ? { chapterId: item.chapter.id } : {}), chapterTitle: item.chapter.title, relation: item.entry.relation,
    })
  }

  // 7. 有效內容：保留原歸屬的行換回舊收錄行（在章節裡就原地換；跑到章節外的放回原章節）。
  let effective = repaired
  if (kept.length) {
    const effLines = repaired.split('\n')
    for (const item of kept) {
      if (item.inPlace) effLines[item.line] = `${item.old.entry.raw}${lineEol(effLines[item.line])}`
    }
    effective = effLines.join('\n')
    for (const item of kept) {
      if (item.inPlace) continue
      const mapped = chapters.get(item.old.chapter)
      const ref = mapped ? chapterRef(mapped.id ?? undefined, mapped.title, mapped.unsorted) : { unsorted: true as const }
      const added = addMocEntry(effective, {
        target: item.old.entry.target, alias: item.old.entry.alias, relation: item.old.entry.relation, chapter: ref,
        newChapterId: () => item.old.chapter.id ?? '',
      }, path)
      effective = added.content
    }
  }

  return { diffs: sortDiffs(diffs), repaired, effective, unseen: false, entries, ...(mocId ? { mocId } : {}), mocName }
}

const KIND_ORDER: Record<ReconcileDiffKind, number> = { 'chapter-rename': 0, remove: 1, move: 2, relation: 3, add: 4, broken: 5, malformed: 6 }

function sortDiffs(diffs: ReconcileDiff[]): ReconcileDiff[] {
  return [...diffs].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

// ── 整批檢查 ────────────────────────────────────────────────

/** 一次存檔移除幾條以上就整批檢查。 */
export const BATCH_REMOVE_THRESHOLD = 5
/** 同一批事件改到幾個以上 MOC 就整批檢查。 */
export const BATCH_MOC_THRESHOLD = 2
/** 整批匯入：系統沒看過的 MOC 一次出現幾個以上，或帶進幾條以上正式收錄。 */
export const IMPORT_MOC_THRESHOLD = 2
export const IMPORT_ENTRY_THRESHOLD = 5

export type BatchReason = 'removals' | 'mocs' | 'import'

export interface UnseenMoc {
  path: string
  /** 帶進的正式收錄條數。 */
  entries: number
}

export interface BatchCheckOptions {
  /** 同一批事件裡出現、系統沒看過的 MOC（沒有上次已知狀態、也不是 App 自己建的）。 */
  unseen?: readonly UnseenMoc[]
  /** 呼叫端已知是整批匯入（例如之後 App 的匯入功能直接標）。 */
  imported?: boolean
}

export interface BatchCheckResult {
  /** true＝不直接生效，出整批檢查卡。 */
  required: boolean
  reasons: BatchReason[]
  /** 這批移除幾條收錄。 */
  removals: number
  /** 這批改到的 MOC（有會生效的差異的）。 */
  mocs: string[]
}

/**
 * 整批匯入的定義：同一批事件裡，系統沒看過的 MOC（沒有上次已知狀態、不是 App 建的；有帶收錄的才算）出現 2 個以上，
 * 或它們帶進的正式收錄合計 5 條以上。只有一個、收錄不到 5 條的新 MOC（例如 Scott 在 Obsidian 手建）照常直接生效。
 */
export function isBulkImport(unseen: readonly UnseenMoc[]): boolean {
  const withEntries = unseen.filter(item => item.entries > 0)
  return withEntries.length >= IMPORT_MOC_THRESHOLD || withEntries.reduce((sum, item) => sum + item.entries, 0) >= IMPORT_ENTRY_THRESHOLD
}

/** 同一批事件的差異（可以跨好幾個 MOC）是否要整批檢查。只有會生效的差異算數（斷鏈、格式壞只提醒）。 */
export function batchCheck(diffs: readonly ReconcileDiff[], options: BatchCheckOptions = {}): BatchCheckResult {
  const effective = diffs.filter(isEffectiveDiff)
  const removals = effective.filter(diff => diff.kind === 'remove').length
  const mocs = [...new Set(effective.map(diff => diff.mocPath))]
  const reasons: BatchReason[] = []
  if (removals >= BATCH_REMOVE_THRESHOLD) reasons.push('removals')
  if (mocs.length >= BATCH_MOC_THRESHOLD) reasons.push('mocs')
  if (options.imported || isBulkImport(options.unseen ?? [])) reasons.push('import')
  return { required: reasons.length > 0 && effective.length > 0, reasons, removals, mocs }
}

// ── 反向套回（逐條取消、退回） ───────────────────────────────

/**
 * 把差異逐條反向套回現在的 MOC 原文（整批檢查卡上取消的那幾條、或整張退回）。只動那幾行：其他區塊、Scott 同時改的文字都保留。
 * remove → 收回原章節（原關係說明）；add → 拿掉；move → 搬回；relation → 改回；chapter-rename → 改回原名。
 */
export function revertDiffs(raw: string, diffs: readonly ReconcileDiff[], options: Pick<ReconcileOptions, 'path' | 'resolve'> & { newChapterId?: () => string }): string {
  const { path, resolve } = options
  const matcher = (diff: EntryDiffBase) => (entry: MocEntry) => resolve(entry.target, path) === diff.notePath || sameTarget(entry.target, diff.target)
  let content = raw
  const ordered = [...diffs].filter(isEffectiveDiff).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  for (const diff of ordered) {
    switch (diff.kind) {
      case 'chapter-rename':
        content = renameMocChapter(content, { id: diff.chapterId, title: diff.after }, diff.before, path).content
        break
      case 'move': {
        const to = chapterRef(diff.fromChapterId, diff.fromChapterTitle, false)
        let result = moveMocEntry(content, matcher(diff), to, { newChapterId: options.newChapterId }, path)
        if (result.reason === 'no-chapter') result = moveMocEntry(content, matcher(diff), { unsorted: true }, { newChapterId: options.newChapterId }, path)
        content = result.content
        break
      }
      case 'relation':
        content = setMocEntryRelation(content, matcher(diff), diff.before, path).content
        break
      case 'remove': {
        const entry = { target: diff.target, alias: diff.alias, relation: diff.relation, newChapterId: options.newChapterId }
        let result = addMocEntry(content, { ...entry, chapter: chapterRef(diff.chapterId, diff.chapterTitle, false) }, path)
        if (result.reason === 'no-chapter') result = addMocEntry(content, { ...entry, chapter: { unsorted: true } }, path)
        content = result.content
        break
      }
      case 'add':
        content = removeMocEntry(content, matcher(diff), path).content
        break
    }
  }
  return content
}

// ── 差異 → 操作（actor＝scott） ──────────────────────────────

/** 筆記的編號與標題（runtime 讀筆記 frontmatter；測試直接給）。 */
export type NoteRefOf = (notePath: string) => { noteId?: string, noteTitle: string }

/** 會生效的差異 → ops 的操作描述（以 N／M／C 編號描述，路徑只當提示）。 */
export function diffToOpSpec(diff: EffectiveDiff, noteRef: NoteRefOf): OpSpec {
  const moc = { ...(diff.mocId ? { mocId: diff.mocId } : {}), mocName: diff.mocName, mocPath: diff.mocPath }
  if (diff.kind === 'chapter-rename') return { kind: 'moc.chapter.rename', ...moc, chapterId: diff.chapterId, before: diff.before, after: diff.after }
  const ref = noteRef(diff.notePath)
  const note = { ...(ref.noteId ? { noteId: ref.noteId } : {}), noteTitle: ref.noteTitle, notePath: diff.notePath, ...moc }
  switch (diff.kind) {
    case 'remove':
      return { kind: 'moc.entry.remove', ...note, ...(diff.chapterId ? { chapterId: diff.chapterId } : {}), ...(diff.relation ? { relation: diff.relation } : {}) }
    case 'add':
      return { kind: 'moc.entry.add', ...note, ...(diff.chapterId ? { chapterId: diff.chapterId } : {}), ...(diff.relation ? { relation: diff.relation } : {}) }
    case 'move':
      return { kind: 'moc.entry.move', ...note, ...(diff.fromChapterId ? { fromChapterId: diff.fromChapterId } : {}), ...(diff.toChapterId ? { toChapterId: diff.toChapterId } : {}) }
    case 'relation':
      return { kind: 'moc.entry.relation', ...note, ...(diff.chapterId ? { chapterId: diff.chapterId } : {}), before: diff.before, after: diff.after }
  }
}


// ── 上次已知狀態與同一批事件 ─────────────────────────────────

/** App 自己寫 MOC 的事件（lib/moc/app-writes 記下）：before＝null 是新建，undefined 是不知道原文的覆寫。 */
export interface AppWriteEvent {
  path: string
  before: string | null | undefined
  after: string
}

/** 上次已知狀態（存 note.db 的 moc_snapshots）。 */
export interface MocBaseline {
  content: string
  mocId?: string
}

/**
 * App 自己寫的 MOC 不算 Scott 的手動修改：寫入前的內容就是上次已知狀態（或 App 新建／整檔覆寫）時，上次已知狀態直接換成寫入後的內容。
 * 寫入前的內容和上次已知狀態不同（App 外的修改還沒比對，例如掃描替 Obsidian 新建的 MOC 補編號）→ 不動，讓那些修改照常比對。
 * 回傳更新過的路徑。
 */
export function applyAppWrites(baselines: Map<string, MocBaseline>, events: readonly AppWriteEvent[], mocIdOf: (raw: string) => string | undefined = () => undefined): string[] {
  const changed = new Set<string>()
  for (const event of events) {
    const known = baselines.get(event.path)
    const take = event.before === null || event.before === undefined || (known !== undefined && known.content === event.before)
    if (!take) continue
    const mocId = mocIdOf(event.after) ?? known?.mocId
    baselines.set(event.path, { content: event.after, ...(mocId ? { mocId } : {}) })
    changed.add(event.path)
  }
  return [...changed]
}

export interface MocFileNow {
  path: string
  raw: string
}

/** Fork（almanac ALMNC-85.4）：別台經 V3 同步傳來的 MOC 上次已知狀態（lib/almanac-sync/tables/moc.ts）。 */
export interface SyncedMocBaseline {
  path: string
  mocId?: string
  content: string
}

/**
 * Fork（almanac ALMNC-85.4，設計 2.11 第二層）：筆記庫放在 iCloud、Obsidian Sync 這類 App 外同步時，同步來的 MOC 看起來跟手動編輯一樣。
 * 現在的檔案內容等於別台傳來的上次已知狀態（同一個 M 編號，沒有編號的看路徑）→ 當成同步來的：上次已知狀態直接換成它，不比對、
 * 不記 ops 與 Scott 指定（那些在 A 台已記過，經 ops／scott-pins 同步過來）。M 編號相同但路徑換了（別台改名或搬家）時，舊路徑那一列拿掉。
 * 回傳要寫回的上次已知狀態（null＝刪掉那一列）。
 */
export function adoptSyncedBaselines(
  baselines: Map<string, MocBaseline>,
  files: readonly MocFileNow[],
  synced: readonly SyncedMocBaseline[],
  mocIdOf: (raw: string) => string | undefined = () => undefined,
): Map<string, MocBaseline | null> {
  const dirty = new Map<string, MocBaseline | null>()
  if (!synced.length) return dirty
  const present = new Set(files.map(file => file.path))
  for (const file of files) {
    if (baselines.get(file.path)?.content === file.raw) continue
    const mocId = mocIdOf(file.raw)
    const match = synced.find(entry => entry.content === file.raw && (mocId ? entry.mocId === mocId : entry.path === file.path))
    if (!match) continue
    const baseline: MocBaseline = { content: file.raw, ...(mocId ? { mocId } : {}) }
    baselines.set(file.path, baseline)
    dirty.set(file.path, baseline)
    if (!mocId) continue
    for (const [path, known] of [...baselines]) {
      if (path !== file.path && known.mocId === mocId && !present.has(path)) {
        baselines.delete(path)
        dirty.set(path, null)
      }
    }
  }
  return dirty
}

export interface PlannedMoc {
  path: string
  /** 上次已知狀態（null＝系統沒看過）。 */
  old: string | null
  /** 現在的檔案。 */
  current: string
  /** 上次已知狀態是依 M 編號從別的路徑找到的（MOC 改名或搬家）：那個舊路徑。 */
  movedFrom?: string
  result: ReconcileResult
}

export interface ReconcilePlan {
  /** 有變動的 MOC（現在的檔案和上次已知狀態不同）。 */
  changed: PlannedMoc[]
  /** 只建立基準、不比對的 MOC（第一次啟用時全部）。 */
  baselineOnly: MocFileNow[]
  check: BatchCheckResult
}

/**
 * 同一批事件（MocRebuildService 去抖動後的一次）：每個 MOC 拿上次已知狀態（依路徑，找不到再依 M 編號）和現在的檔案比對，
 * 合起來判斷要不要整批檢查。initialized＝false（第一次啟用、還沒有任何上次已知狀態）時只建基準、不比對，避免把既有收錄全部當成新增。
 */
export function planReconcile(input: {
  files: readonly MocFileNow[]
  baselines: ReadonlyMap<string, MocBaseline>
  initialized: boolean
  imported?: boolean
} & Omit<ReconcileOptions, 'path'>): ReconcilePlan {
  if (!input.initialized) return { changed: [], baselineOnly: [...input.files], check: batchCheck([]) }
  const byId = new Map<string, string>()
  for (const [path, baseline] of input.baselines) if (baseline.mocId) byId.set(baseline.mocId, path)
  const present = new Set(input.files.map(file => file.path))
  const changed: PlannedMoc[] = []
  for (const file of input.files) {
    let old = input.baselines.get(file.path)?.content ?? null
    let movedFrom: string | undefined
    if (old === null) {
      const id = parseMoc(file.raw, file.path).id
      const from = id ? byId.get(id) : undefined
      if (from && !present.has(from)) {
        old = input.baselines.get(from)?.content ?? null
        movedFrom = from
      }
    }
    if (old === file.raw && !movedFrom) continue
    const result = reconcileMoc(old, file.raw, { path: file.path, resolve: input.resolve, recover: input.recover, targetFor: input.targetFor })
    // 只改了收錄以外的地方（其他區塊、註解）時差異是空的，但上次已知狀態照樣要跟上，所以也列進來。
    changed.push({ path: file.path, old, current: file.raw, ...(movedFrom ? { movedFrom } : {}), result })
  }
  const diffs = changed.flatMap(item => item.result.diffs)
  const unseen = changed.filter(item => item.result.unseen).map(item => ({ path: item.path, entries: item.result.entries }))
  return { changed, baselineOnly: [], check: batchCheck(diffs, { unseen, imported: input.imported }) }
}

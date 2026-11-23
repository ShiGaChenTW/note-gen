// Fork（almanac ALMNC-69.7）：MOC 檔的最小改寫——加一條收錄、移除一條、搬動一條。只動那幾行，其他內容（含換行符號、註解、
// 分家清單、其他區塊）原樣保留。純函式；寫檔由呼叫端經編輯器協調（lib/daily/coordinated-write）。
// 收錄行格式 `- [[筆記標題]] ── 關係說明`；「尚未分章」可以沒有關係說明。每則筆記在同一個 MOC 只有一條收錄（已有就不加）。
import { MOC_HEADINGS, UNCHAPTERED_HEADING } from '@/lib/migration/domain-moc-migration'
import { formalEntries, parseMoc, targetKey, isUnsortedTitle, type MocChapter, type MocEntry, type ParsedMoc } from './parse'

/** 放到哪一章：尚未分章、依 C 編號、或依章節名稱。 */
export type ChapterRef = { unsorted: true } | { id: string } | { title: string }

/** 找收錄行：連結目標（筆記標題或路徑），或自訂比對。 */
export type EntryMatch = string | ((entry: MocEntry) => boolean)

export interface MocEditResult {
  content: string
  changed: boolean
  /** 沒有改的原因：已經收錄、找不到收錄行、找不到章節。 */
  reason?: 'exists' | 'not-found' | 'no-chapter'
}

export interface NewEntry {
  target: string
  alias?: string
  relation?: string
}

/** 收錄行文字。 */
export function renderEntryLine(entry: NewEntry): string {
  const link = entry.alias ? `[[${entry.target}|${entry.alias}]]` : `[[${entry.target}]]`
  const relation = entry.relation?.replace(/[\r\n]+/g, ' ').trim()
  return relation ? `- ${link} ── ${relation}` : `- ${link}`
}

function baseKey(key: string): string {
  return key.split('/').pop() ?? key
}

/** 連結目標比對：完全相同，或一邊只有檔名時比檔名（`[[資料夾/筆記]]` 與 `筆記`）。 */
export function sameTarget(a: string, b: string): boolean {
  const left = targetKey(a)
  const right = targetKey(b)
  if (left === right) return true
  if (!left.includes('/')) return baseKey(right) === left
  if (!right.includes('/')) return baseKey(left) === right
  return false
}

function matcher(match: EntryMatch): (entry: MocEntry) => boolean {
  return typeof match === 'string' ? entry => sameTarget(entry.target, match) : match
}

function findChapter(moc: ParsedMoc, ref: ChapterRef): MocChapter | null {
  if ('unsorted' in ref) return moc.unsorted
  if ('id' in ref) return moc.chapters.find(chapter => chapter.id === ref.id) ?? (moc.unsorted?.id === ref.id ? moc.unsorted : null)
  const title = ref.title.trim()
  return moc.chapters.find(chapter => chapter.title === title) ?? null
}

/** 原文切行（行尾 \r 留在行內，join('\n') 還原）。 */
function splitLines(raw: string): string[] {
  return raw.split('\n')
}

function withEol(text: string, eol: ParsedMoc['eol']): string {
  return eol === '\r\n' ? `${text}\r` : text
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || !line.replace(/\r$/, '').trim()
}

/** 章節裡新收錄行的位置：最後一條收錄之後；沒有收錄就接在 C 註解（或標題）之後。 */
function insertionLine(chapter: MocChapter): number {
  const last = chapter.entries[chapter.entries.length - 1]
  if (last) return last.line + 1
  return (chapter.commentLine ?? chapter.line) + 1
}

const PLACEHOLDER = /^\s*<!--\s*還沒有收錄的筆記。?\s*-->\s*$/

/** 章節區最後補一組「尚未分章」（69.6 遷移寫的「還沒有收錄」註解一併拿掉），回傳新行陣列。 */
function appendUnsortedGroup(lines: string[], moc: ParsedMoc, entryLine: string, chapterId: string): string[] {
  const out = [...lines]
  const group = [UNCHAPTERED_HEADING, `<!-- ${chapterId} -->`, entryLine].map(line => withEol(line, moc.eol))
  const section = moc.blocks.chapters
  if (section) {
    // 章節區尾端的空白行與「還沒有收錄」註解換成：空白行＋這一組＋空白行（後面還有區塊時），從最後一行內容後面接上。
    const end = section.endLine
    let last = end - 1
    while (last > section.line && (isBlank(out[last]) || PLACEHOLDER.test(out[last].replace(/\r$/, '')))) last--
    const atEof = end >= out.length || (end === out.length - 1 && out[end] === '')
    const block = [withEol('', moc.eol), ...group, ...(atEof ? [] : [withEol('', moc.eol)])]
    out.splice(last + 1, end - (last + 1), ...block)
    if (atEof && out[out.length - 1] !== '') out.push('')
    return out
  }
  // 沒有章節區：補一個 `## ③ 章節`，放在 ④ 重點結論／⑤ 待釐清之前，都沒有就放檔尾。
  const before = moc.sections.find(item => item.key === 'conclusions' || item.key === 'open')
  const block = [withEol(MOC_HEADINGS.chapters, moc.eol), withEol('', moc.eol), ...group, withEol('', moc.eol)]
  if (before) {
    out.splice(before.line, 0, ...block)
    return out
  }
  // 檔尾：確保前面有一行空白、最後有換行。
  let end = out.length
  if (out[end - 1] === '') end--
  const tail = [...(end > 0 && !isBlank(out[end - 1]) ? [withEol('', moc.eol)] : []), ...block.slice(0, -1)]
  out.splice(end, out.length - end, ...tail, '')
  return out
}

/**
 * 在指定章節（預設尚未分章）加一條收錄。這則筆記已經在這個 MOC 有正式收錄就不改（reason: exists）。
 * 要放尚未分章但還沒有這一組時，在章節區最後補上（需要 newChapterId 產生 C 編號）；指定的章節不存在 → no-chapter。
 */
export function addMocEntry(raw: string, entry: NewEntry & { chapter?: ChapterRef, newChapterId?: () => string }, path?: string): MocEditResult {
  const moc = parseMoc(raw, path)
  if (formalEntries(moc).some(({ entry: item }) => sameTarget(item.target, entry.target))) return { content: raw, changed: false, reason: 'exists' }
  const ref = entry.chapter ?? { unsorted: true }
  const lines = splitLines(raw)
  const line = renderEntryLine(entry)
  const chapter = findChapter(moc, ref)
  if (chapter) {
    lines.splice(insertionLine(chapter), 0, withEol(line, moc.eol))
    return { content: lines.join('\n'), changed: true }
  }
  if (!('unsorted' in ref) || !entry.newChapterId) return { content: raw, changed: false, reason: 'no-chapter' }
  return { content: appendUnsortedGroup(lines, moc, line, entry.newChapterId()).join('\n'), changed: true }
}

/** 移除這則筆記在這個 MOC 的正式收錄行（重複的也一起；分家清單的引用不動）。 */
export function removeMocEntry(raw: string, match: EntryMatch, path?: string): MocEditResult & { removed: MocEntry[] } {
  const moc = parseMoc(raw, path)
  const test = matcher(match)
  const chapters = [...moc.chapters, ...(moc.unsorted ? [moc.unsorted] : [])]
  const removed = chapters.flatMap(chapter => chapter.entries.filter(entry => !entry.reference && test(entry)))
  if (!removed.length) return { content: raw, changed: false, reason: 'not-found', removed: [] }
  const drop = new Set(removed.map(entry => entry.line))
  return { content: splitLines(raw).filter((_, index) => !drop.has(index)).join('\n'), changed: true, removed }
}

/** 把收錄行搬到另一章（關係說明跟著走）；目的地就是原章節時不改。 */
export function moveMocEntry(raw: string, match: EntryMatch, to: ChapterRef, options: { newChapterId?: () => string, relation?: string } = {}, path?: string): MocEditResult {
  const moc = parseMoc(raw, path)
  const test = matcher(match)
  const found = formalEntries(moc).find(({ entry }) => test(entry))
  if (!found) return { content: raw, changed: false, reason: 'not-found' }
  const destination = findChapter(moc, to)
  if (destination && destination.line === found.chapter.line) return { content: raw, changed: false }
  if (!destination && !('unsorted' in to)) return { content: raw, changed: false, reason: 'no-chapter' }
  const { entry } = found
  const removed = removeMocEntry(raw, item => item.line === entry.line, path)
  const added = addMocEntry(removed.content, { target: entry.target, alias: entry.alias, relation: options.relation ?? entry.relation, chapter: to, newChapterId: options.newChapterId }, path)
  return added.changed ? added : { content: raw, changed: false, reason: added.reason }
}

/**
 * 換人承接收錄（清理的合併、取代）：這個 MOC 裡舊筆記的正式收錄改成指向新筆記——同一行、同一章、關係說明不變（別名是舊標題，拿掉）。
 * 新筆記在這個 MOC 已經有收錄時，只留新筆記原本那條，舊的那條移除（每則筆記在同一個 MOC 只有一條）。分家清單的引用不動。
 */
export function replaceMocEntryTarget(raw: string, match: EntryMatch, newTarget: string, path?: string, isNew?: EntryMatch): MocEditResult {
  const moc = parseMoc(raw, path)
  const test = matcher(match)
  const testNew = matcher(isNew ?? newTarget)
  const formal = formalEntries(moc).map(({ entry }) => entry)
  const old = formal.filter(entry => test(entry) && !testNew(entry))
  if (!old.length) return { content: raw, changed: false, reason: 'not-found' }
  const lines = splitLines(raw)
  const drop = new Set(old.map(entry => entry.line))
  if (!formal.some(entry => testNew(entry))) {
    const [first] = old
    const eol = lines[first.line].endsWith('\r') ? '\r' : ''
    lines[first.line] = `${renderEntryLine({ target: newTarget, relation: first.relation })}${eol}`
    drop.delete(first.line)
  }
  return { content: lines.filter((_, index) => !drop.has(index)).join('\n'), changed: true }
}

/** 每週提案只描述核准的那一項；接受時可以保留其他已接受項目與無關的編輯。 */
export type MocChange =
  | { kind: 'bullet', block: 'conclusions' | 'open', before?: string, after?: string }
  | { kind: 'start', links: string[] }
  | { kind: 'move', target: string, chapterId: string, relation: string }
  | { kind: 'add-chapters', chapters: Array<{ id: string, title: string }> }
  | { kind: 'merge-chapters', from: string[], into: string }

function contentEnd(lines: string[], start: number, end: number): number {
  while (end > start && isBlank(lines[end - 1])) end--
  return end
}

function appendBlock(lines: string[], moc: ParsedMoc, block: 'start' | 'conclusions' | 'open', content: string[]): string {
  const section = moc.blocks[block]
  if (section) {
    const end = contentEnd(lines, section.line + 1, section.endLine)
    lines.splice(end, 0, ...[...(end === section.line + 1 ? [''] : []), ...content].map(line => withEol(line, moc.eol)))
  } else {
    const following = block === 'start' ? ['chapters', 'conclusions', 'open'] : block === 'conclusions' ? ['open'] : []
    const next = moc.sections.find(item => item.key && following.includes(item.key))
    const at = next?.line ?? contentEnd(lines, 0, lines.length)
    const prefix = at > 0 && !isBlank(lines[at - 1]) ? [''] : []
    lines.splice(at, 0, ...[...prefix, MOC_HEADINGS[block], '', ...content, ''].map(line => withEol(line, moc.eol)))
  }
  if (lines[lines.length - 1]?.endsWith('\r')) lines.push('')
  return lines.join('\n')
}

/** 只改整行清單項目。段落、多行項目、註解和沒有涉及的區塊保持原樣。 */
export function editableMocBullets(raw: string, moc: ParsedMoc, block: 'start' | 'conclusions' | 'open'): Array<{ line: number, text: string, prefix: string }> {
  const section = moc.blocks[block]
  if (!section) return []
  const lines = splitLines(raw)
  const items = []
  let comment = false
  let fence = false
  for (let line = section.line + 1; line < section.endLine; line++) {
    const text = lines[line].replace(/\r$/, '')
    if (comment || text.includes('<!--')) {
      comment = text.lastIndexOf('<!--') > text.lastIndexOf('-->') || (comment && !text.includes('-->'))
      continue
    }
    if (/^\s*(?:```|~~~)/.test(text)) {
      fence = !fence
      continue
    }
    const match = /^([-*+]\s+|\d+[.)]\s+)(.+)$/.exec(text)
    if (!fence && match && !/^\s+\S/.test(lines[line + 1] ?? '')) items.push({ line, text: match[2].trim(), prefix: match[1] })
  }
  return items
}

const chapterById = (moc: ParsedMoc, id: string) => {
  const matches = moc.chapters.filter(chapter => chapter.id === id && !chapter.grownInto)
  return matches.length === 1 ? matches[0] : undefined
}

/** 合併時只移除純收錄章節，完整保留各收錄行、目標章節的其他內容和分家清單。 */
function mergeChapters(raw: string, moc: ParsedMoc, base: ParsedMoc, change: Extract<MocChange, { kind: 'merge-chapters' }>): string | null {
  if (moc.chapters.length <= 7 || moc.chapters.length - change.from.length > 7 || moc.chapters.length - change.from.length < 3) return null
  const target = chapterById(moc, change.into)
  if (!target || target.title !== chapterById(base, change.into)?.title || change.from.includes(change.into)) return null
  const lines = splitLines(raw)
  const remove = new Set<number>()
  const additions: string[] = []
  for (const id of change.from) {
    const source = chapterById(moc, id)
    const original = chapterById(base, id)
    if (!source || !original || source.title !== original.title || source.entries.length !== original.entries.length) return null
    const entries = new Set(source.entries.map(entry => entry.line))
    if (source.entries.some((entry, i) => entry.reference || entry.duplicate || entry.malformed || entry.raw !== original.entries[i].raw)) return null
    for (let line = source.line; line < source.endLine; line++) {
      if (line === source.line || line === source.commentLine || isBlank(lines[line]) || entries.has(line)) remove.add(line)
      else return null
    }
    additions.push(...source.entries.map(entry => withEol(entry.raw, moc.eol)))
  }
  const at = insertionLine(target)
  lines.splice(at, 0, ...additions)
  return lines.filter((_, i) => (i >= at && i < at + additions.length) || !remove.has(i < at ? i : i - additions.length)).join('\n')
}

/** null 表示原先要改的內容已變動，或這項建議不再適用。 */
export function applyMocChange(baseRaw: string, latest: string, id: string, change: MocChange): string | null {
  const moc = parseMoc(latest)
  const base = parseMoc(baseRaw)
  if (moc.id !== id || base.id !== id || !moc.isMoc || !base.isMoc) return null
  const lines = splitLines(latest)

  if (change.kind === 'bullet') {
    const items = editableMocBullets(latest, moc, change.block)
    if (change.before === change.after || (change.after && items.some(item => item.text === change.after))) return null
    if (!change.before) return change.after ? appendBlock(lines, moc, change.block, [`- ${change.after}`]) : null
    const matches = items.filter(item => item.text === change.before)
    if (matches.length !== 1) return null
    const { line, prefix } = matches[0]
    lines.splice(line, 1, ...(change.after ? [withEol(prefix + change.after, moc.eol)] : []))
    return lines.join('\n')
  }

  if (change.kind === 'start') {
    if (moc.blocks.start?.text !== base.blocks.start?.text) return null
    const items = editableMocBullets(latest, moc, 'start')
    const selected = new Set(items.filter(item => /^\[\[[^\]]+\]\]$/.test(item.text)).map(item => item.line))
    const links = change.links.map((link, index) => `${index + 1}. ${link}`)
    if (!selected.size) return appendBlock(lines, moc, 'start', links)
    const first = selected.values().next().value
    return lines.flatMap((line, i) => i === first ? links.map(link => withEol(link, moc.eol)) : selected.has(i) ? [] : [line]).join('\n')
  }

  if (change.kind === 'move') {
    const contains = (parsed: ParsedMoc) => parsed.unsorted?.entries.find(entry => !entry.reference && !entry.duplicate && targetKey(entry.target) === targetKey(change.target))
    const current = contains(moc)
    const original = contains(base)
    const destination = chapterById(moc, change.chapterId)
    if (!current || !original || current.raw !== original.raw || !destination || destination.title !== chapterById(base, change.chapterId)?.title) return null
    const result = moveMocEntry(latest, entry => entry.line === current.line, { id: change.chapterId }, { relation: change.relation })
    return result.changed ? result.content : null
  }

  if (change.kind === 'merge-chapters') return mergeChapters(latest, moc, base, change)

  const section = moc.blocks.chapters
  if (moc.chapters.length !== base.chapters.length || moc.chapters.length >= 3 || moc.chapters.length + change.chapters.length !== 3) return null
  if (change.chapters.some(chapter => isUnsortedTitle(chapter.title) || moc.chapters.some(item => item.title === chapter.title || item.id === chapter.id))) return null
  const at = moc.unsorted?.line ?? (section ? contentEnd(lines, section.line + 1, section.endLine) : moc.blocks.conclusions?.line ?? moc.blocks.open?.line ?? contentEnd(lines, 0, lines.length))
  const prefix = at > 0 && !isBlank(lines[at - 1]) ? [''] : []
  const groups = change.chapters.flatMap(chapter => [`### ${chapter.title}`, `<!-- ${chapter.id} -->`, ''])
  lines.splice(at, 0, ...[...prefix, ...(section ? [] : [MOC_HEADINGS.chapters, '']), ...groups].map(line => withEol(line, moc.eol)))
  if (lines[lines.length - 1]?.endsWith('\r')) lines.push('')
  return lines.join('\n')
}

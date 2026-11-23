// Fork（almanac ALMNC-69.7）：MOC 檔解析器。MOC 章節區的正式收錄是筆記屬於哪些領域的唯一依據，這裡把一個 MOC 檔讀成結構。
// 純函式、不丟例外：格式壞掉的行列進 problems，其餘照常解析。最小改寫在 edit.ts，收錄 → 筆記 domains 在 membership.ts。
// 規格：almanac/2026-11-23_proposal_note-type-rules.md 第二節〈資料放哪裡〉〈MOC 頁的五個區塊〉〈在 Obsidian 直接改 MOC 時〉
// 〈長成新的 MOC〉、第五節身分編號；GLOSSARY（MOC、章節、尚未分章、正式收錄）；格式以範例 vault「20 領域/*.md」為準。
//
// 認法：
// - MOC＝frontmatter `kind: domain`。名稱＝frontmatter title，沒有就用檔名（和 69.5 掃描、69.6 遷移一致）。
// - 區塊＝`##` 標題，去掉開頭的 ①～⑤ 後比對名稱；舊標題當別名（總覽 → ①、矛盾與未解問題 → ⑤）。章節區＝標題含「章節」的 `##`
//   （同 69.5 掃描的認法）。
// - 章節＝章節區裡的 `###`，標題下一行 `<!-- C-… -->` 是 C 編號；「尚未分章」是固定的一組。標題尾巴的「→ 已長成 [[X]] MOC」
//   表示這章已經長成新 MOC（上層的分家清單）。
// - 收錄行＝章節底下開頭是 `- ` 的行，格式 `- [[筆記標題]] ── 關係說明`。分家清單的收錄、尾巴帶「`X MOC`」標記的都只是引用，
//   不算歸屬。章節區以外（從這裡開始、重點結論、待釐清）的連結也只是引用，這裡不收。
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { readFrontmatter } from '@/lib/migration/id-migration'
import { lastNameOf } from '@/lib/v3-model/id-index'
import { isId } from '@/lib/v3-model/identity'

// ── 型別 ────────────────────────────────────────────────────

/** 五區塊：① 定位問題、② 從這裡開始、③ 章節、④ 重點結論、⑤ 待釐清。 */
export type MocBlockKey = 'position' | 'start' | 'chapters' | 'conclusions' | 'open'
export const MOC_BLOCK_KEYS: readonly MocBlockKey[] = ['position', 'start', 'chapters', 'conclusions', 'open']

/** 一個 `##` 區段（認得的五區塊與其他標題都在這裡，依檔案順序）。 */
export interface MocSection {
  /** 認得的區塊；認不得的標題是 null。 */
  key: MocBlockKey | null
  /** 標題文字（去掉 `## `）。 */
  heading: string
  /** 標題行（0 起算、整份檔案的行號，含 frontmatter）。 */
  line: number
  /** 區段結束的下一行（下一個 `#`／`##` 標題或檔尾）。 */
  endLine: number
  /** 標題之後到區段結束的原文（不含標題，前後空白行去掉）。 */
  text: string
  /** 用了舊標題（例如「總覽」「矛盾與未解問題」）。 */
  legacy: boolean
}

/** 一條收錄行（或格式壞掉、但看得出連結的行）。 */
export interface MocEntry {
  /** 連結目標：`[[目標#標題|別名]]` 的「目標」（筆記標題或筆記庫相對路徑，不含 .md）。 */
  target: string
  /** `|` 後的顯示文字。 */
  alias?: string
  /** `──` 後的關係說明（去掉尾巴的 MOC 標記）；沒有就是空字串。 */
  relation: string
  /** 行號（0 起算、整份檔案）。 */
  line: number
  /** 原文（不含行尾 \r）。 */
  raw: string
  /** 尾巴的「`X MOC`」標記（分家清單的現況標記）裡的 X。 */
  mocMarker?: string
  /** 只是引用、不算歸屬：在已長成新 MOC 的章節裡，或帶 MOC 標記。 */
  reference: boolean
  /** 格式問題（有連結但少了 `──`）；仍算歸屬，見 problems。 */
  malformed?: MocProblemReason
  /** 同一個 MOC 裡同一則筆記的第二條以後（只有第一條算數）。 */
  duplicate?: boolean
}

export interface MocChapter {
  /** C 編號；標題下一行沒有合格註解時是 null。 */
  id: string | null
  /** 章節名稱（去掉「→ 已長成 [[X]] MOC」）。 */
  title: string
  /** 標題原文（去掉 `### `）。 */
  heading: string
  line: number
  /** 標題下一行是 `<!-- … -->` 時的行號。 */
  commentLine?: number
  /** 章節結束的下一行。 */
  endLine: number
  /** 「尚未分章」那一組。 */
  unsorted: boolean
  /** 這章已經長成新 MOC（標題尾巴的連結目標）。 */
  grownInto?: string
  entries: MocEntry[]
}

export type MocProblemReason =
  /** 清單行沒有 `[[ ]]`。 */
  | 'no-link'
  /** 章節（尚未分章除外）的收錄行少了 `──`。 */
  | 'no-relation'
  /** 清單行不是以 `[[ ]]` 開頭。 */
  | 'link-not-first'
  /** 同一則筆記在同一個 MOC 有第二條收錄。 */
  | 'duplicate'
  /** 章節區裡、第一個 `###` 之前的收錄行。 */
  | 'outside-chapter'
  /** frontmatter 解析失敗。 */
  | 'frontmatter'

export interface MocProblem {
  reason: MocProblemReason
  /** 行號（frontmatter 問題是 0）。 */
  line: number
  text: string
}

export interface ParsedMoc {
  /** 筆記庫相對路徑（有給才有）。 */
  path?: string
  /** M 編號（frontmatter id 合格才有）。 */
  id?: string
  /** 領域名稱：frontmatter title → 檔名 → 第一個 H1。 */
  name: string
  /** 第一個 `# ` 標題。 */
  heading?: string
  /**
   * Fork（almanac ALMNC-69.8）：第一個 `# ` 標題到第一個 `##` 之間的原文（前後空白去掉）；頁首「上層／相關／相鄰」那一行在這裡，
   * 由 lib/domain-page/moc-view.ts 的 parseMocHeader 讀。沒有 H1 時是內文開頭到第一個 `##`。
   */
  preamble?: string
  /** 上層 MOC 的 M 編號（frontmatter parent）。 */
  parent?: string
  level?: number
  /** frontmatter status（例如探索中）。 */
  status?: string
  /** frontmatter 是 `kind: domain`。 */
  isMoc: boolean
  /** 其他 frontmatter 欄位（id、title、kind、level、parent、status 以外）。 */
  frontmatter: Record<string, unknown>
  /** 全部 `##` 區段，依檔案順序。 */
  sections: MocSection[]
  /** 五區塊（同一區塊有兩個標題時取第一個）。 */
  blocks: Partial<Record<MocBlockKey, MocSection>>
  /** 一般章節（不含尚未分章），依檔案順序。 */
  chapters: MocChapter[]
  /** 「尚未分章」那一組；沒有就是 null。 */
  unsorted: MocChapter | null
  problems: MocProblem[]
  /** 原文用的換行（寫回時沿用）。 */
  eol: '\n' | '\r\n'
  /** 第一行內文（frontmatter 之後）的行號。 */
  bodyLine: number
}

// ── 標題對照 ────────────────────────────────────────────────

const BLOCK_NAMES: Record<MocBlockKey, { current: readonly string[], legacy: readonly string[] }> = {
  position: { current: ['這個領域在回答什麼', '这个领域在回答什么', '定位問題', '定位问题', 'positioning question'], legacy: ['總覽', '总览', 'overview'] },
  start: { current: ['從這裡開始', '从这里开始', 'start here'], legacy: [] },
  chapters: { current: ['章節', '章节', 'chapters'], legacy: [] },
  conclusions: { current: ['重點結論', '重点结论', 'key conclusions'], legacy: [] },
  open: { current: ['待釐清', '待厘清', 'open questions'], legacy: ['矛盾與未解問題', '矛盾与未解问题', 'contradictions and open questions'] },
}

export const UNSORTED_TITLES: readonly string[] = ['尚未分章', '未分章', 'unsorted']

const CIRCLED = /^[①②③④⑤⑥⑦⑧⑨]\s*/

function normalizeHeading(text: string): string {
  return text.replace(CIRCLED, '').trim().toLowerCase()
}

/** `##` 標題文字 → 區塊（認不得就是 null）。章節區認「含章節」的標題，和 69.5 掃描一致。 */
export function blockOfHeading(heading: string): { key: MocBlockKey, legacy: boolean } | null {
  const text = normalizeHeading(heading)
  for (const key of MOC_BLOCK_KEYS) {
    const names = BLOCK_NAMES[key]
    if (names.current.some(name => name.toLowerCase() === text)) return { key, legacy: false }
    if (names.legacy.some(name => name.toLowerCase() === text)) return { key, legacy: true }
  }
  if (/章節|章节/.test(heading) || text === 'chapters') return { key: 'chapters', legacy: false }
  return null
}

export function isUnsortedTitle(title: string): boolean {
  const text = title.trim().toLowerCase()
  return UNSORTED_TITLES.some(name => name.toLowerCase() === text)
}

// ── 收錄行 ──────────────────────────────────────────────────

const H1 = /^#\s+(.+?)\s*#*\s*$/
const H2 = /^##\s+(.+?)\s*#*\s*$/
const H3 = /^###\s+(.+?)\s*#*\s*$/
const LEVEL_1_OR_2 = /^#{1,2}\s/
const COMMENT_LINE = /^\s*<!--\s*(.*?)\s*-->\s*$/
const LIST_ITEM = /^[-*+]\s+(.*)$/
const WIKILINK = /\[\[([^\]\n]+)\]\]/
const SEPARATOR = /^\s*─{2,}\s*/
const GROWN = /\s*→\s*已長成\s*\[\[([^\]\n]+)\]\]\s*(?:MOC)?\s*$/
const MOC_MARKER = /\s*`([^`\n]+?)\s+MOC`\s*$/

/** `[[目標#標題|別名]]` 的內文 → 目標與別名。 */
export function splitLinkInner(inner: string): { target: string, alias?: string } {
  const [targetAndHeading, ...rest] = inner.split('|')
  const target = targetAndHeading.split('#')[0].trim().replace(/\.md$/i, '')
  const alias = rest.join('|').trim()
  return alias ? { target, alias } : { target }
}

/** 比對收錄目標用的 key：去掉 .md、統一斜線、不分大小寫。 */
export function targetKey(target: string): string {
  return target.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\.md$/i, '').toLowerCase()
}

export interface ParsedEntryLine {
  entry?: Omit<MocEntry, 'line' | 'reference' | 'duplicate'>
  problem?: MocProblemReason
}

/**
 * 一行清單項目 → 收錄。`requireRelation`：一般章節要有 `──`（尚未分章可以沒有）。
 * 沒有連結 → no-link；連結不在最前面 → link-not-first（都不算收錄）；有連結但少了 `──` → 照樣算收錄，標 no-relation。
 */
export function parseEntryLine(line: string, requireRelation: boolean): ParsedEntryLine {
  const item = LIST_ITEM.exec(line)
  if (!item) return {}
  const content = item[1]
  const link = WIKILINK.exec(content)
  if (!link) return { problem: 'no-link' }
  if (link.index !== 0) return { problem: 'link-not-first' }
  const { target, alias } = splitLinkInner(link[1])
  if (!target) return { problem: 'no-link' }
  let rest = content.slice(link[0].length)
  let mocMarker: string | undefined
  const marker = MOC_MARKER.exec(rest)
  if (marker) {
    mocMarker = marker[1].trim()
    rest = rest.slice(0, marker.index)
  }
  const separator = SEPARATOR.exec(rest)
  const relation = separator ? rest.slice(separator[0].length).trim() : ''
  const malformed: MocProblemReason | undefined = !separator && (rest.trim() || requireRelation) ? 'no-relation' : undefined
  return {
    entry: { target, ...(alias ? { alias } : {}), relation, raw: line, ...(mocMarker ? { mocMarker } : {}), ...(malformed ? { malformed } : {}) },
    ...(malformed ? { problem: malformed } : {}),
  }
}

// ── 主函式 ─────────────────────────────────────────────────

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const KNOWN_KEYS = new Set(['id', 'title', 'kind', 'level', 'parent', 'status'])

/** 解析一個 MOC 檔。path 用來當名稱（沒有 title 時）與回報。 */
export function parseMoc(raw: string, path?: string): ParsedMoc {
  const eol: '\n' | '\r\n' = raw.includes('\r\n') ? '\r\n' : '\n'
  const { block } = splitFrontmatter(raw)
  const bodyLine = block ? block.split('\n').length - 1 : 0
  const problems: MocProblem[] = []
  const data = readFrontmatter(raw)
  if (data === null) problems.push({ reason: 'frontmatter', line: 0, text: 'frontmatter 解析失敗' })
  const fm = data ?? {}
  const frontmatter: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fm)) if (!KNOWN_KEYS.has(key)) frontmatter[key] = value

  const lines = raw.split('\n').map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
  const sections: MocSection[] = []
  const chapters: MocChapter[] = []
  let heading: string | undefined
  let preambleStart = bodyLine
  let preambleEnd: number | null = null
  let fence = false
  let openSection: { key: MocBlockKey | null, heading: string, line: number, legacy: boolean } | null = null
  let chapter: MocChapter | null = null
  const seen = new Set<string>()

  const closeChapter = (end: number) => {
    if (!chapter) return
    chapter.endLine = end
    chapters.push(chapter)
    chapter = null
  }
  const closeSection = (end: number) => {
    closeChapter(end)
    if (!openSection) return
    sections.push({ ...openSection, endLine: end, text: lines.slice(openSection.line + 1, end).join('\n').trim() })
    openSection = null
  }

  for (let i = bodyLine; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    if (LEVEL_1_OR_2.test(line)) {
      closeSection(i)
      const h1 = H1.exec(line)
      if (h1) {
        if (heading === undefined && preambleEnd === null) preambleStart = i + 1
        heading ??= h1[1]
        continue
      }
      const h2 = H2.exec(line)
      if (h2) {
        preambleEnd ??= i
        const block = blockOfHeading(h2[1])
        openSection = { key: block?.key ?? null, heading: h2[1], line: i, legacy: block?.legacy ?? false }
      }
      continue
    }
    if (!openSection || openSection.key !== 'chapters') continue
    const h3 = H3.exec(line)
    if (h3) {
      closeChapter(i)
      const grown = GROWN.exec(h3[1])
      const title = (grown ? h3[1].slice(0, grown.index) : h3[1]).trim()
      const next: MocChapter = { id: null, title, heading: h3[1], line: i, endLine: i + 1, unsorted: isUnsortedTitle(title), entries: [] }
      if (grown) next.grownInto = splitLinkInner(grown[1]).target
      const comment = i + 1 < lines.length ? COMMENT_LINE.exec(lines[i + 1]) : null
      if (comment) {
        next.commentLine = i + 1
        if (isId(comment[1], 'C')) next.id = comment[1]
      }
      chapter = next
      continue
    }
    if (!LIST_ITEM.test(line)) continue
    const current: MocChapter | null = chapter
    const parsed = parseEntryLine(line, current ? !current.unsorted : true)
    if (!current) {
      if (parsed.entry) problems.push({ reason: 'outside-chapter', line: i, text: line })
      continue
    }
    if (!parsed.entry) {
      // 分家清單裡「分家後新增的 N 則不列在這裡」這類說明行不是收錄，不算格式問題。
      if (parsed.problem && !current.grownInto) problems.push({ reason: parsed.problem, line: i, text: line })
      continue
    }
    const reference = Boolean(current.grownInto || parsed.entry.mocMarker)
    if (parsed.problem && !reference) problems.push({ reason: parsed.problem, line: i, text: line })
    const entry: MocEntry = { ...parsed.entry, line: i, reference }
    if (!reference) {
      const key = targetKey(entry.target)
      if (seen.has(key)) {
        entry.duplicate = true
        problems.push({ reason: 'duplicate', line: i, text: line })
      }
      seen.add(key)
    }
    current.entries.push(entry)
  }
  closeSection(lines.length)
  const preamble = lines.slice(preambleStart, preambleEnd ?? lines.length).join('\n').trim()

  const blocks: Partial<Record<MocBlockKey, MocSection>> = {}
  for (const section of sections) if (section.key && !blocks[section.key]) blocks[section.key] = section

  const id = stringValue(fm.id)
  const parent = stringValue(fm.parent)
  const level = typeof fm.level === 'number' ? fm.level : Number.isFinite(Number(fm.level)) && fm.level !== undefined && fm.level !== null && fm.level !== '' ? Number(fm.level) : undefined
  const name = stringValue(fm.title) ?? (path ? lastNameOf(path) : undefined) ?? heading ?? ''
  const unsorted = chapters.find(item => item.unsorted) ?? null
  return {
    ...(path !== undefined ? { path } : {}),
    ...(id && isId(id, 'M') ? { id } : {}),
    name,
    ...(heading ? { heading } : {}),
    ...(preamble ? { preamble } : {}),
    ...(parent && isId(parent, 'M') ? { parent } : {}),
    ...(level !== undefined ? { level } : {}),
    ...(stringValue(fm.status) ? { status: stringValue(fm.status) } : {}),
    isMoc: typeof fm.kind === 'string' && fm.kind.trim().toLowerCase() === 'domain',
    frontmatter,
    sections,
    blocks,
    chapters: chapters.filter(item => !item.unsorted),
    unsorted,
    problems,
    eol,
    bodyLine,
  }
}

/** 正式收錄（算歸屬的）：章節與尚未分章裡，不是引用、不是重複的收錄行，依檔案順序。 */
export function formalEntries(moc: Pick<ParsedMoc, 'chapters' | 'unsorted'>): Array<{ entry: MocEntry, chapter: MocChapter }> {
  const all = [...moc.chapters, ...(moc.unsorted ? [moc.unsorted] : [])].sort((a, b) => a.line - b.line)
  return all.flatMap(chapter => chapter.entries.filter(entry => !entry.reference && !entry.duplicate).map(entry => ({ entry, chapter })))
}

/** 區塊原文拆成條目（清單項目各一條，否則每段一條）；HTML 註解不算內容。領域頁顯示重點結論、待釐清用。 */
export function blockItems(text: string): string[] {
  const items: string[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) items.push(paragraph.join(' ').trim())
    paragraph = []
  }
  for (const line of stripComments(text).split('\n')) {
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (bullet) {
      flush()
      if (bullet[1].trim()) items.push(bullet[1].trim())
    } else if (!line.trim()) {
      flush()
    } else {
      paragraph.push(line.trim())
    }
  }
  flush()
  return items.filter(Boolean)
}

/** 去掉 HTML 註解（`<!-- … -->`，可跨行）。 */
export function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

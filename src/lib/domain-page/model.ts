// Fork（almanac ALMNC-54.23）：領域頁的資料整理。純函式，不碰畫面與資料庫。
// 領域表只存名稱、上層與總覽（Markdown，src/db/v3-domains.ts）；核心概念、重點結論、矛盾與未解問題是總覽裡的 `## 標題` 段落
// （整理時 lib/cleanup/plan.ts 會把待查證的衝突寫進「矛盾與未解問題」）。這裡把總覽拆成段落、把領域的知識筆記從筆記庫索引找出來。
// 沒有的段落就是空的，畫面顯示空狀態；不替沒有寫的內容編造。
// Fork（almanac ALMNC-69.7）：資料來源改成 MOC 檔——成員是 MOC 章節區的正式收錄（依 MOC 順序），段落從五區塊取
// （① 定位問題 → 總覽、④ → 重點結論、⑤ → 待釐清），見 domainPageData。還沒有 MOC 檔的舊領域才退回 frontmatter 反查與領域表的總覽。
// 畫面改版（五區塊、章節分組）是 ALMNC-69.8，這裡只換資料來源。
import { canonicalDomainIds, domainLookup, domainPath, type Domain } from '@/lib/v3-model/domain'
import { NOTE_STATUSES, type NoteStatus } from '@/lib/v3-model/note'
import { blockItems, formalEntries, stripComments, type ParsedMoc } from '@/lib/moc/parse'

export interface DomainSections {
  /** 總覽段落（沒有 `## 總覽` 標題時，用第一個標題之前、`# 領域名稱` 之後的文字）。 */
  summary: string
  coreConcepts: string[]
  keyConclusions: string[]
  openQuestions: string[]
}

type SectionKey = keyof DomainSections

// 筆記庫內容的標題：預設寫繁中（cleanup 的 NoteWords），簡中與英文也認得。
const HEADINGS: Record<SectionKey, readonly string[]> = {
  summary: ['總覽', '总览', 'overview'],
  coreConcepts: ['核心概念', 'core concepts'],
  keyConclusions: ['重點結論', '重点结论', 'key conclusions'],
  openQuestions: ['矛盾與未解問題', '矛盾与未解问题', 'contradictions and open questions'],
}

function sectionKeyOf(heading: string): SectionKey | undefined {
  const text = heading.trim().toLowerCase()
  return (Object.keys(HEADINGS) as SectionKey[]).find(key => HEADINGS[key].includes(text))
}

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/

/** 段落內容拆成條目：清單項目各一條，否則每個段落一條。 */
function itemsOf(lines: readonly string[]): string[] {
  const items: string[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) items.push(paragraph.join(' ').trim())
    paragraph = []
  }
  for (const line of lines) {
    const bullet = BULLET.exec(line)
    if (bullet) {
      flush()
      if (bullet[1].trim()) items.push(bullet[1].trim())
    } else if (!line.trim()) {
      flush()
    } else if (/^\s{2,}\S/.test(line) && items.length && !paragraph.length) {
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`
    } else {
      paragraph.push(line.trim())
    }
  }
  flush()
  return items.filter(Boolean)
}

export function parseDomainSections(overview: string): DomainSections {
  const result: DomainSections = { summary: '', coreConcepts: [], keyConclusions: [], openQuestions: [] }
  const lines = overview.replace(/\r\n?/g, '\n').split('\n')
  const preamble: string[] = []
  const sections = new Map<SectionKey, string[]>()
  let current: SectionKey | 'other' | null = null
  let fence = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h2 = fence ? null : /^##\s+(.*?)\s*#*\s*$/.exec(line)
    if (h2) {
      current = sectionKeyOf(h2[1]) ?? 'other'
      if (current !== 'other' && !sections.has(current)) sections.set(current, [])
      continue
    }
    if (!fence && /^#\s/.test(line) && current === null) continue
    if (current === null) preamble.push(line)
    else if (current !== 'other') sections.get(current)!.push(line)
  }
  const summaryLines = sections.get('summary') ?? preamble
  result.summary = summaryLines.join('\n').trim()
  result.coreConcepts = itemsOf(sections.get('coreConcepts') ?? [])
  result.keyConclusions = itemsOf(sections.get('keyConclusions') ?? [])
  result.openQuestions = itemsOf(sections.get('openQuestions') ?? [])
  return result
}

/** 條目文字裡的片段：純文字，或 `[[筆記]]` 連結（target 是 `#`、`|` 之前的部分）。 */
export type TextPart = { kind: 'text', text: string } | { kind: 'link', target: string, label: string }

export function splitWikiLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ kind: 'text', text: text.slice(last, index) })
    const [targetAndHeading, alias] = match[1].split('|')
    const target = targetAndHeading.split('#')[0].trim()
    parts.push({ kind: 'link', target, label: (alias ?? targetAndHeading).trim() || target })
    last = index + match[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

/** 領域頁列出的一則知識筆記。 */
export interface DomainNote {
  path: string
  title: string
  summary: string
  status: NoteStatus
  /** frontmatter 的最後確認日期（YYYY-MM-DD）。 */
  lastConfirmed?: string
}

export interface NoteLike {
  path: string
  frontmatter: Record<string, unknown> | null
  headings?: ReadonlyArray<{ level: number, text: string }>
  /** 檔案修改時間（毫秒）；MOC 的「更新」日期用。 */
  mtime?: number
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string' || typeof item === 'number').map(item => String(item).trim()).filter(Boolean)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function titleOf(note: NoteLike): string {
  const fromFrontmatter = text(note.frontmatter?.title)
  if (fromFrontmatter) return fromFrontmatter
  const h1 = note.headings?.find(heading => heading.level === 1)?.text.trim()
  if (h1) return h1
  return (note.path.split('/').pop() ?? note.path).replace(/\.md$/i, '')
}

/**
 * frontmatter 是知識筆記（type: knowledge）而且列了這個領域的筆記；依標題排序。
 * Fork（almanac ALMNC-69.4）：domains 存領域名稱（舊資料是 dom_ id）；給 domains 時兩種都換成領域 id 當 key。
 */
function domainNoteOf(note: NoteLike): DomainNote {
  const fm = note.frontmatter ?? {}
  const status = (NOTE_STATUSES as readonly string[]).includes(text(fm.status)) ? text(fm.status) as NoteStatus : 'valid'
  const lastConfirmed = /^\d{4}-\d{2}-\d{2}$/.test(text(fm.lastConfirmed)) ? text(fm.lastConfirmed) : undefined
  return { path: note.path, title: titleOf(note), summary: text(fm.summary), status, lastConfirmed }
}

export function knowledgeNotesByDomain(notes: Iterable<NoteLike>, domains: readonly Pick<Domain, 'id' | 'name'>[] = []): Map<string, DomainNote[]> {
  const lookup = domainLookup(domains)
  const byDomain = new Map<string, DomainNote[]>()
  for (const note of notes) {
    const fm = note.frontmatter
    if (!fm || text(fm.type) !== 'knowledge') continue
    const entry = domainNoteOf(note)
    for (const id of canonicalDomainIds(stringList(fm.domains), lookup)) {
      const list = byDomain.get(id) ?? []
      list.push(entry)
      byDomain.set(id, list)
    }
  }
  for (const list of byDomain.values()) list.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant') || a.path.localeCompare(b.path))
  return byDomain
}

export interface DomainNode {
  domain: Domain
  /** 顯示用路徑，例如「工程 › 資料工程」。 */
  path: string
  notes: DomainNote[]
  children: DomainNode[]
}

/** 領域清單（最多兩層）：頂層與下層各依名稱排序；上層不存在的領域當成頂層，避免整個消失。 */
export function buildDomainTree(domains: readonly Domain[], notesByDomain: ReadonlyMap<string, DomainNote[]>): DomainNode[] {
  const ids = new Set(domains.map(domain => domain.id))
  const node = (domain: Domain): DomainNode => ({
    domain,
    path: domainPath(domains, domain.id) ?? domain.name,
    notes: notesByDomain.get(domain.id) ?? [],
    children: [],
  })
  const byName = (a: Domain, b: Domain) => a.name.localeCompare(b.name, 'zh-Hant') || a.id.localeCompare(b.id)
  const roots = domains.filter(domain => !domain.parentId || !ids.has(domain.parentId)).sort(byName).map(node)
  for (const root of roots) {
    root.children = domains.filter(domain => domain.parentId === root.domain.id).sort(byName).map(node)
  }
  return roots
}

export function findDomainNode(tree: readonly DomainNode[], id: string): DomainNode | undefined {
  for (const root of tree) {
    if (root.domain.id === id) return root
    const child = root.children.find(item => item.domain.id === id)
    if (child) return child
  }
  return undefined
}

/** 相關領域：上層、下層與同一上層底下的其他領域（最多兩層，所以就這三種）。 */
export function relatedDomains(tree: readonly DomainNode[], id: string): { parent?: DomainNode, children: DomainNode[], siblings: DomainNode[] } {
  const root = tree.find(item => item.domain.id === id)
  if (root) return { children: root.children, siblings: [] }
  const parent = tree.find(item => item.children.some(child => child.domain.id === id))
  if (!parent) return { children: [], siblings: [] }
  return { parent, children: [], siblings: parent.children.filter(child => child.domain.id !== id) }
}

// ── Fork（almanac ALMNC-69.7）：MOC 當資料來源 ──────────────────────

/** MOC 五區塊 → 領域頁現有的段落（① → 總覽、④ → 重點結論、⑤ → 待釐清；HTML 註解不算內容）。 */
export function sectionsFromMoc(moc: Pick<ParsedMoc, 'blocks'>): DomainSections {
  return {
    summary: stripComments(moc.blocks.position?.text ?? ''),
    coreConcepts: [],
    keyConclusions: blockItems(moc.blocks.conclusions?.text ?? ''),
    openQuestions: blockItems(moc.blocks.open?.text ?? ''),
  }
}

/** MOC 的成員：章節區正式收錄連到的筆記，依 MOC 順序（章節 → 尚未分章）、不重複；連不到的（斷鏈）略過。 */
export function notesFromMoc(moc: ParsedMoc, notes: ReadonlyMap<string, NoteLike>, resolve: (target: string, mocPath: string | undefined) => string | null): DomainNote[] {
  const out: DomainNote[] = []
  const seen = new Set<string>()
  for (const { entry } of formalEntries(moc)) {
    const path = resolve(entry.target, moc.path)
    const note = path ? notes.get(path) : undefined
    if (!note || seen.has(note.path)) continue
    seen.add(note.path)
    out.push(domainNoteOf(note))
  }
  return out
}

export interface DomainPageData {
  /** 領域表的列＋只有 MOC 檔、表裡還沒有的領域（id 用 M 編號）。 */
  domains: Domain[]
  notesByDomain: Map<string, DomainNote[]>
  sectionsByDomain: Map<string, DomainSections>
  /** 領域 id → 它的 MOC 檔（有的才有）。 */
  mocByDomain: Map<string, ParsedMoc>
}

/**
 * 領域頁的資料：有 MOC 檔的領域（依 id＝M 編號或名稱對到）成員與段落都從 MOC 來；沒有 MOC 檔的舊領域退回 frontmatter 反查
 * 與領域表總覽。MOC 有、表裡沒有的領域也列出來（表只是快取）。
 */
export function domainPageData(
  rows: readonly Domain[],
  mocs: readonly ParsedMoc[],
  notes: ReadonlyMap<string, NoteLike>,
  resolve: (target: string, mocPath: string | undefined) => string | null,
): DomainPageData {
  const mocByDomain = new Map<string, ParsedMoc>()
  const used = new Set<ParsedMoc>()
  for (const row of rows) {
    const moc = mocs.find(item => !used.has(item) && item.id && item.id === row.id) ?? mocs.find(item => !used.has(item) && item.name.trim() === row.name.trim())
    if (!moc) continue
    used.add(moc)
    mocByDomain.set(row.id, moc)
  }
  const domains: Domain[] = rows.map(row => {
    const moc = mocByDomain.get(row.id)
    const mtime = moc?.path ? notes.get(moc.path)?.mtime : undefined
    return moc && mtime ? { ...row, updatedAt: mtime } : row
  })
  const extra = mocs.filter(moc => !used.has(moc) && moc.name.trim())
  const idOfMoc = (moc: ParsedMoc) => [...mocByDomain].find(([, item]) => item === moc)?.[0] ?? moc.id ?? `moc:${moc.path ?? moc.name}`
  for (const moc of extra) {
    const id = moc.id ?? `moc:${moc.path ?? moc.name}`
    mocByDomain.set(id, moc)
  }
  for (const moc of extra) {
    const parent = moc.parent ? mocs.find(item => item.id === moc.parent) : undefined
    const mtime = moc.path ? notes.get(moc.path)?.mtime ?? 0 : 0
    domains.push({ id: idOfMoc(moc), name: moc.name.trim(), parentId: parent ? idOfMoc(parent) : undefined, overview: '', createdAt: mtime, updatedAt: mtime })
  }
  const fallback = knowledgeNotesByDomain(notes.values(), rows)
  const notesByDomain = new Map<string, DomainNote[]>()
  const sectionsByDomain = new Map<string, DomainSections>()
  for (const domain of domains) {
    const moc = mocByDomain.get(domain.id)
    notesByDomain.set(domain.id, moc ? notesFromMoc(moc, notes, resolve) : fallback.get(domain.id) ?? [])
    sectionsByDomain.set(domain.id, moc ? sectionsFromMoc(moc) : parseDomainSections(domain.overview))
  }
  return { domains, notesByDomain, sectionsByDomain, mocByDomain }
}

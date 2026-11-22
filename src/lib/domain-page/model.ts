// Fork（almanac ALMNC-54.23）：領域頁的資料整理。純函式，不碰畫面與資料庫。
// 領域表只存名稱、上層與總覽（Markdown，src/db/v3-domains.ts）；核心概念、重點結論、矛盾與未解問題是總覽裡的 `## 標題` 段落
// （整理時 lib/cleanup/plan.ts 會把待查證的衝突寫進「矛盾與未解問題」）。這裡把總覽拆成段落、把領域的知識筆記從筆記庫索引找出來。
// 沒有的段落就是空的，畫面顯示空狀態；不替沒有寫的內容編造。
import { domainPath, type Domain } from '@/lib/v3-model/domain'
import { NOTE_STATUSES, type NoteStatus } from '@/lib/v3-model/note'

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

/** frontmatter 是知識筆記（type: knowledge）而且列了這個領域的筆記；依標題排序。 */
export function knowledgeNotesByDomain(notes: Iterable<NoteLike>): Map<string, DomainNote[]> {
  const byDomain = new Map<string, DomainNote[]>()
  for (const note of notes) {
    const fm = note.frontmatter
    if (!fm || text(fm.type) !== 'knowledge') continue
    const status = (NOTE_STATUSES as readonly string[]).includes(text(fm.status)) ? text(fm.status) as NoteStatus : 'valid'
    const lastConfirmed = /^\d{4}-\d{2}-\d{2}$/.test(text(fm.lastConfirmed)) ? text(fm.lastConfirmed) : undefined
    const entry: DomainNote = { path: note.path, title: titleOf(note), summary: text(fm.summary), status, lastConfirmed }
    for (const id of new Set(stringList(fm.domains))) {
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

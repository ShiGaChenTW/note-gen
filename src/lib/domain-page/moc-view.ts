// Fork（almanac ALMNC-69.8）：MOC 頁五區塊的畫面資料。純函式，不碰畫面與資料庫。
// 規格：almanac/2026-11-23_proposal_note-type-rules.md 第二節〈MOC 頁的五個區塊〉〈章節的規則〉〈還沒有領域時〉〈由 Scott 發起：探索〉；
// GLOSSARY（MOC、章節、從這裡開始、重點結論、待釐清、未歸屬、探索中）；格式以範例 vault「20 領域/*.md」為準。
//
// 顯示條件（規格表格「何時顯示」）：
// - ① 定位問題：一直顯示（沒寫就顯示空狀態）。
// - ② 從這裡開始：正式收錄的筆記滿 6 則才出現（而且要有內容；沒內容就不出現，不替它編造）。
// - ③ 章節：一直顯示。章節依檔案順序；「尚未分章」放最下面、沒有筆記不顯示；0 則的章節在探索中的 MOC 標「知識缺口：還沒有筆記」。
// - ④ 重點結論、⑤ 待釐清：有內容才出現。待釐清分矛盾／未解／知識缺口，每項標來源（`（來源：…）`）。
// - 頁首：上層（frontmatter parent 的 M 編號優先，頁首連結只是給人看的）、相關、相鄰（由 MOC 檔頁首那一行讀）。
import { NOTE_STATUSES, type NoteStatus } from '@/lib/v3-model/note'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { blockItems, formalEntries, splitLinkInner, stripComments, type ParsedMoc } from '@/lib/moc/parse'
import type { DomainNote, DomainSections, NoteLike } from './model'

/** 「從這裡開始」出現的門檻：正式收錄滿 6 則。 */
export const START_HERE_THRESHOLD = 6

// ── 頁首 ────────────────────────────────────────────────────

/** 頁首列出的一個領域：`[[X]]` 連結或純文字（例如「習慣養成（還沒建立）」）。 */
export interface HeaderItem {
  /** 領域名稱（連結目標，或純文字本身）。 */
  name: string
  /** 顯示文字（連結的別名，否則同 name）。 */
  label: string
  /** 寫成 `[[ ]]` 連結。 */
  linked: boolean
  /** 尾巴括號裡的註記，例如「還沒建立」。 */
  note?: string
}

export interface MocHeader {
  parent: HeaderItem[]
  related: HeaderItem[]
  adjacent: HeaderItem[]
  owner?: string
  confirmed?: string
}

type HeaderField = 'parent' | 'related' | 'adjacent' | 'owner' | 'confirmed'

// 筆記庫內容預設寫繁中（範例 vault），簡中與英文也認得。
const HEADER_LABELS: Record<HeaderField, readonly string[]> = {
  parent: ['上層', '上层', 'Parent'],
  related: ['相關', '相关', 'Related'],
  adjacent: ['相鄰', '相邻', 'Adjacent'],
  owner: ['負責', '负责', 'Owner'],
  confirmed: ['最後確認', '最后确认', 'Last confirmed'],
}

const LABEL_TO_FIELD = new Map<string, HeaderField>()
for (const [field, labels] of Object.entries(HEADER_LABELS) as Array<[HeaderField, readonly string[]]>) {
  for (const label of labels) LABEL_TO_FIELD.set(label.toLowerCase(), field)
}
const LABEL_RE = new RegExp(`(?:^|[\\s\\u3000|｜])(${[...LABEL_TO_FIELD.keys()].map(label => label.replace(/\s+/g, '\\s+')).join('|')})\\s*[：:]`, 'giu')

const OPEN_BRACKETS = '（(「『【'
const CLOSE_BRACKETS = '）)」』】'

/** 用頓號／逗號拆清單，`[[ ]]` 與括號裡的不拆。 */
export function splitList(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let link = 0
  let current = ''
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (value.startsWith('[[', i)) { link++; current += '[['; i++; continue }
    if (value.startsWith(']]', i) && link > 0) { link--; current += ']]'; i++; continue }
    if (OPEN_BRACKETS.includes(char)) depth++
    else if (CLOSE_BRACKETS.includes(char) && depth > 0) depth--
    if (depth === 0 && link === 0 && /[、，,;；]/.test(char)) {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/** 一個清單項目 → 頁首項目：`[[X|別名]]（註記）` 或 `純文字（註記）`。 */
export function headerItem(text: string): HeaderItem | null {
  let base = text.trim().replace(/[　\s]+$/u, '')
  let note: string | undefined
  const trailing = /^(.*?)\s*[（(]([^（()）]*(?:[（(][^（()）]*[）)][^（()）]*)*)[）)]\s*$/u.exec(base)
  if (trailing && trailing[1].trim()) {
    base = trailing[1].trim()
    note = trailing[2].trim() || undefined
  }
  const link = /^\[\[([^\]\n]+)\]\]$/.exec(base)
  if (link) {
    const { target, alias } = splitLinkInner(link[1])
    if (!target) return null
    return { name: target, label: alias ?? target, linked: true, ...(note ? { note } : {}) }
  }
  if (!base) return null
  return { name: base, label: base, linked: false, ...(note ? { note } : {}) }
}

/** MOC 頁首（H1 到第一個 `##` 之間）→ 上層、相關、相鄰、負責、最後確認。同一欄位出現兩次時接在後面。 */
export function parseMocHeader(preamble: string | undefined): MocHeader {
  const header: MocHeader = { parent: [], related: [], adjacent: [] }
  for (const line of stripComments(preamble ?? '').split('\n')) {
    if (/^\s*>/.test(line)) continue
    const marks = [...line.matchAll(LABEL_RE)].map(match => ({
      field: LABEL_TO_FIELD.get(match[1].replace(/\s+/g, ' ').toLowerCase())!,
      start: (match.index ?? 0),
      valueStart: (match.index ?? 0) + match[0].length,
    }))
    marks.forEach((mark, index) => {
      const value = line.slice(mark.valueStart, index + 1 < marks.length ? marks[index + 1].start : line.length).replace(/^[\s　]+|[\s　|｜]+$/gu, '')
      if (!value) return
      if (mark.field === 'owner' || mark.field === 'confirmed') {
        header[mark.field] ??= value
        return
      }
      for (const part of splitList(value)) {
        const item = headerItem(part)
        if (item) header[mark.field].push(item)
      }
    })
  }
  return header
}

// ── 待釐清 ──────────────────────────────────────────────────

export type OpenKind = 'contradiction' | 'unresolved' | 'gap' | 'other'
export const OPEN_KINDS: readonly OpenKind[] = ['contradiction', 'unresolved', 'gap', 'other']

export interface OpenItem {
  kind: OpenKind
  /** 去掉種類標籤與來源後的內文（保留 `[[連結]]`）。 */
  text: string
  /** `（來源：…）` 裡的文字；沒標就是 undefined。 */
  source?: string
}

const KIND_LABELS: Record<Exclude<OpenKind, 'other'>, readonly string[]> = {
  contradiction: ['矛盾', 'contradiction', 'contradictions'],
  unresolved: ['未解', 'unresolved', 'open', 'open question'],
  gap: ['知識缺口', '知识缺口', 'knowledge gap', 'gap'],
}

function kindOf(label: string): Exclude<OpenKind, 'other'> | undefined {
  const text = label.trim().toLowerCase()
  return (Object.keys(KIND_LABELS) as Array<Exclude<OpenKind, 'other'>>).find(kind => KIND_LABELS[kind].includes(text))
}

/** 待釐清一條 → 種類、內文、來源。格式：`**矛盾**：…（來源：筆記之間）`；粗體可省略。 */
export function parseOpenItem(raw: string): OpenItem {
  let text = raw.trim()
  let kind: OpenKind = 'other'
  const label = /^(?:\*\*([^*\n]+?)\*\*|([^：:\s*]{1,16}))\s*[：:]\s*/u.exec(text)
  const found = label ? kindOf(label[1] ?? label[2]) : undefined
  if (label && found) {
    kind = found
    text = text.slice(label[0].length)
  }
  let source: string | undefined
  const sourceMatch = /\s*[（(]\s*(?:來源|来源|source)\s*[：:]\s*(.+?)\s*[）)]\s*[。.]?\s*$/iu.exec(text)
  if (sourceMatch) {
    source = sourceMatch[1].trim() || undefined
    text = text.slice(0, sourceMatch.index).trim()
  }
  return { kind, text, ...(source ? { source } : {}) }
}

/** 待釐清依種類分組（矛盾 → 未解 → 知識缺口 → 其他），空的組不列。 */
export function groupOpenItems(items: readonly string[]): Array<{ kind: OpenKind, items: OpenItem[] }> {
  const parsed = items.map(parseOpenItem)
  return OPEN_KINDS.map(kind => ({ kind, items: parsed.filter(item => item.kind === kind) })).filter(group => group.items.length > 0)
}

// ── 五區塊 ──────────────────────────────────────────────────

export interface MocNoteRow {
  /** 連結目標（筆記標題或路徑）。 */
  target: string
  /** 顯示的標題：筆記 frontmatter title → 連結別名 → 連結目標。 */
  title: string
  /** 連到的筆記路徑；斷鏈是 null。 */
  path: string | null
  /** 關係說明（尚未分章可以沒有）。 */
  relation: string
  status?: NoteStatus
  /** 分家清單的「X MOC」標記。 */
  marker?: string
  /** 只是引用、不算歸屬（分家清單或帶 MOC 標記）。 */
  reference: boolean
}

export interface MocChapterView {
  /** React key：C 編號，沒有就用標題＋序號。 */
  key: string
  id: string | null
  title: string
  unsorted: boolean
  /** 已長成的新 MOC 名稱。 */
  grownInto?: string
  notes: MocNoteRow[]
  /** 算歸屬的件數（帶 MOC 標記的不算，規格 (b)）。 */
  count: number
}

export interface MocPageView {
  /** frontmatter status 是探索中。 */
  exploring: boolean
  /** 正式收錄、連得到筆記的則數（不重複）。 */
  noteCount: number
  parent?: HeaderItem
  related: HeaderItem[]
  adjacent: HeaderItem[]
  owner?: string
  confirmed?: string
  /** ① 定位問題（一直顯示；空字串＝顯示空狀態）。 */
  position: string
  /** ② 從這裡開始；null＝不顯示。 */
  start: string[] | null
  /** ③ 章節（一直顯示）；尚未分章有筆記時放最後。 */
  chapters: MocChapterView[]
  /** ④ 重點結論；null＝不顯示。 */
  conclusions: string[] | null
  /** ⑤ 待釐清（依種類分組）；null＝不顯示。 */
  open: Array<{ kind: OpenKind, items: OpenItem[] }> | null
}

export function isExploring(status: string | undefined): boolean {
  const text = (status ?? '').trim().toLowerCase()
  return text === '探索中' || text === 'exploring'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

function noteTitle(note: NoteLike): string | undefined {
  return text(note.frontmatter?.title) || note.headings?.find(heading => heading.level === 1)?.text.trim() || undefined
}

function noteStatus(note: NoteLike): NoteStatus | undefined {
  const status = text(note.frontmatter?.status)
  return (NOTE_STATUSES as readonly string[]).includes(status) ? status as NoteStatus : undefined
}

function startOrNull(count: number, items: string[]): string[] | null {
  return count >= START_HERE_THRESHOLD && items.length > 0 ? items : null
}

/**
 * MOC 解析結果 → 畫面資料。resolve 把收錄的連結目標換成筆記路徑（連不到回傳 null）；mocs 用來把 frontmatter parent 的 M 編號換成名稱。
 */
export function mocPageView(
  moc: ParsedMoc,
  notes: ReadonlyMap<string, NoteLike>,
  resolve: (target: string, mocPath: string | undefined) => string | null,
  mocs: readonly ParsedMoc[] = [],
): MocPageView {
  const header = parseMocHeader(moc.preamble)
  const exploring = isExploring(moc.status)

  const counted = new Set<string>()
  for (const { entry } of formalEntries(moc)) {
    const path = resolve(entry.target, moc.path)
    if (path && notes.has(path)) counted.add(path)
  }

  const row = (entry: ParsedMoc['chapters'][number]['entries'][number]): MocNoteRow => {
    const path = resolve(entry.target, moc.path)
    const note = path ? notes.get(path) : undefined
    const status = note ? noteStatus(note) : undefined
    return {
      target: entry.target,
      title: (note && noteTitle(note)) || entry.alias || entry.target,
      path: note ? note.path : null,
      relation: entry.relation,
      ...(status ? { status } : {}),
      ...(entry.mocMarker ? { marker: entry.mocMarker } : {}),
      reference: entry.reference,
    }
  }
  const chapterView = (chapter: ParsedMoc['chapters'][number], index: number): MocChapterView => {
    const rows = chapter.entries.filter(entry => !entry.duplicate).map(row)
    return {
      key: chapter.id ?? `${chapter.title}#${index}`,
      id: chapter.id,
      title: chapter.title,
      unsorted: chapter.unsorted,
      ...(chapter.grownInto ? { grownInto: chapter.grownInto } : {}),
      notes: rows,
      count: rows.filter(item => !item.reference).length,
    }
  }
  const chapters = moc.chapters.map(chapterView)
  if (moc.unsorted) {
    const unsorted = chapterView(moc.unsorted, chapters.length)
    if (unsorted.notes.length > 0) chapters.push(unsorted)
  }

  const parentMoc = moc.parent ? mocs.find(item => item.id === moc.parent) : undefined
  const parent: HeaderItem | undefined = parentMoc
    ? { name: parentMoc.name, label: parentMoc.name, linked: true }
    : header.parent[0]

  const conclusions = blockItems(moc.blocks.conclusions?.text ?? '')
  const open = groupOpenItems(blockItems(moc.blocks.open?.text ?? ''))
  return {
    exploring,
    noteCount: counted.size,
    ...(parent ? { parent } : {}),
    related: header.related,
    adjacent: header.adjacent,
    ...(text(moc.frontmatter.owner) || header.owner ? { owner: text(moc.frontmatter.owner) || header.owner } : {}),
    ...(text(moc.frontmatter.last_confirmed) || header.confirmed ? { confirmed: text(moc.frontmatter.last_confirmed) || header.confirmed } : {}),
    position: stripComments(moc.blocks.position?.text ?? ''),
    start: startOrNull(counted.size, blockItems(moc.blocks.start?.text ?? '')),
    chapters,
    conclusions: conclusions.length > 0 ? conclusions : null,
    open: open.length > 0 ? open : null,
  }
}

/**
 * 還沒有 MOC 檔的舊領域（ALMNC-54.23 的領域表總覽＋frontmatter 反查）→ 同一套五區塊：總覽當定位問題、成員全放「尚未分章」
 * （沒有關係說明）、重點結論、矛盾與未解問題當待釐清。舊的「核心概念」不在五區塊裡，不顯示（69.6 遷移成 MOC 後就沒有這種領域）。
 */
export function legacyPageView(sections: DomainSections, members: readonly DomainNote[], parentName?: string): MocPageView {
  const notes: MocNoteRow[] = members.map(note => ({ target: note.path, title: note.title, path: note.path, relation: '', status: note.status, reference: false }))
  const open = groupOpenItems(sections.openQuestions)
  return {
    exploring: false,
    noteCount: members.length,
    ...(parentName ? { parent: { name: parentName, label: parentName, linked: true } } : {}),
    related: [],
    adjacent: [],
    position: sections.summary,
    start: null,
    chapters: notes.length > 0 ? [{ key: 'unsorted', id: null, title: '', unsorted: true, notes, count: notes.length }] : [],
    conclusions: sections.keyConclusions.length > 0 ? sections.keyConclusions : null,
    open: open.length > 0 ? open : null,
  }
}

// ── 未歸屬 ──────────────────────────────────────────────────

function isKnowledgeNote(note: NoteLike): boolean {
  const fm = note.frontmatter
  if (!fm || text(fm.type) !== 'knowledge') return false
  return !(typeof fm.kind === 'string' && fm.kind.trim().toLowerCase() === 'domain')
}

/** 未歸屬：知識筆記裡、不在 assigned（各領域頁列出的成員路徑）的；依標題排序。 */
export function unassignedNotes(notes: Iterable<NoteLike>, assigned: ReadonlySet<string>): DomainNote[] {
  const out: DomainNote[] = []
  for (const note of notes) {
    if (!isKnowledgeNote(note) || assigned.has(note.path)) continue
    const fm = note.frontmatter ?? {}
    const lastConfirmed = /^\d{4}-\d{2}-\d{2}$/.test(text(fm.lastConfirmed)) ? text(fm.lastConfirmed) : undefined
    out.push({
      path: note.path,
      title: noteTitle(note) ?? (note.path.split('/').pop() ?? note.path).replace(/\.md$/i, ''),
      summary: text(fm.summary),
      status: noteStatus(note) ?? 'valid',
      ...(lastConfirmed ? { lastConfirmed } : {}),
    })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant') || a.path.localeCompare(b.path))
}

/** 搜尋用的內文：去掉 frontmatter。 */
export function searchableBody(raw: string): string {
  return splitFrontmatter(raw).body
}

/** 關鍵字過濾（不分大小寫；空白分開的每個詞都要出現在標題、摘要或內文其中之一）。bodies：路徑 → 內文（讀到的才有）。 */
export function filterNotes<T extends Pick<DomainNote, 'path' | 'title' | 'summary'>>(list: readonly T[], query: string, bodies?: ReadonlyMap<string, string>): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...list]
  return list.filter(note => {
    const haystack = `${note.title}\n${note.summary}\n${bodies?.get(note.path) ?? ''}`.toLowerCase()
    return terms.every(term => haystack.includes(term))
  })
}

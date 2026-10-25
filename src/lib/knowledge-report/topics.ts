// Fork（#34）：主題清單——vault 裡的一則筆記（報告/主題清單.md），Obsidian 手機版也能直接改。
// 術語見 GLOSSARY.md「主題」；規格 personal/specs/11 §3.1。
//
// 格式：每個 `## 名稱` 是一個主題，底下用 `- 欄位：值` 界定範圍。
//   ## Rust
//   - 標籤：#rust、#程式/rust
//   - MOC：[[Rust MOC]]
//   - 資料夾：Dev/Rust
//   - 筆記：[[所有權]]、[[借用檢查]]
//   - 狀態：待確認        ← AI 或候選提議，刪掉這行就是確認
//   - 備註：任何說明
// 其他行（說明文字、空行）原樣保留。
import type OpenAI from 'openai'
import { normalizeTag } from '@/lib/vault-index/tags'
import { resolveWikilinkTarget } from '@/lib/markdown/wikilink'
import type { IndexedNote } from '@/lib/vault-index/index-note'

export const REPORT_FOLDER = '報告'
export const TOPIC_LIST_PATH = `${REPORT_FOLDER}/主題清單.md`
export const TOPIC_LIST_TYPE = '主題清單'
const PROPOSED = '待確認'

export interface Topic {
  name: string
  /** 正規化（小寫、無 #）；含子標籤 */
  tags: string[]
  /** wikilink 目標原文（不含 [[ ]]） */
  mocs: string[]
  folders: string[]
  /** 明確列入的筆記（wikilink 目標原文） */
  notes: string[]
  proposed: boolean
  remark: string
  /** 不認得的行，輸出時放回原位（欄位之後） */
  extra: string[]
}

export interface TopicList {
  /** 第一個 `##` 之前的內容（frontmatter、標題、說明） */
  preamble: string
  topics: Topic[]
}

type Field = 'tags' | 'mocs' | 'folders' | 'notes' | 'status' | 'remark'

const FIELD_KEYS: Record<string, Field> = {
  標籤: 'tags', 标签: 'tags', tags: 'tags', tag: 'tags',
  moc: 'mocs', mocs: 'mocs',
  資料夾: 'folders', 文件夹: 'folders', folders: 'folders', folder: 'folders',
  筆記: 'notes', 笔记: 'notes', notes: 'notes',
  狀態: 'status', 状态: 'status', status: 'status',
  備註: 'remark', 备注: 'remark', note: 'remark', remark: 'remark',
}

const FIELD_RE = /^\s*[-*]\s*([^:：]+?)\s*[:：]\s*(.*)$/

function splitList(value: string): string[] {
  return value.split(/[、,，;；]/).map(item => item.trim()).filter(Boolean)
}

function wikilinkTargets(value: string): string[] {
  const out: string[] = []
  for (const m of value.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) out.push(m[1].trim())
  // 沒有用 [[ ]] 包起來時，當成以頓號分隔的名稱
  return out.length ? out : splitList(value)
}

function emptyTopic(name: string): Topic {
  return { name, tags: [], mocs: [], folders: [], notes: [], proposed: false, remark: '', extra: [] }
}

export function parseTopicList(content: string): TopicList {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const preamble: string[] = []
  const topics: Topic[] = []
  let current: Topic | null = null
  let fence = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const heading = !fence && line.match(/^##\s+(.+?)\s*#*\s*$/)
    if (heading) {
      current = emptyTopic(heading[1].trim())
      topics.push(current)
      continue
    }
    if (!current) {
      preamble.push(line)
      continue
    }
    const field = !fence && line.match(FIELD_RE)
    const key = field ? FIELD_KEYS[field[1].trim().toLowerCase()] : undefined
    if (!field || !key) {
      current.extra.push(line)
      continue
    }
    const value = field[2].trim()
    if (key === 'tags') current.tags.push(...splitList(value).flatMap(item => item.split(/\s+/)).map(normalizeTag).filter(Boolean))
    else if (key === 'mocs') current.mocs.push(...wikilinkTargets(value))
    else if (key === 'notes') current.notes.push(...wikilinkTargets(value))
    else if (key === 'folders') current.folders.push(...splitList(value).map(folder => folder.replace(/^\/+|\/+$/g, '')).filter(Boolean))
    else if (key === 'status') current.proposed = value.includes(PROPOSED) || /^proposed$/i.test(value)
    else current.remark = value
  }
  for (const topic of topics) {
    // 前後空行只是排版，不保留
    while (topic.extra.length && !topic.extra[0].trim()) topic.extra.shift()
    while (topic.extra.length && !topic.extra[topic.extra.length - 1].trim()) topic.extra.pop()
  }
  return { preamble: preamble.join('\n').replace(/\n+$/, ''), topics }
}

export function defaultPreamble(): string {
  return [
    '---',
    `type: ${TOPIC_LIST_TYPE}`,
    '---',
    '# 主題清單',
    '',
    '知識報告以這裡的主題為單位評估掌握度。每個 `##` 是一個主題；標籤、MOC、資料夾、筆記任一符合就算在這個主題裡。',
    '「狀態：待確認」是還沒確認的提議，刪掉那一行就是確認；不要的主題整段刪掉。',
  ].join('\n')
}

export function renderTopicList(list: TopicList): string {
  const blocks = [list.preamble || defaultPreamble()]
  for (const topic of list.topics) {
    const lines = [`## ${topic.name}`]
    if (topic.proposed) lines.push(`- 狀態：${PROPOSED}`)
    if (topic.tags.length) lines.push(`- 標籤：${topic.tags.map(tag => `#${tag}`).join('、')}`)
    if (topic.mocs.length) lines.push(`- MOC：${topic.mocs.map(moc => `[[${moc}]]`).join('、')}`)
    if (topic.folders.length) lines.push(`- 資料夾：${topic.folders.join('、')}`)
    if (topic.notes.length) lines.push(`- 筆記：${topic.notes.map(note => `[[${note}]]`).join('、')}`)
    if (topic.remark) lines.push(`- 備註：${topic.remark}`)
    const extra = topic.extra.join('\n').replace(/^\n+|\n+$/g, '')
    if (extra) lines.push(extra)
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n') + '\n'
}

/** 合併新提議：同名（不分大小寫）的主題已存在就略過。 */
export function addProposals(list: TopicList, proposals: Topic[]): TopicList {
  const names = new Set(list.topics.map(topic => topic.name.toLowerCase()))
  const added = proposals.filter(topic => !names.has(topic.name.toLowerCase())).map(topic => ({ ...topic, proposed: true }))
  return { ...list, topics: [...list.topics, ...added] }
}

export function confirmedTopics(list: TopicList): Topic[] {
  return list.topics.filter(topic => !topic.proposed)
}

// ---------------------------------------------------------------------------
// 範圍判斷

function underFolder(path: string, folder: string) {
  return folder !== '' && (path === folder || path.startsWith(`${folder}/`))
}

export function isExcluded(path: string, excludeFolders: string[]) {
  return excludeFolders.some(folder => underFolder(path, folder.replace(/^\/+|\/+$/g, '')))
}

function hasTagWithin(note: IndexedNote, tag: string) {
  return note.tags.some(raw => {
    const normalized = normalizeTag(raw)
    return normalized === tag || normalized.startsWith(`${tag}/`)
  })
}

function titleOf(path: string) {
  return path.split('/').pop()!.replace(/\.md$/i, '')
}

/** 主題 → 筆記路徑。MOC 本身與它連到的筆記都算；一篇筆記可以屬於多個主題。 */
export function assignTopics(topics: Topic[], notes: IndexedNote[]): Map<string, Set<string>> {
  const paths = notes.map(note => note.path)
  const byPath = new Map(notes.map(note => [note.path, note]))
  const out = new Map<string, Set<string>>()
  for (const topic of topics) {
    const members = new Set<string>()
    for (const note of notes) {
      if (topic.tags.some(tag => hasTagWithin(note, tag)) || topic.folders.some(folder => underFolder(note.path, folder))) members.add(note.path)
    }
    for (const target of topic.notes) {
      const path = resolveWikilinkTarget(target, paths, '')
      if (path) members.add(path)
    }
    for (const target of topic.mocs) {
      const mocPath = resolveWikilinkTarget(target, paths, '')
      const moc = mocPath ? byPath.get(mocPath) : undefined
      if (!moc) continue
      members.add(moc.path)
      for (const link of moc.links) {
        if (link.kind !== 'wikilink') continue
        const path = resolveWikilinkTarget(link.target, paths, moc.path)
        if (path && path.toLowerCase().endsWith('.md')) members.add(path)
      }
    }
    out.set(topic.name, members)
  }
  return out
}

// ---------------------------------------------------------------------------
// 候選主題：標籤與 MOC

/** 不當成主題的工作流程標籤。 */
const META_TAGS = new Set(['daily', 'journal', 'todo', 'inbox', 'moc', 'clippings', 'clipping', 'template', 'templates', 'draft', 'archive', 'task', 'tasks', '日記', '日记', '待辦', '待办', '收件匣', '草稿', '封存', '範本', '模板'])

const MOC_NAME_RE = /(^|[\s_-])(moc|index|map)([\s_-]|$)|索引|地圖|地图|總覽|总览/i

export function isMoc(note: IndexedNote): boolean {
  const fm = note.frontmatter
  const type = typeof fm?.type === 'string' ? fm.type.toLowerCase() : ''
  if (type === 'moc') return true
  if (note.tags.some(tag => normalizeTag(tag) === 'moc')) return true
  return MOC_NAME_RE.test(titleOf(note.path)) && note.links.filter(link => link.kind === 'wikilink').length >= 3
}

function mocTopicName(path: string) {
  return titleOf(path).replace(MOC_NAME_RE, ' ').replace(/\s+/g, ' ').trim() || titleOf(path)
}

export interface CandidateOptions {
  /** 至少要有幾篇筆記才提議 */
  minNotes?: number
  excludeFolders?: string[]
}

/** 從現有標籤（第一層）與 MOC 找候選主題；同名的合併。按筆記數多到少。 */
export function candidateTopics(notes: IndexedNote[], options: CandidateOptions = {}): Array<Topic & { noteCount: number }> {
  const minNotes = options.minNotes ?? 3
  const scoped = notes.filter(note => !isExcluded(note.path, options.excludeFolders ?? []))
  const byKey = new Map<string, Topic>()
  const display = new Map<string, string>()
  for (const note of scoped) {
    for (const raw of note.tags) {
      const top = normalizeTag(raw).split('/')[0]
      if (!top || META_TAGS.has(top) || /^\d+$/.test(top)) continue
      if (!display.has(top)) display.set(top, raw.replace(/^#+/, '').split('/')[0].trim())
    }
  }
  for (const [tag, name] of display) byKey.set(name.toLowerCase(), { ...emptyTopic(name), tags: [tag], proposed: true })
  for (const note of scoped) {
    if (!isMoc(note)) continue
    const name = mocTopicName(note.path)
    const existing = byKey.get(name.toLowerCase())
    if (existing) existing.mocs.push(titleOf(note.path))
    else byKey.set(name.toLowerCase(), { ...emptyTopic(name), mocs: [titleOf(note.path)], proposed: true })
  }
  const topics = [...byKey.values()]
  const counts = assignTopics(topics, scoped)
  return topics
    .map(topic => ({ ...topic, noteCount: counts.get(topic.name)?.size ?? 0 }))
    .filter(topic => topic.noteCount >= minNotes)
    .sort((a, b) => b.noteCount - a.noteCount || a.name.localeCompare(b.name))
}

/** 沒有歸到任何主題的筆記（給 AI 提議新主題）。 */
export function uncoveredNotes(notes: IndexedNote[], assignment: Map<string, Set<string>>): IndexedNote[] {
  const covered = new Set<string>()
  for (const members of assignment.values()) for (const path of members) covered.add(path)
  return notes.filter(note => !covered.has(note.path))
}

// ---------------------------------------------------------------------------
// AI 提議

export const PROPOSAL_NOTE_LIMIT = 300

export function buildProposalMessages(notes: IndexedNote[], existing: string[], language: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const lines = notes.slice(0, PROPOSAL_NOTE_LIMIT).map(note => {
    const headings = note.headings.slice(0, 5).map(h => h.text).join(' / ')
    const tags = note.tags.slice(0, 5).join(' ')
    return `- ${note.path}${tags ? ` ${tags}` : ''}${headings ? ` ｜ ${headings}` : ''}`
  })
  return [
    {
      role: 'system',
      content: [
        '下面是一個個人筆記庫裡「還沒有歸到任何主題」的筆記（路徑、標籤、前幾個標題）。',
        '請把它們歸納成 0–8 個新主題，每個主題至少 3 篇筆記；歸不進任何主題的筆記就不要勉強。',
        `已有的主題（不要重複）：${existing.join('、') || '（無）'}`,
        '只回傳一個 JSON 物件，不要其他文字：{"topics":[{"name":"主題名稱（10 字內）","reason":"一句話理由","notes":["筆記路徑", ...]}]}',
        `用 ${language} 撰寫 name 與 reason；notes 必須是上面列出的路徑原文。`,
      ].join('\n'),
    },
    { role: 'user', content: lines.join('\n') },
  ]
}

export function parseProposals(raw: string, notePaths: string[]): Topic[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  const known = new Set(notePaths)
  const list = (value as { topics?: unknown }).topics
  if (!Array.isArray(list)) return []
  const out: Topic[] = []
  for (const item of list) {
    const name = typeof item?.name === 'string' ? item.name.trim().replace(/^#+\s*/, '') : ''
    const notes = Array.isArray(item?.notes) ? item.notes.filter((path: unknown): path is string => typeof path === 'string' && known.has(path)) : []
    if (!name || notes.length === 0) continue
    out.push({
      ...emptyTopic(name),
      notes: notes.map((path: string) => path.replace(/\.md$/i, '')),
      proposed: true,
      remark: typeof item.reason === 'string' ? item.reason.trim() : '',
    })
  }
  return out
}

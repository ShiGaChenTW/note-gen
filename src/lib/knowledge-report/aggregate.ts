// Fork（#34）：把筆記、每日筆記、對話摘要、PDF、本週足跡與記憶彙整成每個主題的行為訊號與掌握度。純函式。
// 規格 personal/specs/11 §3.3；記憶只讀 active、不寫回（ADR 0002）。
import type { ActivityLog } from '@/lib/home/activity'
import { dayKey } from '@/lib/home/activity'
import { parseDailyNotePath } from '@/lib/daily/format'
import { SUMMARY_TYPE } from '@/lib/conversation-summary/model'
import { normalizeTag } from '@/lib/vault-index/tags'
import { buildLinkLookup, buildVaultLinkIndex } from '@/lib/vault-index/links'
import type { IndexedNote } from '@/lib/vault-index/index-note'
import { computeMastery, emptySignals, DEFAULT_MASTERY_CONFIG, type Mastery, type MasteryConfig, type TopicSignals } from './mastery'
import type { NoteAnalysis, SummaryCounts } from './note-signals'
import { assignTopics, isExcluded, isMoc, REPORT_FOLDER, type Topic } from './topics'

export interface MemoryInput {
  id: string
  content: string
  kind: 'preference' | 'fact' | 'experience' | 'decision'
  status: 'active' | 'pending' | 'archived'
}

export interface PdfInput {
  path: string
  words: number
}

export interface AggregateInput {
  topics: Topic[]
  /** 索引裡所有筆記（含每日筆記、對話摘要） */
  notes: IndexedNote[]
  /** 一般筆記的分析（沒有的筆記照算篇數與連結，字數當 0） */
  analyses: ReadonlyMap<string, NoteAnalysis>
  /** 對話摘要各節條數 */
  summaries: ReadonlyMap<string, SummaryCounts>
  /** 增量快取記下的修改日（YYYY-MM-DD） */
  editDays: ReadonlyMap<string, string[]>
  /** 筆記連到的 PDF（已擷取字數） */
  pdfs: ReadonlyMap<string, PdfInput>
  activity: ActivityLog
  memories: MemoryInput[]
  daily: { folder: string; pattern: string }
  excludeFolders: string[]
  config?: MasteryConfig
}

export interface MemoryEvidence {
  id: string
  kind: MemoryInput['kind']
  content: string
}

export interface TopicResult {
  topic: Topic
  /** 主題內的一般筆記 */
  paths: string[]
  signals: TopicSignals
  mastery: Mastery
  evidence: {
    summaries: string[]
    pdfs: string[]
    dailyNotes: string[]
    memories: MemoryEvidence[]
  }
  /** 相關 preference / decision 記憶數，用來排主題的優先順序（不影響分數） */
  priority: number
}

export type NoteRole = 'note' | 'daily' | 'summary' | 'ignored'

export function noteRole(note: IndexedNote, input: Pick<AggregateInput, 'daily' | 'excludeFolders'>): NoteRole {
  if (!note.path.toLowerCase().endsWith('.md')) return 'ignored'
  if (isExcluded(note.path, [...input.excludeFolders, REPORT_FOLDER])) return 'ignored'
  if (note.frontmatter?.type === SUMMARY_TYPE) return 'summary'
  if (parseDailyNotePath(note.path, input.daily.folder, input.daily.pattern)) return 'daily'
  return 'note'
}

function daysBetween(a: string, b: string) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** 記憶內容提到主題名稱、標籤（最後一段）或 MOC 名稱。少於兩個字的詞不比對，避免誤中。 */
function memoryMatches(memory: MemoryInput, topic: Topic) {
  const text = memory.content.toLowerCase()
  const terms = [topic.name, ...topic.tags.map(tag => tag.split('/').pop() ?? ''), ...topic.mocs.map(moc => moc.split('/').pop() ?? '')]
    .map(term => term.trim().toLowerCase())
    .filter(term => Array.from(term).length >= 2)
  return terms.some(term => text.includes(term))
}

function summaryMatches(note: IndexedNote, topic: Topic, members: Set<string>, outgoing: (path: string) => Array<string | null>) {
  const raw = note.frontmatter?.topics
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []
  const names = new Set([topic.name.toLowerCase(), ...topic.tags])
  if (list.some(item => names.has(item.trim().toLowerCase()) || names.has(normalizeTag(item)))) return true
  return outgoing(note.path).some(path => path !== null && members.has(path))
}

export function aggregateTopics(input: AggregateInput): TopicResult[] {
  const config = input.config ?? DEFAULT_MASTERY_CONFIG
  const roles = new Map(input.notes.map(note => [note.path, noteRole(note, input)]))
  const regular = input.notes.filter(note => roles.get(note.path) === 'note')
  const byPath = new Map(input.notes.map(note => [note.path, note]))
  // PDF 不在索引裡，接在筆記後面讓 [[x.pdf]] 也解析得到
  const lookup = buildLinkLookup([...input.notes.map(note => note.path), ...input.pdfs.keys()])
  const linkIndex = buildVaultLinkIndex(input.notes, lookup)
  const outgoing = (path: string) => (linkIndex.outgoing.get(path) ?? []).map(link => link.resolved)
  const assignment = assignTopics(input.topics, regular)
  const topicsOf = new Map<string, Set<string>>()
  for (const [name, members] of assignment) {
    for (const path of members) {
      const set = topicsOf.get(path) ?? new Set<string>()
      set.add(name)
      topicsOf.set(path, set)
    }
  }

  // 每篇筆記被碰過的日子（本週足跡 + 快取記下的修改日 + 修改時間當天）
  const touched = new Map<string, Set<string>>()
  const edited = new Map<string, Set<string>>()
  const mark = (target: Map<string, Set<string>>, path: string, day: string) => {
    const set = target.get(path) ?? new Set<string>()
    set.add(day)
    target.set(path, set)
  }
  for (const [day, entry] of Object.entries(input.activity.days)) {
    for (const path of entry.created ?? []) { mark(touched, path, day); mark(edited, path, day) }
    for (const path of entry.modified ?? []) { mark(touched, path, day); mark(edited, path, day) }
    for (const path of entry.reread ?? []) mark(touched, path, day)
  }
  for (const [path, days] of input.editDays) for (const day of days) { mark(touched, path, day); mark(edited, path, day) }
  for (const note of regular) {
    if (note.mtime > 0) {
      const day = dayKey(new Date(note.mtime))
      mark(touched, note.path, day)
      mark(edited, note.path, day)
    }
  }

  const dailyNotes = input.notes.filter(note => roles.get(note.path) === 'daily')
  const summaryNotes = input.notes.filter(note => roles.get(note.path) === 'summary')
  const memories = input.memories.filter(memory => memory.status === 'active')

  return input.topics.map(topic => {
    const members = assignment.get(topic.name) ?? new Set<string>()
    const s = emptySignals()
    const days = new Set<string>()
    const pdfs = new Set<string>()
    s.notes = members.size
    for (const path of members) {
      const note = byPath.get(path)!
      const analysis = input.analyses.get(path)
      const moc = isMoc(note)
      if (moc) s.hasMoc = true
      if (analysis) {
        s.ownWords += analysis.ownWords
        s.quotedWords += analysis.quotedWords
        if (analysis.hasSummary) s.summaries++
        if (analysis.hasReflection) s.reflections++
      }
      if (moc || (analysis?.headings ?? note.headings.length) >= 2) s.structuredNotes++
      if ((edited.get(path)?.size ?? 0) >= 2) s.revisedNotes++
      for (const day of touched.get(path) ?? []) days.add(day)
      const linked = new Set<string>()
      for (const target of outgoing(path)) {
        if (!target || target === path || linked.has(target)) continue
        linked.add(target)
        if (target.toLowerCase().endsWith('.pdf')) {
          const pdf = input.pdfs.get(target)
          if (pdf && !pdfs.has(target)) {
            pdfs.add(target)
            s.quotedWords += pdf.words
          }
        } else if (members.has(target)) {
          s.internalLinks++
        } else if (topicsOf.has(target)) {
          s.crossLinks++
        }
      }
    }

    const mentionedIn: string[] = []
    for (const note of dailyNotes) {
      if (!outgoing(note.path).some(path => path !== null && members.has(path))) continue
      const date = parseDailyNotePath(note.path, input.daily.folder, input.daily.pattern)
      if (!date) continue
      mentionedIn.push(note.path)
      days.add(dayKey(date))
    }
    s.dailyMentions = mentionedIn.length

    const summaries: string[] = []
    for (const note of summaryNotes) {
      if (!summaryMatches(note, topic, members, outgoing)) continue
      summaries.push(note.path)
      const counts = input.summaries.get(note.path)
      if (counts) {
        s.myViews += counts.myViews
        s.aiPoints += counts.aiPoints
      }
      const date = typeof note.frontmatter?.date === 'string' ? note.frontmatter.date : ''
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) days.add(date)
    }

    const related = memories.filter(memory => memoryMatches(memory, topic))
    s.experienceMemories = related.filter(memory => memory.kind === 'experience').length

    const sorted = [...days].sort()
    s.touchDays = sorted.length
    s.spanDays = sorted.length >= 2 ? daysBetween(sorted[0], sorted[sorted.length - 1]) : 0

    return {
      topic,
      paths: [...members].sort(),
      signals: s,
      mastery: computeMastery(s, config),
      evidence: {
        summaries: summaries.sort(),
        pdfs: [...pdfs].sort(),
        dailyNotes: mentionedIn.sort(),
        memories: related.map(memory => ({ id: memory.id, kind: memory.kind, content: memory.content.slice(0, 200) })),
      },
      priority: related.filter(memory => memory.kind === 'preference' || memory.kind === 'decision').length,
    }
  })
}

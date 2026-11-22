// Fork（almanac ALMNC-54.13）：定期稽核共用工作記憶和專家工作筆記（規格第二節「防止違規」第 3 點）。
// 比對記憶裡的每一行是不是在複製筆記內容（筆記庫才是唯一的事實來源）：重疊就提案刪掉記憶裡那份（Scott 接受才刪）。
// 只放標題和連結是允許的，所以和筆記標題一樣的不算；活動紀錄只能新增不能改，重疊只列在每週回顧裡。
// 專家最容易違規，先檢查專家。純函式。
import { newProposalId } from '@/lib/collect/split'
import type { MemoryEdit, Proposal } from '@/lib/collect/types'
import { containment, textGrams } from '@/lib/cleanup/similar'
import type { AgentRole } from '@/lib/agents/settings'

export interface AuditNote {
  path: string
  title: string
  body: string
}

export interface WorkNotesInput {
  agent: { id: string, name: string, role: AgentRole, domain?: string }
  content: string
}

export interface ContextInput {
  projects: Array<{ title: string, link?: string }>
  weeklyFocus: Array<{ title: string, link?: string }>
  people: string[]
}

export interface AuditFinding {
  memory: 'work_notes' | 'context' | 'activity'
  /** 工作筆記：agent 編號；目前脈絡：projects／weeklyFocus；活動紀錄：紀錄編號。 */
  ref: string
  text: string
  notePath: string
  noteTitle: string
  score: number
}

export const AUDIT_THRESHOLD = 0.6
/** 太短的行（雙字組少於這個數）不比，避免把「Scott 喜歡附來源」這類工作方式誤判。 */
export const AUDIT_MIN_GRAMS = 8

function cleanLine(line: string): string {
  return line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|#+\s+)/, '').replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1').trim()
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function bestMatch(text: string, notes: ReadonlyArray<AuditNote & { grams: Set<string> }>): { note: AuditNote, score: number } | undefined {
  const cleaned = cleanLine(text)
  const grams = textGrams(cleaned)
  if (grams.size < AUDIT_MIN_GRAMS) return undefined
  let best: { note: AuditNote, score: number } | undefined
  for (const note of notes) {
    // 只放標題（或標題加連結）是允許的。
    if (normalized(cleaned) === normalized(note.title)) continue
    const score = containment(grams, note.grams)
    if (score >= AUDIT_THRESHOLD && (!best || score > best.score)) best = { note, score }
  }
  return best
}

export function auditMemory(input: { workNotes: readonly WorkNotesInput[], context?: ContextInput, activity?: ReadonlyArray<{ id: number, note: string }> }, notes: readonly AuditNote[]): AuditFinding[] {
  const indexed = notes.filter(note => note.body.trim()).map(note => ({ ...note, grams: textGrams(`${note.title}\n${note.body}`) }))
  const findings: AuditFinding[] = []
  const ordered = [...input.workNotes].sort((a, b) => Number(b.agent.role === 'expert') - Number(a.agent.role === 'expert'))
  for (const entry of ordered) {
    for (const line of entry.content.split(/\r?\n/)) {
      if (!line.trim() || /^\s*#/.test(line)) continue
      const match = bestMatch(line, indexed)
      if (match) findings.push({ memory: 'work_notes', ref: entry.agent.id, text: line, notePath: match.note.path, noteTitle: match.note.title, score: match.score })
    }
  }
  for (const key of ['projects', 'weeklyFocus'] as const) {
    for (const item of input.context?.[key] ?? []) {
      const match = bestMatch(item.title, indexed)
      if (match) findings.push({ memory: 'context', ref: key, text: item.title, notePath: match.note.path, noteTitle: match.note.title, score: match.score })
    }
  }
  for (const entry of input.activity ?? []) {
    const match = entry.note ? bestMatch(entry.note, indexed) : undefined
    if (match) findings.push({ memory: 'activity', ref: String(entry.id), text: entry.note, notePath: match.note.path, noteTitle: match.note.title, score: match.score })
  }
  return findings
}

export interface AuditLabels {
  workNotesTitle: (input: { agent: string, count: number }) => string
  contextTitle: (input: { count: number }) => string
  line: (input: { text: string, note: string }) => string
}

/** 重疊的工作筆記（每位 agent 一則）與目前脈絡做成刪除提案；接受後以 Scott 的身分寫入。 */
export function auditProposals(findings: readonly AuditFinding[], input: { workNotes: readonly WorkNotesInput[], context?: ContextInput }, labels: AuditLabels): Proposal[] {
  const proposals: Proposal[] = []
  const wiki = (path: string) => `[[${path.replace(/\.md$/i, '')}]]`
  for (const entry of input.workNotes) {
    const mine = findings.filter(finding => finding.memory === 'work_notes' && finding.ref === entry.agent.id)
    if (!mine.length) continue
    const remove = new Set(mine.map(finding => finding.text))
    const content = entry.content.split(/\r?\n/).filter(line => !remove.has(line)).join('\n')
    const edit: MemoryEdit = { target: 'work_notes', agent: entry.agent, baseContent: entry.content, content, summary: entry.agent.name }
    proposals.push({
      id: newProposalId(), kind: 'note', title: labels.workNotesTitle({ agent: entry.agent.name, count: mine.length }),
      body: mine.map(finding => labels.line({ text: cleanLine(finding.text), note: wiki(finding.notePath) })).join('\n'),
      due: '', time: '', tags: [], memoryEdits: [edit], card: { label: 'knowledge', verb: 'organize' }, drafter: { role: 'commander' },
    })
  }
  const contextFindings = findings.filter(finding => finding.memory === 'context')
  if (contextFindings.length && input.context) {
    const drop = (key: 'projects' | 'weeklyFocus') => input.context![key].filter(item => !contextFindings.some(finding => finding.ref === key && finding.text === item.title))
    const context = { projects: drop('projects'), weeklyFocus: drop('weeklyFocus'), people: [...input.context.people] }
    proposals.push({
      id: newProposalId(), kind: 'note', title: labels.contextTitle({ count: contextFindings.length }),
      body: contextFindings.map(finding => labels.line({ text: finding.text, note: wiki(finding.notePath) })).join('\n'),
      due: '', time: '', tags: [], memoryEdits: [{ target: 'context', baseContext: input.context, context, summary: 'context' }],
      card: { label: 'knowledge', verb: 'organize' }, drafter: { role: 'commander' },
    })
  }
  return proposals
}

// Fork（almanac ALMNC-8）：把提案轉成要寫進檔案的文字。純函式。
import { stringify } from 'yaml'
import { createV3Note, writeV3NoteFields } from '@/lib/v3-model/note'
import type { Proposal } from './types'

/** 任務與時段寫成 Obsidian Tasks 行；任務沒有日期時預設今天（today 為 YYYY-MM-DD）。 */
export function proposalTaskLine(proposal: Proposal, today: string): string {
  const due = proposal.due || (proposal.kind === 'task' || proposal.time ? today : '')
  const parts = ['- [ ]', proposal.title.replace(/\s*\n\s*/g, ' ').trim()]
  if (due) parts.push(`📅 ${due}`)
  if (proposal.time) parts.push(`⏰ ${proposal.time}`)
  parts.push(...proposal.tags.map(tag => `#${tag}`))
  return parts.join(' ')
}

/** 筆記檔內容：標題、內文、標籤。指揮官的提案（有來源資料源或筆記類型）另外寫上 V3 frontmatter。 */
export function proposalNoteContent(proposal: Proposal): string {
  const body = proposal.body.trim()
  const lines = [`# ${proposal.title.trim()}`]
  if (body) lines.push('', body)
  if (proposal.tags.length > 0) lines.push('', proposal.tags.map(tag => `#${tag}`).join(' '))
  const content = `${lines.join('\n')}\n`
  if (!proposal.sourceIds?.length && !proposal.noteType) return content
  return v3NoteContent(proposal, content)
}

// Fork（almanac ALMNC-54.6）：指揮官提案寫成筆記時的 frontmatter——V3 欄位（類型、來源、領域、標籤、狀態），
// 加上補上的上下文（日期、相關的人、所屬專案）。上下文不是 V3 管理的欄位，writeV3NoteFields 會原樣保留。
function v3NoteContent(proposal: Proposal, content: string): string {
  const context: Record<string, unknown> = {}
  if (proposal.due) context.date = proposal.due
  if (proposal.people?.length) context.people = proposal.people
  if (proposal.project) context.project = proposal.project
  const fields = {
    title: proposal.title.trim(),
    type: proposal.noteType,
    sources: proposal.sourceIds,
    domains: proposal.domains,
    tags: proposal.tags.length ? proposal.tags : undefined,
    status: 'valid' as const,
  }
  if (!Object.keys(context).length) return createV3Note(fields, content)
  return writeV3NoteFields(`---\n${stringify(context, { lineWidth: 0 })}---\n${content}`, fields)
}

// Fork（#33）：對話摘要的純函式——逐字稿、AI 回傳解析、Markdown 輸出、找既有摘要。
// 術語見 GLOSSARY.md「對話摘要」；規格 personal/specs/11 §4。
import type OpenAI from 'openai'
import YAML from 'yaml'
import type { Chat } from '@/db/chats'

export const SUMMARY_TYPE = '對話摘要'
export const SUMMARY_FOLDER = '對話摘要'
/** 逐字稿上限（字元）；超過時保留最後面的內容。 */
export const TRANSCRIPT_LIMIT = 60_000

export interface SummaryData {
  subject: string
  myQuestions: string[]
  myViews: string[]
  aiPoints: string[]
  decisions: string[]
  openQuestions: string[]
  topics: string[]
  /** 模型提到的相關筆記（vault 相對路徑或標題）。 */
  related: string[]
}

export interface SummaryHeadings {
  myQuestions: string
  myViews: string
  aiPoints: string
  decisions: string
  openQuestions: string
  related: string
  none: string
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const ILLEGAL = /[\\/:*?"<>|#^[\]\n\r\t]+/g

/** 對話摘要/YYYY/MM/YYYY-MM-DD <主旨>.md */
export function summaryPath(date: Date, subject: string): string {
  const title = Array.from(subject.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim()).slice(0, 40).join('').trim()
  const name = title ? `${dateKey(date)} ${title}.md` : `${dateKey(date)}.md`
  return `${SUMMARY_FOLDER}/${date.getFullYear()}/${pad(date.getMonth() + 1)}/${name}`
}

/** 對話在摘要裡的識別：有 syncId 用 syncId（跨裝置同步後不變），否則用本機 id。 */
export function conversationKey(conversation: { id: number; syncId?: string }): string {
  return conversation.syncId || String(conversation.id)
}

/** 只留真正的對話內容；「我」與「AI」分開標記，讓模型分得清誰說的。 */
export function buildTranscript(chats: Chat[], labels = { me: '我', ai: 'AI' }, limit = TRANSCRIPT_LIMIT): string {
  const lines: string[] = []
  for (const chat of chats) {
    if (chat.type !== 'chat' && chat.type !== 'note') continue
    const text = (chat.content ?? '').trim()
    if (!text) continue
    lines.push(`【${chat.role === 'user' ? labels.me : labels.ai}】\n${text}`)
  }
  const transcript = lines.join('\n\n')
  return transcript.length > limit ? transcript.slice(transcript.length - limit) : transcript
}

/** 從 RAG 來源、Agent 紀錄、引用、附件裡找出提到的 .md 路徑。 */
export function collectReferencedPaths(chats: Chat[]): string[] {
  const found = new Set<string>()
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || value === null || value === undefined) return
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (/\.md$/i.test(trimmed) && !trimmed.includes('\n') && trimmed.length < 300) found.add(trimmed.replace(/^\/+/, ''))
      return
    }
    if (Array.isArray(value)) value.forEach(item => visit(item, depth + 1))
    else if (typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(item => visit(item, depth + 1))
  }
  for (const chat of chats) {
    for (const field of [chat.ragSourceDetails, chat.agentHistory, chat.quoteData, chat.attachments]) {
      if (!field) continue
      try {
        visit(JSON.parse(field), 0)
      } catch {
        // 舊資料可能不是 JSON
      }
    }
  }
  return [...found]
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
}

/** 解析模型回傳；容許外面包 ```json。格式不對時回傳 null。 */
export function parseSummaryJson(raw: string): SummaryData | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let value: Record<string, unknown>
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const subject = typeof value.subject === 'string' ? value.subject.trim() : ''
  if (!subject) return null
  return {
    subject,
    myQuestions: stringList(value.myQuestions),
    myViews: stringList(value.myViews),
    aiPoints: stringList(value.aiPoints),
    decisions: stringList(value.decisions),
    openQuestions: stringList(value.openQuestions),
    topics: stringList(value.topics),
    related: stringList(value.related),
  }
}

/** 相關筆記：對話裡實際用到的檔案優先，再加上模型提到且 vault 裡找得到的。 */
export function resolveRelated(referenced: string[], suggested: string[], notePaths: string[]): string[] {
  const byLower = new Map(notePaths.map(path => [path.toLowerCase(), path]))
  const byTitle = new Map(notePaths.map(path => [path.split('/').pop()!.replace(/\.md$/i, '').toLowerCase(), path]))
  const out: string[] = []
  const add = (path: string | undefined) => { if (path && !out.includes(path)) out.push(path) }
  for (const path of referenced) add(byLower.get(path.toLowerCase()) ?? path)
  for (const item of suggested) {
    const clean = item.replace(/^\[\[|\]\]$/g, '').split('|')[0].trim()
    add(byLower.get(clean.toLowerCase()) ?? byLower.get(`${clean}.md`.toLowerCase()) ?? byTitle.get(clean.toLowerCase()))
  }
  return out
}

function wikilink(path: string) {
  return `[[${path.replace(/\.md$/i, '')}]]`
}

export function renderSummary(
  data: SummaryData,
  meta: { conversation: string; date: Date; related: string[] },
  headings: SummaryHeadings,
): string {
  const frontmatter = YAML.stringify({
    type: SUMMARY_TYPE,
    conversation: meta.conversation,
    date: dateKey(meta.date),
    topics: data.topics,
  }, { lineWidth: 0 }).trimEnd()
  const list = (items: string[]) => (items.length ? items.map(item => `- ${item}`).join('\n') : `- ${headings.none}`)
  const section = (title: string, items: string[]) => `## ${title}\n\n${list(items)}`
  return [
    `---\n${frontmatter}\n---`,
    `# ${data.subject}`,
    section(headings.myQuestions, data.myQuestions),
    section(headings.myViews, data.myViews),
    section(headings.aiPoints, data.aiPoints),
    section(headings.decisions, data.decisions),
    section(headings.openQuestions, data.openQuestions),
    section(headings.related, meta.related.map(wikilink)),
  ].join('\n\n') + '\n'
}

/** 在索引裡找同一個對話的既有摘要（依 frontmatter 的 type 與 conversation）。 */
export function findExistingSummary(
  notes: Iterable<{ path: string; mtime: number; frontmatter: Record<string, unknown> | null }>,
  key: string,
): { path: string; mtime: number } | null {
  for (const note of notes) {
    const fm = note.frontmatter
    if (fm && fm.type === SUMMARY_TYPE && String(fm.conversation ?? '') === key) return { path: note.path, mtime: note.mtime }
  }
  return null
}

/** 所有對話摘要：對話識別 → 摘要最後修改時間。 */
export function summarizedConversations(
  notes: Iterable<{ mtime: number; frontmatter: Record<string, unknown> | null }>,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const note of notes) {
    const fm = note.frontmatter
    if (fm && fm.type === SUMMARY_TYPE && fm.conversation !== undefined && fm.conversation !== null) {
      out.set(String(fm.conversation), Math.max(note.mtime, out.get(String(fm.conversation)) ?? 0))
    }
  }
  return out
}

export function buildSummaryMessages(transcript: string, labels: { me: string; ai: string }, language: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: [
        '你要把一段使用者與 AI 的對話收斂成摘要，只回傳一個 JSON 物件，不要任何其他文字。',
        `逐字稿中「【${labels.me}】」是使用者本人說的話，「【${labels.ai}】」是 AI 的回答。`,
        '欄位：',
        '- subject：一句話主旨（20 字內，不要標點結尾）',
        `- myQuestions：使用者問了什麼（只取【${labels.me}】）`,
        `- myViews：使用者自己表達的觀點、理解、經驗與判斷。**只能取自【${labels.me}】的內容**；使用者只是提問、沒有表達自己的看法時留空陣列。不要把 AI 說的話放進來。`,
        `- aiPoints：AI 解答的重點（只取【${labels.ai}】）`,
        '- decisions：對話中確定的結論與決定（雙方都同意或使用者採納的）',
        '- openQuestions：還沒解決的問題',
        '- topics：1–3 個主題詞',
        '- related：對話中提到的 vault 筆記標題或路徑（沒有就空陣列）',
        `每個陣列項目是一句完整的話。用 ${language} 撰寫。`,
      ].join('\n'),
    },
    { role: 'user', content: transcript },
  ]
}

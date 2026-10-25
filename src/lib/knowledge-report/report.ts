// Fork（#35）：知識報告筆記——期別、送給模型的摘錄與 token 估算、評語解析與證據檢查、
// 報告筆記的輸出與讀回、優化建議的處理狀態、是否到期。純函式。
// 術語見 GLOSSARY.md「知識報告」「優化建議」；規格 personal/specs/11 §3.4–§3.5。
//
// 報告筆記 = frontmatter（結構化資料：給首頁、下一期比較、建議狀態）＋ 內文（給人讀）。
// 報告只新增自己的筆記，絕不修改其他筆記。
import type OpenAI from 'openai'
import YAML from 'yaml'
import { joinFrontmatter, splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { parseFrontmatterData } from '@/lib/vault-index/index-note'
import { isoWeekKey } from '@/lib/home/signals'
import { dayKey } from '@/lib/home/activity'
import type { Gap, MasteryLevel, MetricKey } from './mastery'
import type { TopicResult } from './aggregate'
import { REPORT_FOLDER } from './topics'

export const REPORT_TYPE = '知識報告'

export type ReportFrequency = 'daily' | 'weekly' | 'monthly'

/** 期別：每日 2026-10-26、每週 2026-W44、每月 2026-10。 */
export function periodKey(date: Date, frequency: ReportFrequency): string {
  if (frequency === 'daily') return dayKey(date)
  if (frequency === 'monthly') return dayKey(date).slice(0, 7)
  return isoWeekKey(date)
}

export function reportPath(period: string): string {
  return `${REPORT_FOLDER}/${period} ${REPORT_TYPE}.md`
}

// ---------------------------------------------------------------------------
// 資料模型（存在報告筆記的 frontmatter）

export type SuggestionStatus = 'open' | 'handed' | 'done' | 'dismissed'

export interface ReportSuggestion {
  id: string
  topic: string
  text: string
  /** 交給 Agent 時預填的指令 */
  prompt: string
  status: SuggestionStatus
  task?: string
}

export interface ReportEvidence {
  quote: string
  /** vault 相對路徑 */
  path: string
}

export interface ReportTopic {
  name: string
  level: MasteryLevel
  score: number
  notes: number
  prevLevel: MasteryLevel | null
  prevScore: number | null
  /** 「還差什麼」的文字（產出時依語系寫好） */
  gap: string
  comment: string
  evidence: ReportEvidence[]
}

export interface ReportStats {
  notes: number
  /** 沒有任何連出連結 */
  unlinked: number
  /** 沒有進也沒有出的連結 */
  orphans: number
  inbox: number
}

export interface ReportData {
  period: string
  generated: string
  model: string
  tokens: number
  topics: ReportTopic[]
  suggestions: ReportSuggestion[]
  stats: ReportStats
}

const LEVEL_SET = new Set<MasteryLevel>(['contact', 'organized', 'internalized', 'integrated'])

function asLevel(value: unknown): MasteryLevel | null {
  return typeof value === 'string' && LEVEL_SET.has(value as MasteryLevel) ? value as MasteryLevel : null
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 從 frontmatter 讀回報告；不是報告或格式不對時回傳 null。 */
export function reportFromFrontmatter(fm: Record<string, unknown> | null): ReportData | null {
  if (!fm || fm.type !== REPORT_TYPE || typeof fm.period !== 'string') return null
  const topics = Array.isArray(fm.topics) ? fm.topics : []
  const suggestions = Array.isArray(fm.suggestions) ? fm.suggestions : []
  const stats = (fm.stats && typeof fm.stats === 'object' ? fm.stats : {}) as Record<string, unknown>
  return {
    period: fm.period,
    generated: str(fm.generated),
    model: str(fm.model),
    tokens: num(fm.tokens),
    topics: topics.flatMap((raw: Record<string, unknown>) => {
      const level = asLevel(raw?.level)
      if (!raw || typeof raw.name !== 'string' || !level) return []
      return [{
        name: raw.name,
        level,
        score: num(raw.score),
        notes: num(raw.notes),
        prevLevel: asLevel(raw.prevLevel),
        prevScore: typeof raw.prevScore === 'number' ? raw.prevScore : null,
        gap: str(raw.gap),
        comment: str(raw.comment),
        evidence: Array.isArray(raw.evidence)
          ? raw.evidence.flatMap((item: Record<string, unknown>) => (item && typeof item.quote === 'string' && typeof item.path === 'string' ? [{ quote: item.quote, path: item.path }] : []))
          : [],
      }]
    }),
    suggestions: suggestions.flatMap((raw: Record<string, unknown>) => {
      if (!raw || typeof raw.id !== 'string' || typeof raw.text !== 'string') return []
      const status = (['open', 'handed', 'done', 'dismissed'] as const).find(item => item === raw.status) ?? 'open'
      return [{ id: raw.id, topic: str(raw.topic), text: raw.text, prompt: str(raw.prompt) || raw.text, status, ...(typeof raw.task === 'string' ? { task: raw.task } : {}) }]
    }),
    stats: { notes: num(stats.notes), unlinked: num(stats.unlinked), orphans: num(stats.orphans), inbox: num(stats.inbox) },
  }
}

/** 最新一期：依期別字串排序（同一種頻率可直接比；不同頻率以產出時間為準）。 */
export function latestReport<T extends { report: ReportData }>(reports: T[]): T | null {
  return reports.reduce<T | null>((best, item) => (!best || item.report.generated > best.report.generated ? item : best), null)
}

// ---------------------------------------------------------------------------
// 是否到期

/** 已有基準（至少一期）且這一期還沒產出，才算到期；第一次一律由使用者建立基準。 */
export function isReportDue(latest: ReportData | null, now: Date, frequency: ReportFrequency): boolean {
  if (!latest) return false
  return latest.period !== periodKey(now, frequency)
}

// ---------------------------------------------------------------------------
// 送給模型的摘錄與 token 估算

export interface TopicExcerptNote {
  path: string
  content: string
  changed: boolean
  ownWords: number
}

export const EXCERPT_NOTES = 8
export const EXCERPT_CHARS_PER_NOTE = 1200
/** 每個主題預估的輸出 token */
export const OUTPUT_TOKENS_PER_TOPIC = 700

/** 選出要給模型看的筆記：上一期之後變動的優先，再依自己寫的字數。每篇截斷。 */
export function pickExcerpts(notes: TopicExcerptNote[], limit = EXCERPT_NOTES, chars = EXCERPT_CHARS_PER_NOTE): Array<{ path: string; text: string }> {
  return [...notes]
    .sort((a, b) => Number(b.changed) - Number(a.changed) || b.ownWords - a.ownWords || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map(note => {
      const body = splitFrontmatter(note.content).body.trim()
      return { path: note.path, text: Array.from(body).length > chars ? `${Array.from(body).slice(0, chars).join('')}…` : body }
    })
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu

/** 粗估：中日韓一字約一 token，其他每 4 個字元一 token。 */
export function estimateTokens(text: string): number {
  const cjk = text.match(CJK_RE)?.length ?? 0
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

export interface TopicPromptInput {
  result: TopicResult
  levelName: string
  gapText: string
  excerpts: Array<{ path: string; text: string }>
  /** 對話摘要裡「我的觀點與理解」 */
  myViews: string[]
  /** 主題摘要快取（上一期的評語），沒有變動時沿用 */
  previous: string | null
}

export function buildTopicMessages(input: TopicPromptInput, language: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const { result } = input
  const memories = result.evidence.memories.map(memory => `- （記憶·${memory.kind}，id ${memory.id}）${memory.content}`)
  const parts = [
    `主題：${result.topic.name}`,
    `掌握度：${input.levelName}（${result.mastery.score} 分，${result.paths.length} 篇筆記）`,
    `離下一級還差：${input.gapText || '（已是最高級）'}`,
    input.previous ? `上一期的評語：${input.previous}` : '',
    input.myViews.length ? `對話摘要中使用者自己的觀點：\n${input.myViews.map(view => `- ${view}`).join('\n')}` : '',
    memories.length ? `相關記憶（只讀）：\n${memories.join('\n')}` : '',
    '筆記摘錄：',
    ...input.excerpts.map(excerpt => `<<<${excerpt.path}\n${excerpt.text}\n>>>`),
  ].filter(Boolean)
  return [
    {
      role: 'system',
      content: [
        '你是使用者的知識教練。根據下面的掌握度數據與筆記摘錄，寫出這個主題的評語與優化建議。',
        '等級與分數由公式算出，你不要自己評分、也不要改等級。',
        '只回傳一個 JSON 物件，不要其他文字：',
        '{"comment":"2–4 句評語","evidence":[{"quote":"原文","path":"筆記路徑"}],"suggestions":[{"text":"一句具體建議","prompt":"交給 Agent 執行時的完整指令"}]}',
        '- evidence：1–3 條，quote 必須是摘錄中逐字出現的原文（15–80 字），path 必須是摘錄標頭的路徑。',
        '- suggestions：0–3 條，針對「離下一級還差」：例如合併重複的筆記、用自己的話補觀點、補上與其他主題的連結。',
        '- prompt 要寫清楚要處理哪些筆記（用 [[筆記名]]），並說明修改會先存成草稿等使用者審核。',
        `用 ${language} 撰寫。`,
      ].join('\n'),
    },
    { role: 'user', content: parts.join('\n\n') },
  ]
}

export interface TopicReview {
  comment: string
  evidence: ReportEvidence[]
  suggestions: Array<{ text: string; prompt: string }>
}

/** 引文至少要有幾個字才算證據。 */
export const MIN_QUOTE_CHARS = 8

function normalizeSpaces(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

/** 解析模型回傳；引用的原文必須真的出現在該筆記裡，否則丟掉（評語只能附真的證據）。 */
export function parseTopicReview(raw: string, contents: ReadonlyMap<string, string>): TopicReview | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let value: Record<string, unknown>
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const comment = typeof value.comment === 'string' ? value.comment.trim() : ''
  if (!comment) return null
  const evidence: ReportEvidence[] = []
  for (const item of Array.isArray(value.evidence) ? value.evidence : []) {
    const quote = typeof item?.quote === 'string' ? item.quote.trim().replace(/^[「"]|[」"]$/g, '') : ''
    const path = typeof item?.path === 'string' ? item.path.trim() : ''
    const content = contents.get(path)
    // 太短的不算證據（例如「剛記下來。」）
    if (Array.from(normalizeSpaces(quote)).length < MIN_QUOTE_CHARS) continue
    if (content === undefined || !normalizeSpaces(content).includes(normalizeSpaces(quote))) continue
    if (!evidence.some(existing => existing.quote === quote)) evidence.push({ quote, path })
  }
  const suggestions = (Array.isArray(value.suggestions) ? value.suggestions : []).flatMap((item: Record<string, unknown>) => {
    const textValue = typeof item?.text === 'string' ? item.text.trim() : ''
    if (!textValue) return []
    return [{ text: textValue, prompt: typeof item.prompt === 'string' && item.prompt.trim() ? item.prompt.trim() : textValue }]
  }).slice(0, 3)
  return { comment, evidence: evidence.slice(0, 3), suggestions }
}

// ---------------------------------------------------------------------------
// 缺口文字

export type MetricLabels = Record<MetricKey, string>

/** 「結構 1／2、內部連結 0／2」；OR 的一組用「或」連接。 */
export function gapText(gaps: Gap[], labels: MetricLabels, or: string, pointsToNext: number, pointsLabel: string): string {
  const parts = gaps.map(gap => gap.options.map(option => `${labels[option.metric]} ${option.have}／${option.need}`).join(` ${or} `))
  if (pointsToNext > 0) parts.push(pointsLabel.replace('{points}', String(pointsToNext)))
  return parts.join('、')
}

// ---------------------------------------------------------------------------
// 輸出

export interface ReportTexts {
  title: string
  levels: Record<MasteryLevel, string>
  headings: { topics: string; suggestions: string; stats: string }
  /** 例：「上期 {level}」 */
  previous: string
  firstTime: string
  /** 例：「{score} 分 · {notes} 篇」 */
  scoreLine: string
  gapLabel: string
  topLevel: string
  noComment: string
  noSuggestions: string
  stats: { notes: string; unlinked: string; orphans: string; inbox: string }
  footer: string
}

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''))
}

function wikilink(path: string) {
  return `[[${path.replace(/\.md$/i, '')}]]`
}

/**
 * 內文裡的引文只給人讀：壓成一行，並把任務、雙鏈、標籤語法中和掉，
 * 免得報告筆記多出待辦（首頁會收進任務清單）、連結或標籤。逐字原文留在 frontmatter。
 */
export function quoteForBody(quote: string): string {
  return quote
    .replace(/(^|\n)\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/g, '$1')
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]+)\]\]/g, '$1')
    .replace(/(^|[^\w&])#(?=[^\s#])/gu, '$1＃')
    .replace(/\s+/g, ' ')
    .trim()
}

export function renderReport(data: ReportData, texts: ReportTexts): string {
  const frontmatter = YAML.stringify({ type: REPORT_TYPE, ...data }, { lineWidth: 0 }).trimEnd()
  const topicBlocks = data.topics.map(topic => {
    const prev = topic.prevLevel ? fill(texts.previous, { level: texts.levels[topic.prevLevel] }) : texts.firstTime
    const lines = [
      `### ${topic.name}`,
      '',
      `**${texts.levels[topic.level]}**（${prev}）· ${fill(texts.scoreLine, { score: topic.score, notes: topic.notes })}`,
      '',
      `${texts.gapLabel}${topic.gap || texts.topLevel}`,
      '',
      topic.comment || texts.noComment,
    ]
    for (const item of topic.evidence) lines.push('', `> 「${quoteForBody(item.quote)}」— ${wikilink(item.path)}`)
    return lines.join('\n')
  })
  const suggestions = data.suggestions.length
    ? data.suggestions.map(item => `- 〔${item.topic}〕${item.text}`).join('\n')
    : `- ${texts.noSuggestions}`
  const s = data.stats
  const stats = [
    `- ${texts.stats.notes}：${s.notes}`,
    `- ${texts.stats.unlinked}：${s.unlinked}`,
    `- ${texts.stats.orphans}：${s.orphans}`,
    `- ${texts.stats.inbox}：${s.inbox}`,
  ].join('\n')
  return [
    `---\n${frontmatter}\n---`,
    `# ${fill(texts.title, { period: data.period })}`,
    `## ${texts.headings.topics}`,
    ...topicBlocks,
    `## ${texts.headings.suggestions}`,
    suggestions,
    `## ${texts.headings.stats}`,
    stats,
    `*${texts.footer}*`,
  ].join('\n\n') + '\n'
}

/** 只改 frontmatter 的 suggestions（處理狀態），內文原樣保留。 */
export function updateSuggestionInNote(content: string, id: string, patch: Partial<Pick<ReportSuggestion, 'status' | 'task'>>): string | null {
  const { block, body } = splitFrontmatter(content)
  const data = parseFrontmatterData(block)
  if (!data || data.type !== REPORT_TYPE || !Array.isArray(data.suggestions)) return null
  let found = false
  data.suggestions = data.suggestions.map((item: Record<string, unknown>) => {
    if (item?.id !== id) return item
    found = true
    return { ...item, ...patch }
  })
  if (!found) return null
  return joinFrontmatter(`---\n${YAML.stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n`, body)
}

/**
 * 新一期的建議沿用舊狀態：同一期重新產生時沿用這一期的（含 id）；主題沒變、沿用上一期評語時，
 * 也沿用上一期的處理狀態，免得已略過或已處理的建議每一期都冒出來。比對主題＋文字完全相同。
 */
export function carrySuggestion(
  item: { topic: string; text: string; prompt: string },
  newId: string,
  current: ReportData | null,
  previous: ReportData | null,
): ReportSuggestion {
  const match = (report: ReportData | null) => report?.suggestions.find(old => old.topic === item.topic && old.text === item.text)
  const same = match(current)
  const prior = previous && previous.period !== current?.period ? match(previous) : undefined
  const from = same ?? prior
  return {
    id: same?.id ?? newId,
    topic: item.topic,
    text: item.text,
    prompt: item.prompt,
    status: from?.status ?? 'open',
    ...(from?.task ? { task: from.task } : {}),
  }
}

/** 交給 Agent 的任務已完成 → 建議算處理完。 */
export function settleSuggestions(report: ReportData, taskStatus: (taskId: string) => string | undefined): Array<{ id: string; status: SuggestionStatus }> {
  const out: Array<{ id: string; status: SuggestionStatus }> = []
  for (const item of report.suggestions) {
    if (item.status !== 'handed' || !item.task) continue
    if (taskStatus(item.task) === 'completed') out.push({ id: item.id, status: 'done' })
  }
  return out
}

export function openSuggestions(report: ReportData | null): ReportSuggestion[] {
  return report ? report.suggestions.filter(item => item.status === 'open') : []
}

/** 掌握度變化最大的主題在前（沒有上期的排後面）。 */
export function topicsByChange(report: ReportData): ReportTopic[] {
  const delta = (topic: ReportTopic) => (topic.prevScore === null ? -1 : Math.abs(topic.score - topic.prevScore))
  return [...report.topics].sort((a, b) => delta(b) - delta(a) || b.score - a.score)
}

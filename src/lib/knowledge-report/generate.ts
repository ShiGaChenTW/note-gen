// Fork（#35）：產出知識報告（I/O 層）。先 plan（算掌握度、決定要問模型的主題、估 token），
// 確認後 run（逐主題問模型、檢查證據、寫報告筆記）。報告只新增自己的筆記，不改其他筆記。
import { Store } from '@tauri-apps/plugin-store'
import { fetchAi } from '@/lib/ai/chat'
import { readNote, writeNote } from '@/lib/daily/note-io'
import useDailySettingsStore from '@/stores/daily-settings'
import useVaultIndexStore from '@/stores/vault-index'
import { vaultStats, type TopicResult } from './aggregate'
import { getTopicSummary, setTopicSummary, topicFingerprint } from './cache'
import { LEVELS } from './mastery'
import { summaryViews } from './note-signals'
import {
  buildTopicMessages,
  carrySuggestion,
  estimateTokens,
  gapText,
  latestReport,
  OUTPUT_TOKENS_PER_TOPIC,
  parseTopicReview,
  periodKey,
  pickExcerpts,
  renderReport,
  reportFromFrontmatter,
  reportPath,
  updateSuggestionInNote,
  type MetricLabels,
  type ReportData,
  type ReportFrequency,
  type ReportSuggestion,
  type ReportTexts,
  type ReportTopic,
  type TopicReview,
} from './report'
import { computeKnowledgeSnapshot, saveReportCache, type KnowledgeSnapshot } from './sources'

export const REPORT_SETTINGS_KEY = 'knowledgeReportSettings'
/** ModelSelect 的 modelKey="knowledgeReport" 存在這個鍵；沒設就用預設模型。 */
export const REPORT_MODEL_KEY = 'knowledgeReportModel'

export interface ReportSettings {
  frequency: ReportFrequency | 'off'
  /** 單期估算超過就暫停，等使用者確認 */
  tokenLimit: number
  /** 未處理的優化建議列進「需要你處理」 */
  remindSuggestions: boolean
}

export const DEFAULT_REPORT_SETTINGS: ReportSettings = { frequency: 'weekly', tokenLimit: 200_000, remindSuggestions: true }

export function normalizeReportSettings(saved: unknown): ReportSettings {
  const value = (saved && typeof saved === 'object' ? saved : {}) as Partial<ReportSettings>
  return {
    frequency: (['daily', 'weekly', 'monthly', 'off'] as const).find(item => item === value.frequency) ?? DEFAULT_REPORT_SETTINGS.frequency,
    tokenLimit: typeof value.tokenLimit === 'number' && value.tokenLimit >= 1000 ? Math.floor(value.tokenLimit) : DEFAULT_REPORT_SETTINGS.tokenLimit,
    remindSuggestions: typeof value.remindSuggestions === 'boolean' ? value.remindSuggestions : DEFAULT_REPORT_SETTINGS.remindSuggestions,
  }
}

export async function loadReportSettings(): Promise<ReportSettings> {
  try {
    return normalizeReportSettings(await (await Store.load('store.json')).get(REPORT_SETTINGS_KEY))
  } catch {
    return DEFAULT_REPORT_SETTINGS
  }
}

export async function saveReportSettings(settings: ReportSettings): Promise<void> {
  const store = await Store.load('store.json')
  await store.set(REPORT_SETTINGS_KEY, settings)
  await store.save()
}

/** 索引裡的所有報告筆記（從 frontmatter 讀，不讀檔）。 */
export function listReports(notes: Iterable<{ path: string; frontmatter: Record<string, unknown> | null }>): Array<{ path: string; report: ReportData }> {
  const out: Array<{ path: string; report: ReportData }> = []
  for (const note of notes) {
    const report = reportFromFrontmatter(note.frontmatter)
    if (report) out.push({ path: note.path, report })
  }
  return out
}

export function latestReportInIndex() {
  return latestReport(listReports(useVaultIndexStore.getState().notes.values()))
}

// ---------------------------------------------------------------------------
// 文字（由畫面註冊目前語系）

export interface GenerateTexts {
  report: ReportTexts
  metrics: MetricLabels
  or: string
  points: string
  language: string
}

let texts: GenerateTexts | null = null

export function setReportTexts(next: GenerateTexts) {
  texts = next
}

// ---------------------------------------------------------------------------
// plan

export interface TopicPlan {
  result: TopicResult
  fingerprint: string
  /** 主題沒有變動時沿用上一期的評語，不問模型 */
  cached: TopicReview | null
  messages: ReturnType<typeof buildTopicMessages> | null
  /** 摘錄筆記的全文，用來檢查證據 */
  contents: Map<string, string>
  gap: string
}

export interface ReportPlan {
  period: string
  path: string
  previous: ReportData | null
  snapshot: KnowledgeSnapshot
  topics: TopicPlan[]
  /** 這一期估計要用的 token（輸入＋輸出） */
  estimate: number
}

function requireTexts(): GenerateTexts {
  if (!texts) throw new Error('report texts not registered')
  return texts
}

export async function planReport(now: Date, frequency: ReportFrequency): Promise<ReportPlan> {
  const t = requireTexts()
  const snapshot = await computeKnowledgeSnapshot()
  const { input, cache } = snapshot.sources
  const latest = latestReportInIndex()
  const previous = latest?.report ?? null
  const since = previous ? Date.parse(previous.generated) || 0 : 0
  const byPath = new Map(input.notes.map(note => [note.path, note]))

  const topics: TopicPlan[] = []
  for (const result of snapshot.results) {
    const gap = gapText(result.mastery.gaps, t.metrics, t.or, result.mastery.pointsToNext, t.points)
    const fingerprint = topicFingerprint(
      [...result.paths, ...result.evidence.summaries, `score:${result.mastery.score}`, ...result.evidence.memories.map(memory => `memory:${memory.id}`)],
      path => byPath.get(path)?.mtime ?? 0,
    )
    const cachedText = getTopicSummary(cache, result.topic.name, fingerprint)
    let cached: TopicReview | null = null
    if (cachedText) {
      try { cached = JSON.parse(cachedText) as TopicReview } catch { cached = null }
    }
    if (cached || result.paths.length === 0) {
      topics.push({ result, fingerprint, cached, messages: null, contents: new Map(), gap })
      continue
    }
    // 先用索引資料挑出要讀的筆記，避免讀整個大主題
    const ranked = result.paths
      .map(path => ({ path, changed: (byPath.get(path)?.mtime ?? 0) > since, ownWords: input.analyses.get(path)?.ownWords ?? 0 }))
      .sort((a, b) => Number(b.changed) - Number(a.changed) || b.ownWords - a.ownWords)
      .slice(0, 8)
    const contents = new Map<string, string>()
    for (const item of ranked) {
      const content = await readNote(item.path).catch(() => null)
      if (content !== null) contents.set(item.path, content)
    }
    const excerpts = pickExcerpts(ranked.filter(item => contents.has(item.path)).map(item => ({ ...item, content: contents.get(item.path)! })))
    const myViews: string[] = []
    for (const path of result.evidence.summaries.slice(-5)) {
      const content = await readNote(path).catch(() => null)
      if (content) myViews.push(...summaryViews(content))
    }
    const prevComment = previous?.topics.find(topic => topic.name === result.topic.name)?.comment ?? null
    const messages = buildTopicMessages({
      result,
      levelName: t.report.levels[result.mastery.level],
      gapText: gap,
      excerpts,
      myViews: myViews.slice(0, 10),
      previous: prevComment,
    }, t.language)
    topics.push({ result, fingerprint, cached: null, messages, contents, gap })
  }
  const estimate = topics.reduce((sum, topic) => (
    topic.messages ? sum + estimateTokens(topic.messages.map(message => String(message.content)).join('\n')) + OUTPUT_TOKENS_PER_TOPIC : sum
  ), 0)
  const period = periodKey(now, frequency)
  return { period, path: reportPath(period), previous, snapshot, topics, estimate }
}

// ---------------------------------------------------------------------------
// run

/** 報告用的模型：有另外設定就用它，否則用預設模型。回傳 fetchAi 的鍵與模型 id（記進報告）。 */
async function reportModel(): Promise<{ key: string | undefined; id: string }> {
  try {
    const store = await Store.load('store.json')
    const own = await store.get(REPORT_MODEL_KEY)
    if (typeof own === 'string' && own) return { key: REPORT_MODEL_KEY, id: own }
    const primary = await store.get('primaryModel')
    return { key: undefined, id: typeof primary === 'string' ? primary : '' }
  } catch {
    return { key: undefined, id: '' }
  }
}

export interface RunContext {
  signal: AbortSignal
  onTokens: (tokens: number) => void
  now: () => Date
}

/** 逐主題問模型、寫報告筆記；回傳報告路徑。 */
export async function runReport(plan: ReportPlan, context: RunContext): Promise<{ path: string; tokens: number }> {
  const t = requireTexts()
  const model = await reportModel()
  const key = model.key
  let cache = plan.snapshot.sources.cache
  let tokens = 0
  let asked = 0
  let answered = 0
  const reviews = new Map<string, TopicReview | null>()
  for (const topic of plan.topics) {
    if (context.signal.aborted) throw new Error('aborted')
    if (topic.cached || !topic.messages) {
      reviews.set(topic.result.topic.name, topic.cached)
      continue
    }
    asked++
    const raw = await fetchAi('', key, topic.messages)
    tokens += estimateTokens(topic.messages.map(message => String(message.content)).join('\n')) + estimateTokens(raw)
    context.onTokens(tokens)
    const review = raw ? parseTopicReview(raw, topic.contents) : null
    if (review) {
      answered++
      cache = setTopicSummary(cache, topic.result.topic.name, topic.fingerprint, JSON.stringify(review))
    }
    reviews.set(topic.result.topic.name, review)
  }
  if (asked > 0 && answered === 0) throw new Error(t.report.noComment)

  const existing = reportFromFrontmatter(useVaultIndexStore.getState().notes.get(plan.path)?.frontmatter ?? null)
  const suggestions: ReportSuggestion[] = []
  const topics: ReportTopic[] = plan.topics.map(topic => {
    const { result } = topic
    const prev = plan.previous?.topics.find(item => item.name === result.topic.name)
    const review = reviews.get(result.topic.name) ?? null
    for (const item of review?.suggestions ?? []) {
      suggestions.push(carrySuggestion({ topic: result.topic.name, ...item }, `${plan.period}-${suggestions.length + 1}`, existing, plan.previous))
    }
    return {
      name: result.topic.name,
      level: result.mastery.level,
      score: result.mastery.score,
      notes: result.paths.length,
      prevLevel: prev?.level ?? null,
      prevScore: prev?.score ?? null,
      gap: topic.gap,
      comment: review?.comment ?? '',
      evidence: review?.evidence ?? [],
    }
  })
  topics.sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || b.score - a.score)
  const { inboxFolder } = useDailySettingsStore.getState()
  const now = context.now()
  const data: ReportData = {
    period: plan.period,
    generated: now.toISOString(),
    model: model.id,
    tokens,
    topics,
    suggestions,
    stats: vaultStats(plan.snapshot.sources.input, inboxFolder),
  }
  if (context.signal.aborted) throw new Error('aborted')
  await writeNote(plan.path, renderReport(data, t.report))
  await saveReportCache(cache).catch(error => console.warn('[knowledge-report] cache save failed:', error))
  return { path: plan.path, tokens }
}

/** 改一條建議的處理狀態（只改報告筆記的 frontmatter）。 */
export async function updateSuggestion(path: string, id: string, patch: Partial<Pick<ReportSuggestion, 'status' | 'task'>>): Promise<boolean> {
  const content = await readNote(path)
  if (content === null) return false
  const next = updateSuggestionInNote(content, id, patch)
  if (next === null || next === content) return false
  await writeNote(path, next)
  return true
}

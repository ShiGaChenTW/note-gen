// Fork（#34）：掌握度公式。行為訊號 → 0–100 → 接觸／整理／內化／融會，附「離下一級還差什麼」。
// AI 不自評；這裡是唯一算分數的地方。權重與門檻是第一版起點，要用真實 vault 校準（規格 §8）。
// 術語見 GLOSSARY.md「掌握度」；規格 personal/specs/11 §3.2。

export type MasteryLevel = 'contact' | 'organized' | 'internalized' | 'integrated'

export const LEVELS: MasteryLevel[] = ['contact', 'organized', 'internalized', 'integrated']

/** 一個主題彙整後的行為訊號（aggregate.ts 產生）。 */
export interface TopicSignals {
  notes: number
  ownWords: number
  quotedWords: number
  /** 有兩個以上標題、或本身是 MOC 的筆記數 */
  structuredNotes: number
  hasMoc: boolean
  /** 有總結段落的筆記數 */
  summaries: number
  /** 有心得段落的筆記數 */
  reflections: number
  /** 對話摘要裡「我的觀點與理解」的條數 */
  myViews: number
  /** 對話摘要裡「AI 的解答重點」的條數（只算接觸） */
  aiPoints: number
  /** 主題內筆記互相連結的數量 */
  internalLinks: number
  /** 連到其他主題筆記的數量 */
  crossLinks: number
  /** 在兩天以上修改過的筆記數（用自己的話改寫） */
  revisedNotes: number
  /** 有寫、改、重讀或在每日筆記提到的不同天數 */
  touchDays: number
  /** 第一次到最後一次接觸相隔的天數 */
  spanDays: number
  /** 每日筆記連到這個主題的不同天數（實際用過） */
  dailyMentions: number
  /** 相關的 active experience 記憶數 */
  experienceMemories: number
}

export type MetricKey =
  | 'notes'
  | 'structure'
  | 'internalLinks'
  | 'ownRatio'
  | 'ownViews'
  | 'revisedNotes'
  | 'crossLinks'
  | 'applied'
  | 'spanDays'

/** 門檻用到的衍生指標。 */
export function metrics(s: TopicSignals): Record<MetricKey, number> {
  const words = s.ownWords + s.quotedWords
  return {
    notes: s.notes,
    structure: Math.max(s.structuredNotes, s.hasMoc ? 2 : 0),
    internalLinks: s.internalLinks,
    ownRatio: words === 0 ? 0 : Math.round((s.ownWords / words) * 100) / 100,
    ownViews: s.reflections + s.summaries + s.myViews,
    revisedNotes: s.revisedNotes,
    crossLinks: s.crossLinks,
    applied: s.dailyMentions + s.experienceMemories,
    spanDays: s.spanDays,
  }
}

export interface Requirement {
  metric: MetricKey
  need: number
}

export interface MasteryConfig {
  /** 各分項的滿分（合計 100）與達到滿分所需的量 */
  weights: {
    volume: { points: number; words: number }
    ownWords: { points: number; words: number }
    structure: { points: number; target: number }
    links: { points: number; target: number }
    views: { points: number; target: number }
    review: { points: number; days: number; span: number }
    integration: { points: number; target: number }
  }
  /** 每一級的起始分數 */
  bands: Record<MasteryLevel, number>
  /**
   * 每一級的門檻：外層全部要過（AND），內層任一即可（OR）。
   * 分數到了但門檻沒過，等級停在前一級，分數也壓在下一級起點之下。
   */
  gates: Record<Exclude<MasteryLevel, 'contact'>, Requirement[][]>
  /** 對話摘要裡 AI 的重點，每條折算成多少字的接觸量 */
  aiPointWords: number
}

export const DEFAULT_MASTERY_CONFIG: MasteryConfig = {
  weights: {
    volume: { points: 10, words: 3000 },
    ownWords: { points: 20, words: 2000 },
    structure: { points: 15, target: 4 },
    links: { points: 10, target: 8 },
    views: { points: 15, target: 4 },
    review: { points: 15, days: 8, span: 60 },
    integration: { points: 15, target: 6 },
  },
  bands: { contact: 0, organized: 25, internalized: 50, integrated: 75 },
  gates: {
    organized: [
      [{ metric: 'notes', need: 3 }],
      [{ metric: 'structure', need: 2 }],
      [{ metric: 'internalLinks', need: 2 }],
    ],
    internalized: [
      [{ metric: 'ownRatio', need: 0.5 }],
      [{ metric: 'ownViews', need: 2 }],
      [{ metric: 'revisedNotes', need: 1 }],
    ],
    integrated: [
      [{ metric: 'crossLinks', need: 3 }, { metric: 'applied', need: 2 }],
      [{ metric: 'spanDays', need: 14 }],
    ],
  },
  aiPointWords: 30,
}

export interface Gap {
  /** 這一組任一項達到即可 */
  options: Array<{ metric: MetricKey; have: number; need: number }>
}

export interface Mastery {
  score: number
  level: MasteryLevel
  /** 已是最高級時為 null */
  next: MasteryLevel | null
  /** 到下一級還差的分數（門檻都過了但分數不夠時大於 0） */
  pointsToNext: number
  /** 到下一級還沒過的門檻 */
  gaps: Gap[]
  /** 各分項得分，給報告解釋分數用 */
  breakdown: Record<keyof MasteryConfig['weights'], number>
  metrics: Record<MetricKey, number>
}

function ratio(value: number, target: number) {
  return target <= 0 ? 0 : Math.min(value / target, 1)
}

export function rawBreakdown(s: TopicSignals, config: MasteryConfig = DEFAULT_MASTERY_CONFIG): Mastery['breakdown'] {
  const w = config.weights
  const m = metrics(s)
  const words = s.ownWords + s.quotedWords + s.aiPoints * config.aiPointWords
  const round = (n: number) => Math.round(n * 10) / 10
  return {
    volume: round(w.volume.points * ratio(words, w.volume.words)),
    ownWords: round(w.ownWords.points * ratio(s.ownWords, w.ownWords.words)),
    structure: round(w.structure.points * ratio(m.structure, w.structure.target)),
    links: round(w.links.points * ratio(s.internalLinks, w.links.target)),
    views: round(w.views.points * ratio(m.ownViews, w.views.target)),
    review: round(w.review.points * (0.5 * ratio(s.touchDays, w.review.days) + 0.5 * ratio(s.spanDays, w.review.span))),
    integration: round(w.integration.points * ratio(s.crossLinks + 2 * m.applied, w.integration.target)),
  }
}

function unmet(gate: Requirement[][], m: Record<MetricKey, number>): Gap[] {
  const gaps: Gap[] = []
  for (const group of gate) {
    if (group.some(req => m[req.metric] >= req.need)) continue
    gaps.push({ options: group.map(req => ({ metric: req.metric, have: m[req.metric], need: req.need })) })
  }
  return gaps
}

export function computeMastery(s: TopicSignals, config: MasteryConfig = DEFAULT_MASTERY_CONFIG): Mastery {
  const breakdown = rawBreakdown(s, config)
  const m = metrics(s)
  const raw = Math.round(Object.values(breakdown).reduce((sum, n) => sum + n, 0))
  let level: MasteryLevel = 'contact'
  for (const candidate of LEVELS.slice(1) as Array<Exclude<MasteryLevel, 'contact'>>) {
    if (raw < config.bands[candidate] || unmet(config.gates[candidate], m).length > 0) break
    level = candidate
  }
  const index = LEVELS.indexOf(level)
  const next = LEVELS[index + 1] ?? null
  const score = next ? Math.min(raw, config.bands[next] - 1) : raw
  return {
    score,
    level,
    next,
    pointsToNext: next ? Math.max(0, config.bands[next] - raw) : 0,
    gaps: next ? unmet(config.gates[next as Exclude<MasteryLevel, 'contact'>], m) : [],
    breakdown,
    metrics: m,
  }
}

export function emptySignals(): TopicSignals {
  return {
    notes: 0, ownWords: 0, quotedWords: 0, structuredNotes: 0, hasMoc: false, summaries: 0, reflections: 0,
    myViews: 0, aiPoints: 0, internalLinks: 0, crossLinks: 0, revisedNotes: 0, touchDays: 0, spanDays: 0,
    dailyMentions: 0, experienceMemories: 0,
  }
}

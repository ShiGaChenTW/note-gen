// Fork（almanac ALMNC-54.11）：Scott 的指令要交給誰——路由器三層（R4）。
// 規格：almanac/2026-11-19_proposal_role-data-model.md 第四節「路由」；參數照 ALMNC-54.9 實測（2026-11-21_report_local-router-spike.md）。
//   1. 規則：前綴（@秘書、@Mia、@工業工程…）、已有標籤的對話、固定來源（舊筆記批次）、一句多意圖（順便／然後再／另外再）、
//      偏好語氣（以後／每次都／不要再／喜歡／不喜歡／改成每）。直接決定，不用模型。
//   2. 本機模型：嵌入模型（qwen3-embedding:0.6b）比對每類範例句，取每類前兩名相似度平均當分數；
//      信心值＝四類分數做 softmax（溫度 0.02）後的最大值。
//   3. 問 Scott：信心值低於門檻（0.7），或本機模型無法使用時。
// 四條路線：日程 → 秘書、處理 → 指揮官、查詢 → 專家、偏好 → Agent 設定區（Scott 的偏好）。
// 這裡全是純函式與注入的模型，接 App 的部分在 src/lib/router/sidebar.ts 與右側欄的送出流程。
import type { AgentRole } from '@/lib/agents/settings'
import type { ThreadTag } from '@/lib/threads/tags'
import exemplarData from './exemplars.json'

export const ROUTES = ['schedule', 'process', 'query', 'preference'] as const
export type Route = typeof ROUTES[number]

/** 每條路線交給誰。偏好不是角色，是 Agent 設定區裡 Scott 的偏好。 */
export const ROUTE_ROLE: Record<Route, AgentRole | 'settings'> = {
  schedule: 'secretary',
  process: 'commander',
  query: 'expert',
  preference: 'settings',
}

/** 對話標籤 ↔ 路線（偏好不開對話，所以沒有標籤）。 */
export const TAG_ROUTE: Record<ThreadTag, Route> = { schedule: 'schedule', process: 'process', query: 'query' }
export const ROUTE_TAG: Record<Route, ThreadTag | null> = { schedule: 'schedule', process: 'process', query: 'query', preference: null }

export const DEFAULT_THRESHOLD = 0.7
export const DEFAULT_TEMPERATURE = 0.02

export type Exemplars = Record<Route, readonly string[]>
export const DEFAULT_EXEMPLARS: Exemplars = exemplarData.routes as Exemplars

export interface RosterEntry {
  id: string
  name: string
  role: AgentRole
  domain?: string
  enabled: boolean
}

export interface RouteTarget {
  role: AgentRole | 'settings'
  agentId?: string
  name?: string
}

export type RouteLayer = 'rule' | 'model' | 'ask'

export type RouteReason =
  | 'prefix' | 'tagged' | 'fixed_source' | 'multi_intent' | 'preference_marker' // 規則
  | 'model' // 模型信心值夠高
  | 'low_confidence' | 'model_unavailable' | 'empty' // 問 Scott

export interface RouteDecision {
  /** 問 Scott 時是 null（suggestion 是模型最可能的那一類）。 */
  route: Route | null
  target: RouteTarget | null
  confidence: number
  layer: RouteLayer
  reason: RouteReason
  /** 前綴拿掉後的指令。 */
  text: string
  /** 模型最可能的一類（問 Scott 時用來預先標示）。 */
  suggestion?: Route
  /** 每類分數（模型層）。 */
  scores?: Record<Route, number>
  /** 前綴寫的是哪個名字或領域（例如「Mia」「工業工程」）。 */
  prefix?: string
}

export interface RouteContext {
  /** 已有標籤的對話（Scott 選過或之前就決定的）；新對話、沒有標籤的不填。 */
  tag?: ThreadTag | null
  /** 固定來源，例如舊筆記批次（R3）——一律交給指揮官。 */
  fixedSource?: 'legacy_batch'
  roster?: readonly RosterEntry[]
}

// —— 第一層：規則 ——

/** 一句多意圖的連接詞（交給指揮官拆）。照實測 rules_eval.py。 */
export const MULTI_INTENT = /順便|然後再|另外再|，再/
/** 偏好語氣詞。照實測 rules_eval.py。 */
export const PREFERENCE_MARKERS = /以後|每次都|不要再|喜歡|不喜歡|改成每/

/** 角色的固定稱呼（繁中、簡中、英文）。 */
const ROLE_WORDS: ReadonlyArray<[RegExp, Route]> = [
  [/^(秘書|秘书|secretary)$/i, 'schedule'],
  [/^(指揮官|指挥官|commander)$/i, 'process'],
  [/^(研究員|研究员|researcher)$/i, 'process'],
  [/^(專家|专家|expert)$/i, 'query'],
  [/^(設定|设置|設置|偏好|settings?|preferences?)$/i, 'preference'],
]

const ROLE_ROUTE: Record<AgentRole, Route> = { secretary: 'schedule', commander: 'process', researcher: 'process', expert: 'query' }

/** 「@秘書 明天…」→ { word: '秘書', rest: '明天…' }；沒有前綴回傳 null。全形＠也算。 */
export function parsePrefix(text: string): { word: string, rest: string } | null {
  const match = text.trim().match(/^[@＠]([^\s@＠,，:：]+)[\s,，:：]*([\s\S]*)$/)
  if (!match) return null
  return { word: match[1], rest: match[2].trim() }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

/** 前綴對到哪條路線與誰：角色稱呼、名單上的本名（@Mia）、專家的領域（@工業工程）。對不到回傳 null（當一般文字）。 */
export function resolvePrefix(word: string, roster: readonly RosterEntry[] = []): { route: Route, target: RouteTarget } | null {
  const active = roster.filter(agent => agent.enabled)
  for (const [pattern, route] of ROLE_WORDS) {
    if (!pattern.test(word)) continue
    const role = ROUTE_ROLE[route]
    if (route === 'query') return { route, target: { role: 'expert' } }
    const agent = role === 'settings' ? undefined : active.find(entry => entry.role === role)
    return { route, target: agent ? { role: agent.role, agentId: agent.id, name: agent.name } : { role } }
  }
  const key = normalizeName(word)
  const byName = active.find(agent => normalizeName(agent.name) === key)
  if (byName) return { route: ROLE_ROUTE[byName.role], target: { role: byName.role, agentId: byName.id, name: byName.name } }
  const byDomain = active.find(agent => agent.role === 'expert' && agent.domain && normalizeName(agent.domain) === key)
  if (byDomain) return { route: 'query', target: { role: 'expert', agentId: byDomain.id, name: byDomain.name } }
  return null
}

function defaultTarget(route: Route, roster: readonly RosterEntry[] = []): RouteTarget {
  const role = ROUTE_ROLE[route]
  if (role === 'settings' || role === 'expert') return { role }
  const agent = roster.find(entry => entry.enabled && entry.role === role)
  return agent ? { role, agentId: agent.id, name: agent.name } : { role }
}

function ruleDecision(route: Route, reason: RouteReason, text: string, roster: readonly RosterEntry[] | undefined, extra: Partial<RouteDecision> = {}): RouteDecision {
  return { route, target: defaultTarget(route, roster), confidence: 1, layer: 'rule', reason, text, ...extra }
}

/** 只跑第一層。回傳 null 表示規則判斷不了，要交給模型。 */
export function routeByRules(rawText: string, context: RouteContext = {}): RouteDecision | null {
  const trimmed = rawText.trim()
  const prefix = parsePrefix(trimmed)
  if (prefix) {
    const resolved = resolvePrefix(prefix.word, context.roster)
    if (resolved) {
      return { route: resolved.route, target: resolved.target, confidence: 1, layer: 'rule', reason: 'prefix', text: prefix.rest, prefix: prefix.word }
    }
  }
  if (context.tag) return ruleDecision(TAG_ROUTE[context.tag], 'tagged', trimmed, context.roster)
  if (context.fixedSource) return ruleDecision('process', 'fixed_source', trimmed, context.roster)
  if (MULTI_INTENT.test(trimmed)) return ruleDecision('process', 'multi_intent', trimmed, context.roster)
  if (PREFERENCE_MARKERS.test(trimmed)) return ruleDecision('preference', 'preference_marker', trimmed, context.roster)
  return null
}

// —— 第二層：嵌入模型＋範例句 ——

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** 每類取相似度前兩名的平均（只有一句範例就用那一句）。 */
export function routeScores(vector: readonly number[], exemplarVectors: Record<Route, readonly (readonly number[])[]>): Record<Route, number> {
  const scores = {} as Record<Route, number>
  for (const route of ROUTES) {
    const sims = (exemplarVectors[route] ?? []).map(exemplar => cosine(vector, exemplar)).sort((a, b) => b - a)
    scores[route] = sims.length >= 2 ? (sims[0] + sims[1]) / 2 : sims[0] ?? 0
  }
  return scores
}

export function softmax(values: readonly number[], temperature: number): number[] {
  const max = Math.max(...values)
  const exps = values.map(value => Math.exp((value - max) / temperature))
  const sum = exps.reduce((total, value) => total + value, 0)
  return exps.map(value => value / sum)
}

/** 最高分的一類與信心值（softmax 後的最大值）。這不是模型給的機率，高低取決於溫度。 */
export function pickRoute(scores: Record<Route, number>, temperature = DEFAULT_TEMPERATURE): { route: Route, confidence: number } {
  const values = ROUTES.map(route => scores[route])
  const probabilities = softmax(values, temperature)
  let best = 0
  for (let i = 1; i < ROUTES.length; i++) if (values[i] > values[best]) best = i
  return { route: ROUTES[best], confidence: probabilities[best] }
}

// —— 三層合起來 ——

export interface EmbeddingModel {
  available: () => Promise<boolean>
  embed: (texts: readonly string[]) => Promise<number[][]>
}

export interface RouterOptions {
  /** 沒有就只跑規則，其他都問 Scott。 */
  model?: EmbeddingModel
  exemplars?: Exemplars
  threshold?: number
  temperature?: number
}

export interface Router {
  route: (text: string, context?: RouteContext) => Promise<RouteDecision>
}

export function createRouter(options: RouterOptions = {}): Router {
  const exemplars = options.exemplars ?? DEFAULT_EXEMPLARS
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE
  // 範例句的向量只算一次；失敗就清掉，下一句再試。
  let exemplarVectors: Promise<Record<Route, number[][]>> | undefined

  function vectorsOfExemplars(model: EmbeddingModel): Promise<Record<Route, number[][]>> {
    exemplarVectors ??= (async () => {
      const texts = ROUTES.flatMap(route => exemplars[route] ?? [])
      const vectors = await model.embed(texts)
      const byRoute = {} as Record<Route, number[][]>
      let offset = 0
      for (const route of ROUTES) {
        const count = (exemplars[route] ?? []).length
        byRoute[route] = vectors.slice(offset, offset + count)
        offset += count
      }
      return byRoute
    })().catch(error => {
      exemplarVectors = undefined
      throw error
    })
    return exemplarVectors
  }

  function ask(text: string, reason: RouteReason, extra: Partial<RouteDecision> = {}): RouteDecision {
    return { route: null, target: null, confidence: 0, layer: 'ask', reason, text, ...extra }
  }

  return {
    route: async (rawText, context = {}) => {
      const rule = routeByRules(rawText, context)
      if (rule) return rule
      const text = rawText.trim()
      if (!text) return ask(text, 'empty')
      const model = options.model
      if (!model) return ask(text, 'model_unavailable')
      try {
        if (!await model.available()) return ask(text, 'model_unavailable')
        const [byRoute, [vector]] = await Promise.all([vectorsOfExemplars(model), model.embed([text])])
        const scores = routeScores(vector, byRoute)
        const { route, confidence } = pickRoute(scores, temperature)
        if (confidence < threshold) return ask(text, 'low_confidence', { confidence, suggestion: route, scores })
        return { route, target: defaultTarget(route, context.roster), confidence, layer: 'model', reason: 'model', text, scores }
      } catch (error) {
        console.warn('[router] local model unavailable, asking Scott:', error)
        return ask(text, 'model_unavailable')
      }
    },
  }
}

// —— 查詢要找哪位專家 ——

export type ExpertPick =
  | { kind: 'expert', agent: RosterEntry }
  /** 名單上沒有專家：由指揮官以只讀方式回答。 */
  | { kind: 'none' }
  /** 好幾位都可能：問 Scott 選誰。 */
  | { kind: 'ask', candidates: RosterEntry[] }

/** 指令裡提到某位專家的領域或本名就找他；只有一位專家也找他；其他情況問 Scott。 */
export function pickExpert(text: string, roster: readonly RosterEntry[] = [], preferredId?: string): ExpertPick {
  const experts = roster.filter(agent => agent.enabled && agent.role === 'expert')
  if (preferredId) {
    const preferred = experts.find(agent => agent.id === preferredId)
    if (preferred) return { kind: 'expert', agent: preferred }
  }
  if (!experts.length) return { kind: 'none' }
  const value = text.toLowerCase()
  const mentioned = experts.filter(agent => (agent.domain && value.includes(agent.domain.toLowerCase())) || value.includes(agent.name.toLowerCase()))
  if (mentioned.length === 1) return { kind: 'expert', agent: mentioned[0] }
  if (experts.length === 1) return { kind: 'expert', agent: experts[0] }
  return { kind: 'ask', candidates: mentioned.length > 1 ? mentioned : experts }
}

// —— 偏好 ——

/** 存成偏好的那一句：拿掉前綴與結尾標點。 */
export function preferenceLine(text: string): string {
  const prefix = parsePrefix(text)
  const body = (prefix && resolvePrefix(prefix.word)?.route === 'preference' ? prefix.rest : text).trim()
  return body.replace(/[。．.!！\s]+$/u, '')
}

/** 把一句偏好加到 Scott 的偏好（Markdown 清單）最後；已經有同一句就不重複。 */
export function appendPreference(existing: string, line: string): string {
  const item = line.trim()
  if (!item) return existing
  const lines = existing.split('\n').map(entry => entry.replace(/^\s*[-*]\s+/, '').trim())
  if (lines.includes(item)) return existing
  const base = existing.replace(/\s+$/, '')
  return `${base ? `${base}\n` : ''}- ${item}\n`
}

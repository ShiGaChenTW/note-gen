// Fork（almanac ALMNC-54.11）：右側欄送出時怎麼照路由器的決定做。只處理新對話、還沒有標籤的對話（已有標籤的照標籤走，等於規則層）。
// - 日程 → 標成日程，走秘書的直接修改（schedule-direct：Scott 親口交代的任務和行程直接寫）。
// - 處理 → 標成處理，交給指揮官。
// - 查詢 → 標成查詢，由專家以只讀方式回答（看得出領域就找那位專家，無法選出專家就由指揮官只讀回答）。
// - 偏好 → 先貼一行確認，Scott 同意後存進他的偏好（Agent 設定區，#111），不開對話。
// - 問 Scott → 輸入框上方出現四個去處讓他選；選了就照選的走，並記下來給之後補範例句、重新校準。
// 純函式；寫入（偏好、選擇記錄）由呼叫端注入。
import { TAG_ROLE, type ThreadTag } from '@/lib/threads/tags'
import { appendPreference, pickExpert, preferenceLine, ROUTE_TAG, type RosterEntry, type Route, type RouteDecision } from './router'

export type SidebarRoutePlan =
  /** 照一般流程送出：先把標籤記在對話上；readOnly 時只回答（查詢）。 */
  | { kind: 'run', route: Exclude<Route, 'preference'>, tag: ThreadTag, readOnly: boolean, answerAs?: RosterEntry, decision: RouteDecision }
  /** 偏好：貼一行確認。 */
  | { kind: 'confirmPreference', line: string, decision: RouteDecision }
  /** 問 Scott 交給誰（四個去處）。 */
  | { kind: 'askRoute', decision: RouteDecision }
  /** 查詢但看不出要找哪位專家：問 Scott 選誰。 */
  | { kind: 'askExpert', candidates: RosterEntry[], decision: RouteDecision }

/** 路由器的決定（或 Scott 在問句裡選的去處）→ 右側欄要做什麼。 */
export function planSidebarRoute(decision: RouteDecision, roster: readonly RosterEntry[] = []): SidebarRoutePlan {
  if (!decision.route) return { kind: 'askRoute', decision }
  const route = decision.route
  if (route === 'preference') return { kind: 'confirmPreference', line: preferenceLine(decision.text), decision }
  if (route === 'query') {
    const pick = pickExpert(decision.text, roster, decision.target?.agentId)
    if (pick.kind === 'ask' && decision.layer === 'ask') return { kind: 'askExpert', candidates: pick.candidates, decision }
    return { kind: 'run', route, tag: 'query', readOnly: true, ...(pick.kind === 'expert' ? { answerAs: pick.agent } : {}), decision }
  }
  const role = TAG_ROLE[route]
  const answerAs = roster.find(agent => agent.id === decision.target?.agentId && agent.enabled)
    ?? roster.find(agent => agent.role === role && agent.enabled)
  return { kind: 'run', route, tag: ROUTE_TAG[route]!, readOnly: answerAs?.role === 'researcher', answerAs, decision }
}

/** 既有對話只還原夥伴。明確轉給指揮官時，舊的秘書或專家身分隨標籤失效。 */
export function restoreSidebarRoute(tag: ThreadTag, agentId: string | undefined, roster: readonly RosterEntry[]): Extract<SidebarRoutePlan, { kind: 'run' }> {
  const role = TAG_ROLE[tag]
  const answerAs = roster.find(agent => agent.enabled && agent.id === agentId && (agent.role === role || tag === 'process' && agent.role === 'researcher'))
    ?? (tag === 'query' ? undefined : roster.find(agent => agent.enabled && agent.role === role))
  return {
    kind: 'run', route: tag, tag, readOnly: tag === 'query' || answerAs?.role === 'researcher', ...(answerAs ? { answerAs } : {}),
    decision: { route: tag, target: answerAs ? { role: answerAs.role, agentId: answerAs.id } : null, text: '', confidence: 1, layer: 'rule', reason: 'tagged' },
  }
}

/** Scott 在問句裡選了去處：當成規則層已決定（信心 1），再照一般方式規劃。 */
export function chooseRoute(decision: RouteDecision, route: Route, roster: readonly RosterEntry[] = [], expertId?: string): SidebarRoutePlan {
  const chosen: RouteDecision = {
    ...decision,
    route,
    confidence: 1,
    layer: 'ask',
    target: expertId ? { role: 'expert', agentId: expertId } : decision.target,
  }
  return planSidebarRoute(chosen, roster)
}

/** 右側欄要不要先問路由器：「處理」模式、新對話、沒有標籤、這次不是串流中追加的訊息。 */
export function shouldRouteSidebarMessage(input: { v3: boolean, readOnlyMode: boolean, streaming: boolean, hasMessages: boolean, explicitTag: ThreadTag | null, text: string, forced: boolean }): boolean {
  if (input.forced || !input.v3 || input.readOnlyMode || input.streaming) return false
  if (input.hasMessages || input.explicitTag) return false
  return input.text.trim().length > 0
}

// —— 偏好 ——

export interface PreferenceStore {
  get: () => Promise<string>
  save: (content: string) => Promise<void>
}

/** 存一句偏好（只有 Scott 能改偏好；這裡是 Scott 按了確認才呼叫）。回傳存了沒（已經有同一句就不寫）。 */
export async function savePreferenceLine(line: string, store: PreferenceStore): Promise<boolean> {
  const current = await store.get()
  const next = appendPreference(current, line)
  if (next === current) return false
  await store.save(next)
  return true
}

// —— 問 Scott 時他選了什麼（之後拿來補範例句、校準門檻） ——

export interface RouterChoice {
  text: string
  chosen: Route
  suggestion?: Route
  confidence: number
  reason: RouteDecision['reason']
  at: number
}

export const ROUTER_CHOICES_KEY = 'routerChoices'
export const MAX_ROUTER_CHOICES = 200

export function addRouterChoice(list: readonly RouterChoice[], choice: RouterChoice): RouterChoice[] {
  return [...list, choice].slice(-MAX_ROUTER_CHOICES)
}

/** 交給右側欄那次執行的一段說明（英文，接在右側欄規則後面），讓模型知道路由器把這句交給誰。 */
export function routeNote(plan: Extract<SidebarRoutePlan, { kind: 'run' }>): string {
  if (plan.route === 'schedule') {
    return 'Router: You are the secretary for this schedule conversation. If he asks for a task or an appointment, add it with schedule_add_task or schedule_add_event and pass his exact words as quote.'
  }
  if (plan.route === 'query') {
    const who = plan.answerAs ? `the expert "${plan.answerAs.name}"${plan.answerAs.domain ? ` (domain: ${plan.answerAs.domain})` : ''}` : 'the commander'
    return `Router: Scott's message is a question (query). You are answering as ${who}. Answer from the notes only; do not change, propose or schedule anything.`
  }
  return plan.decision.reason === 'multi_intent'
    ? 'Router: this message contains more than one request. As the commander, split it into separate items before acting on each.'
    : ''
}

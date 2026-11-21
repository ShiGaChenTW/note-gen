// Fork（almanac ALMNC-54.5）：提案的來龍去脈——來自哪段對話、再次討論的說明、被哪一則新提案取代，以及 14 天規則。
// 規格見 almanac/2026-11-19_proposal_role-data-model.md 第三節「提案」。全是純函式，加上存 store.json 的對照表。
//
// 提案本身仍住在各自的來源（收集提案在 collectItems、Agent 草稿在 agent_tasks、工作結果在 jobs），工作台的清單是
// lib/decide/project.ts 從來源投影出來的。三種來源的狀態欄位各不相同，所以「再次討論中」不塞進每個來源，
// 而是集中記在這張對照表（key 是工作台項目的 key，例如 collect:<itemId>:<proposalId>）：
//   - conversationId：來源沒記對話時（例如收集頁拆出來的），再次討論時開的那段對話記在這裡
//   - discussion：再次討論的說明與時間；有這一筆就是「再次討論中」，不在工作台清單裡，但仍算待決定
//   - supersededBy：指揮官修改後重新提出的新提案 key；被取代的舊提案不再算待決定
// 來源建立提案時能知道對話的，直接記在來源上（Proposal.conversationId、AgentTask.conversationId）。

export const PROPOSAL_TRAIL_KEY = 'proposalTrail'
/** 超過幾天沒決定就列進每週回顧（不會自動消失）。 */
export const PROPOSAL_STALE_DAYS = 14
export const DAY_MS = 86_400_000
export const MAX_DISCUSSION_NOTE = 500

/** wait：等 Scott 接受或放棄；discussing：再次討論中，等指揮官修改後重新提案。兩者都算「待決定」。 */
export type ProposalStatus = 'wait' | 'discussing'

export interface ProposalDiscussion {
  note: string
  at: number
}

export interface ProposalTrailEntry {
  conversationId?: number
  discussion?: ProposalDiscussion
  supersededBy?: string
}

export type ProposalTrail = Record<string, ProposalTrailEntry>

/** 去頭尾空白、截到上限；全空回傳空字串（再次討論一定要附說明）。 */
export function normalizeDiscussionNote(note: string): string {
  return Array.from(note.trim()).slice(0, MAX_DISCUSSION_NOTE).join('').trim()
}

/** 再次討論：記下說明與回到的對話。說明是空的就不動（回傳原物件）。 */
export function startDiscussion(
  trail: ProposalTrail,
  key: string,
  input: { note: string, conversationId: number, at: number },
): ProposalTrail {
  const note = normalizeDiscussionNote(input.note)
  if (!note) return trail
  return { ...trail, [key]: { ...trail[key], conversationId: input.conversationId, discussion: { note, at: input.at } } }
}

/** 指揮官修改後重新提案：舊提案標成被取代。自己取代自己不算。 */
export function supersede(trail: ProposalTrail, oldKey: string, newKey: string): ProposalTrail {
  if (!oldKey || !newKey || oldKey === newKey || trail[oldKey]?.supersededBy === newKey) return trail
  return { ...trail, [oldKey]: { ...trail[oldKey], supersededBy: newKey } }
}

export function statusOf(trail: ProposalTrail | undefined, key: string): ProposalStatus {
  return trail?.[key]?.discussion ? 'discussing' : 'wait'
}

/** 讀回 store.json 的值：型別不對的欄位丟掉。 */
export function sanitizeTrail(value: unknown): ProposalTrail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ProposalTrail = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const next: ProposalTrailEntry = {}
    if (typeof entry.conversationId === 'number' && Number.isInteger(entry.conversationId)) next.conversationId = entry.conversationId
    const discussion = entry.discussion as Record<string, unknown> | undefined
    if (discussion && typeof discussion.note === 'string' && typeof discussion.at === 'number') {
      const note = normalizeDiscussionNote(discussion.note)
      if (note) next.discussion = { note, at: discussion.at }
    }
    if (typeof entry.supersededBy === 'string' && entry.supersededBy) next.supersededBy = entry.supersededBy
    if (Object.keys(next).length) out[key] = next
  }
  return out
}

// —— 待決定的數量與 14 天規則 ——

export interface PendingProposalLike {
  key: string
  /** 提案進來（等 Scott 決定）的時間。 */
  at: number
  conversationId?: number
  status: ProposalStatus
}

/** 對話 id → 還有幾則提案待決定（等你接受或放棄的、再次討論中的都算）。對話本身不結案。 */
export function pendingCountByConversation(items: readonly PendingProposalLike[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const item of items) {
    if (item.conversationId === undefined) continue
    counts.set(item.conversationId, (counts.get(item.conversationId) ?? 0) + 1)
  }
  return counts
}

/**
 * 每週回顧要列的提案：進來超過 14 天還沒決定的，等最久的在前。
 * 只是挑出來給回顧問 Scott 要不要放棄，**不會**改任何狀態，提案照樣留在原處。
 */
export function staleProposals<T extends PendingProposalLike>(items: readonly T[], now: number, days = PROPOSAL_STALE_DAYS): T[] {
  const limit = days * DAY_MS
  return items
    .filter(item => now - item.at > limit)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.at - b.item.at || a.index - b.index)
    .map(entry => entry.item)
}

/** 等了幾天（無條件捨去）。 */
export function waitingDays(at: number, now: number): number {
  return Math.max(0, Math.floor((now - at) / DAY_MS))
}

// —— 儲存 ——

interface TrailStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

async function defaultStorage(): Promise<TrailStorage> {
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load('store.json')
}

export async function loadTrail(storage?: TrailStorage): Promise<ProposalTrail> {
  const store = storage ?? await defaultStorage()
  return sanitizeTrail(await store.get(PROPOSAL_TRAIL_KEY))
}

export async function saveTrail(trail: ProposalTrail, storage?: TrailStorage): Promise<void> {
  const store = storage ?? await defaultStorage()
  await store.set(PROPOSAL_TRAIL_KEY, trail)
  await store.save()
}

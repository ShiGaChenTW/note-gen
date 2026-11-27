// Fork（almanac ALMNC-54.4）：對話的三種標籤——查詢（專家，只讀）、處理（有指揮官，透過提案改）、日程（秘書，Scott 交代的直接生效）。
// 規格見 almanac/2026-11-19_proposal_role-data-model.md 第三節「對話」。這裡全是純函式，加上存 store.json 的對照表。
// 存法同專案分組（projects.ts）：conversations 表不加欄位，用 store.json 的 threadTags：{ 對話 key: 標籤 }，
// key 用 threadKey（syncId，沒有就 `id:<id>`）。對照表裡沒有的舊對話一律當「處理」：右側欄的 AI 就是指揮官，
// 舊對話都是和它談的，而且「處理」只會透過提案改資料，不會因為猜錯標籤而直接改到東西。
import type { AgentRole } from '@/lib/agents/settings'
import { notifyStoreKeyWritten } from '@/lib/almanac-sync/notify'
import type { Conversation } from '@/db/conversations'
import { threadKey } from './projects'

export const THREAD_TAGS = ['query', 'process', 'schedule'] as const
export type ThreadTag = typeof THREAD_TAGS[number]

export const THREAD_TAGS_KEY = 'threadTags'
/** 對照表裡沒有的對話（舊資料、還沒選對象的新對話）。 */
export const DEFAULT_THREAD_TAG: ThreadTag = 'process'

/** 對話 key → 標籤。只存不是預設值的也可以，但寫入時一律存，免得預設值之後改了舊對話跟著變。 */
export type ThreadTagMap = Record<string, ThreadTag>

export function isThreadTag(value: unknown): value is ThreadTag {
  return THREAD_TAGS.some(tag => tag === value)
}

/** 每個標籤的主要對象：查詢找專家、處理找指揮官、日程找秘書。 */
export const TAG_ROLE: Record<ThreadTag, AgentRole> = {
  query: 'expert',
  process: 'commander',
  schedule: 'secretary',
}

/**
 * 由參與的角色決定標籤（不含 Scott 本人）：
 * - 有指揮官 → 處理（包含 Scott、指揮官、專家三方）
 * - 只有秘書 → 日程
 * - 只有專家 → 查詢
 * - 其他（沒有人、專家和秘書混在一起但沒有指揮官）→ 預設「處理」：規格沒有這種對話，交給指揮官最保險。
 */
export function tagFromParticipants(roles: readonly AgentRole[]): ThreadTag {
  const set = new Set(roles)
  if (set.has('commander')) return 'process'
  if (set.has('secretary') && !set.has('expert')) return 'schedule'
  if (set.has('expert') && !set.has('secretary')) return 'query'
  return DEFAULT_THREAD_TAG
}

/** 把內容交給指揮官、或邀請指揮官加入。 */
export type CommanderJoin = 'handoff' | 'invite'

/**
 * 指揮官加入後（不論是把內容交給他、還是邀請他）的標籤：查詢、日程都變成處理（有指揮官就是處理），處理維持。
 * 同一段對話直接延續——這裡只換標籤，不開新對話。回傳 null 表示不用改。
 */
export function tagAfterCommanderJoins(tag: ThreadTag): ThreadTag | null {
  return tag === 'process' ? null : 'process'
}

/** 對話開始後還能不能換標籤：只能往「處理」升級，不能從處理退回只讀或日程。 */
export function canChangeTag(from: ThreadTag, to: ThreadTag, hasMessages: boolean): boolean {
  if (from === to) return false
  if (!hasMessages) return true
  return to === 'process'
}

export function tagOf(map: ThreadTagMap, conversation: Pick<Conversation, 'id' | 'syncId'>): ThreadTag {
  return map[threadKey(conversation)] ?? DEFAULT_THREAD_TAG
}

export function assignTag(map: ThreadTagMap, key: string, tag: ThreadTag): ThreadTagMap {
  if (map[key] === tag) return map
  return { ...map, [key]: tag }
}

/** 讀回 store.json 的值：不認得的標籤丟掉（之後就當預設）。 */
export function sanitizeTagMap(value: unknown): ThreadTagMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: ThreadTagMap = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isThreadTag(raw)) next[key] = raw
  }
  return next
}

/**
 * 新對話在第一則訊息送出前還沒有 id，先記下選好的標籤（draft），等對話建立後再補進對照表。
 * 只認「選標籤之後才建立、而且還沒有標籤」的對話，免得切到舊對話時誤套。
 */
export function claimDraftTag(
  conversations: readonly Pick<Conversation, 'id' | 'syncId' | 'createdAt'>[],
  currentId: number | null,
  draft: { tag: ThreadTag, at: number } | null,
  map: ThreadTagMap,
): { key: string, tag: ThreadTag } | null {
  if (!draft || currentId === null) return null
  const conversation = conversations.find(entry => entry.id === currentId)
  if (!conversation || conversation.createdAt < draft.at) return null
  const key = threadKey(conversation)
  if (map[key]) return null
  return { key, tag: draft.tag }
}

// —— 日程對話問到筆記或知識：秘書詢問是否轉給指揮官 ——

/** 筆記、知識相關的詞（繁中、簡中、英文）。只是提示，不會自動轉：判斷錯了 Scott 按「不用」就好。 */
const KNOWLEDGE_PATTERNS: readonly RegExp[] = [
  /筆記|笔记|知識|知识|領域|领域|資料源|资料源|摘要|整理成|寫進筆記庫|写进笔记库|筆記庫|笔记库/,
  /\b(notes?|knowledge|wiki|summar(y|ize|ise)|domain)\b/i,
]

/** 這句話是不是在問筆記或知識。 */
export function asksAboutKnowledge(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  return KNOWLEDGE_PATTERNS.some(pattern => pattern.test(value))
}

export interface ChatLike {
  id: number
  role: string
  type: string
  content?: string
}

/**
 * 日程對話裡，最後一則 Scott 的訊息問到筆記或知識時，回傳那則訊息的 id（秘書要在下面問要不要轉給指揮官）；
 * 不是日程對話、沒問到、或 Scott 已經回答過「不用」時回傳 null。
 */
export function transferSuggestion(tag: ThreadTag, chats: readonly ChatLike[], dismissed: ReadonlySet<number> = new Set()): number | null {
  if (tag !== 'schedule') return null
  for (let index = chats.length - 1; index >= 0; index--) {
    const chat = chats[index]
    if (chat.role !== 'user' || chat.type !== 'chat') continue
    if (dismissed.has(chat.id) || !asksAboutKnowledge(chat.content ?? '')) return null
    return chat.id
  }
  return null
}

// —— 儲存 ——

interface TagStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

async function defaultStorage(): Promise<TagStorage> {
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load('store.json')
}

export async function loadTagMap(storage?: TagStorage): Promise<ThreadTagMap> {
  try {
    const store = storage ?? await defaultStorage()
    return sanitizeTagMap(await store.get(THREAD_TAGS_KEY))
  } catch {
    return {}
  }
}

export async function saveTagMap(map: ThreadTagMap, storage?: TagStorage): Promise<boolean> {
  try {
    const store = storage ?? await defaultStorage()
    await store.set(THREAD_TAGS_KEY, map)
    await store.save()
    // Fork（almanac ALMNC-85.4）：帳號層級，寫入後排設定同步（設計 2.16）。
    if (!storage) notifyStoreKeyWritten(THREAD_TAGS_KEY)
    return true
  } catch {
    return false
  }
}

/** 保存路由選定的夥伴 id，名稱與啟用狀態由名單重新取得。 */
export async function threadRouteAgent(conversation: Pick<Conversation, 'id' | 'syncId'>, tag: ThreadTag, storage?: TagStorage): Promise<string | undefined> {
  const store = storage ?? await defaultStorage()
  const agentId = await store.get(`threadRouteAgent:${threadKey(conversation)}:${tag}`)
  return typeof agentId === 'string' ? agentId : undefined
}

export async function saveThreadRouteAgent(conversation: Pick<Conversation, 'id' | 'syncId'>, tag: ThreadTag, id: string, storage?: TagStorage): Promise<void> {
  const store = storage ?? await defaultStorage()
  const key = `threadRouteAgent:${threadKey(conversation)}:${tag}`
  if (await store.get(key) === id) return
  await store.set(key, id)
  await store.save()
}

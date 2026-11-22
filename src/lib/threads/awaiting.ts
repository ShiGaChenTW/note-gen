// Fork（almanac ALMNC-54.21）：「等你回話」——秘書在對話裡問 Scott、正在等他回答的問題（定案文件第四節「日程」：秘書的詢問）。
// 標記是明確的結構化資料，不從訊息文字猜：
// - 秘書這一輪以問句收尾時呼叫 schedule_await_reply（lib/commander/await-reply.ts），執行結束時記一筆；
// - 秘書用 ask_user_question 讓 Scott 選時，問題開著的期間記一筆，選完或取消就拿掉。
// Scott 在那段對話送出下一則訊息就算回話了，這一筆跟著拿掉。一段對話最多一筆（後問的蓋掉先問的）。
// 存在 store.json 的 awaitingReplies（同對話標籤），關掉 App 再開還在。純函式，方便測試。
import type { ReplyLike } from '@/lib/workbench/cards'

export const AWAITING_REPLIES_KEY = 'awaitingReplies'
/** 問題一行最多幾個字（卡片標題）。 */
export const AWAITING_QUESTION_MAX = 200

export interface AwaitingReply {
  conversationId: number
  /** 問題所在的那則訊息（AI 的回覆）。 */
  chatId: number
  /** 問 Scott 的問題，一行。 */
  question: string
  /** 誰在等（「Leo · 秘書」）。 */
  by?: string
  /** 問的時間；Scott 在這之後的訊息才算回話。 */
  at: number
  /** 選項（ask_user_question 的選項）；卡片上只顯示，選要回到對話裡選。 */
  choices?: string[]
  /** live＝ask_user_question 開著（執行還在等）；turn＝這一輪已結束，等 Scott 下一則訊息。 */
  via: 'turn' | 'live'
}

/** 對話 id → 等你回話。 */
export type AwaitingMap = Record<string, AwaitingReply>

function oneLine(text: string): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, AWAITING_QUESTION_MAX).join('')
}

/** 記一筆（同一段對話後問的蓋掉先問的）；問題是空的就不記。 */
export function markAwaiting(map: AwaitingMap, entry: AwaitingReply): AwaitingMap {
  const question = oneLine(entry.question)
  if (!question || !Number.isInteger(entry.conversationId) || entry.conversationId <= 0) return map
  const choices = entry.choices?.map(oneLine).filter(Boolean)
  return {
    ...map,
    [String(entry.conversationId)]: {
      conversationId: entry.conversationId,
      chatId: entry.chatId,
      question,
      ...(entry.by ? { by: entry.by } : {}),
      at: entry.at,
      ...(choices?.length ? { choices } : {}),
      via: entry.via,
    },
  }
}

/** 拿掉一段對話的等你回話；給 via 時只拿掉那一種（ask_user_question 結束時不要誤拿掉這一輪的問句）。 */
export function clearAwaiting(map: AwaitingMap, conversationId: number, via?: AwaitingReply['via']): AwaitingMap {
  const key = String(conversationId)
  const entry = map[key]
  if (!entry || (via && entry.via !== via)) return map
  const next = { ...map }
  delete next[key]
  return next
}

interface ChatLike {
  conversationId?: number
  role: string
  type: string
  createdAt: number
}

/** Scott 回話了的對話：同一段對話裡，有一則在問題之後送出的 Scott 訊息。 */
export function answeredConversations(map: AwaitingMap, chats: readonly ChatLike[]): number[] {
  const out = new Set<number>()
  for (const chat of chats) {
    if (chat.role !== 'user' || chat.type !== 'chat' || chat.conversationId === undefined) continue
    const entry = map[String(chat.conversationId)]
    if (entry && chat.createdAt > entry.at) out.add(entry.conversationId)
  }
  return [...out]
}

/** 拿掉已回話的。 */
export function dropAnswered(map: AwaitingMap, chats: readonly ChatLike[]): AwaitingMap {
  return answeredConversations(map, chats).reduce((next, id) => clearAwaiting(next, id), map)
}

/** 工作台的回話卡輸入。conversations 有讀到時，刪掉的對話不再列出。 */
export function awaitingToReplies(map: AwaitingMap, options: { summary: (entry: AwaitingReply) => string, conversations?: ReadonlyArray<{ id: number }> }): ReplyLike[] {
  const known = options.conversations?.length ? new Set(options.conversations.map(conversation => conversation.id)) : null
  return Object.values(map)
    .filter(entry => !known || known.has(entry.conversationId))
    .sort((a, b) => a.at - b.at)
    .map(entry => ({
      key: `reply:${entry.conversationId}`,
      title: entry.question,
      summary: options.summary(entry),
      ...(entry.by ? { by: entry.by } : {}),
      at: entry.at,
      conversationId: entry.conversationId,
      ...(entry.choices?.length ? { choices: entry.choices } : {}),
    }))
}

/** 讀檔後：型別不對的那筆丟掉。 */
export function sanitizeAwaiting(value: unknown): AwaitingMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  let map: AwaitingMap = {}
  for (const raw of Object.values(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    if (typeof entry.conversationId !== 'number' || typeof entry.chatId !== 'number' || typeof entry.question !== 'string' || typeof entry.at !== 'number') continue
    if (entry.via !== 'turn' && entry.via !== 'live') continue
    map = markAwaiting(map, {
      conversationId: entry.conversationId,
      chatId: entry.chatId,
      question: entry.question,
      at: entry.at,
      via: entry.via,
      ...(typeof entry.by === 'string' && entry.by ? { by: entry.by } : {}),
      ...(Array.isArray(entry.choices) ? { choices: entry.choices.filter((choice): choice is string => typeof choice === 'string') } : {}),
    })
  }
  return map
}

export interface AwaitingStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

async function defaultStorage(): Promise<AwaitingStorage> {
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load('store.json')
}

/** 讀回來時丟掉 live：App 重開後那次執行已經不在，選項卡也不能再選了。 */
export async function loadAwaiting(storage?: AwaitingStorage): Promise<AwaitingMap> {
  try {
    const store = storage ?? await defaultStorage()
    const map = sanitizeAwaiting(await store.get(AWAITING_REPLIES_KEY))
    return Object.fromEntries(Object.entries(map).filter(([, entry]) => entry.via !== 'live'))
  } catch {
    return {}
  }
}

export async function saveAwaiting(map: AwaitingMap, storage?: AwaitingStorage): Promise<boolean> {
  try {
    const store = storage ?? await defaultStorage()
    await store.set(AWAITING_REPLIES_KEY, map)
    await store.save()
    return true
  } catch {
    return false
  }
}

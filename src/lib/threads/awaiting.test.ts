// Fork（almanac ALMNC-54.21 AC#2）：「等你回話」——秘書在對話裡問 Scott 的問題出現在工作台，回話後消失。
import { describe, expect, it } from 'vitest'
import { buildReviewCards } from '@/lib/workbench/cards'
import {
  AWAITING_REPLIES_KEY, answeredConversations, awaitingToReplies, clearAwaiting, dropAnswered, loadAwaiting, markAwaiting, sanitizeAwaiting,
  saveAwaiting, type AwaitingMap, type AwaitingReply,
} from './awaiting'

const AT = Date.parse('2026-11-23T09:00:00')

function entry(over: Partial<AwaitingReply> = {}): AwaitingReply {
  return { conversationId: 7, chatId: 70, question: '跟 A 開會要排哪一天？', by: 'Leo · 秘書', at: AT, via: 'turn', ...over }
}

describe('awaiting replies', () => {
  it('marks one question per conversation (the later one wins) and ignores empty questions', () => {
    let map = markAwaiting({}, entry())
    map = markAwaiting(map, entry({ question: '  改成下午\n可以嗎？ ', at: AT + 1 }))
    expect(Object.values(map)).toEqual([{ ...entry(), question: '改成下午 可以嗎？', at: AT + 1 }])
    expect(markAwaiting(map, entry({ conversationId: 8, question: '   ' }))).toBe(map)
  })

  it('disappears once Scott sends a message in that conversation after the question', () => {
    const map = markAwaiting(markAwaiting({}, entry()), entry({ conversationId: 8, chatId: 80 }))
    const chats = [
      { conversationId: 7, role: 'user', type: 'chat', createdAt: AT - 1 }, // 問題之前的訊息不算
      { conversationId: 7, role: 'system', type: 'chat', createdAt: AT + 5 }, // AI 的訊息不算
      { conversationId: 8, role: 'user', type: 'chat', createdAt: AT + 10 },
    ]
    expect(answeredConversations(map, chats)).toEqual([8])
    expect(Object.keys(dropAnswered(map, chats))).toEqual(['7'])
    expect(dropAnswered(map, [])).toBe(map)
  })

  it('clears a live question (ask_user_question) without touching an end-of-turn question', () => {
    const live = markAwaiting({}, entry({ via: 'live', choices: ['週二', '週三'] }))
    expect(clearAwaiting(live, 7, 'live')).toEqual({})
    const turn = markAwaiting({}, entry())
    expect(clearAwaiting(turn, 7, 'live')).toBe(turn)
    expect(clearAwaiting(turn, 7)).toEqual({})
  })

  it('becomes 等你回話 cards that open the conversation, oldest first; deleted conversations are left out', () => {
    let map: AwaitingMap = markAwaiting({}, entry({ conversationId: 9, at: AT + 60_000 }))
    map = markAwaiting(map, entry({ choices: ['週二', '週三'], via: 'live' }))
    map = markAwaiting(map, entry({ conversationId: 404 }))
    const replies = awaitingToReplies(map, { conversations: [{ id: 7 }, { id: 9 }], summary: reply => `在「對話 ${reply.conversationId}」裡問你` })
    expect(replies.map(reply => reply.conversationId)).toEqual([7, 9])
    const cards = buildReviewCards({ now: AT + 3_600_000, proposals: [], replies, overdueTasks: [] })
    expect(cards[0]).toMatchObject({
      key: 'reply:7', kind: 'reply', group: 'reply', label: 'schedule', title: '跟 A 開會要排哪一天？', summary: '在「對話 7」裡問你',
      by: 'Leo · 秘書', conversationId: 7, choices: ['週二', '週三'], actions: ['pick', 'answer'],
    })
    expect(cards[1]).toMatchObject({ key: 'reply:9', actions: ['answer'] })
    // 對話列表還沒讀到時不過濾
    expect(awaitingToReplies(map, { summary: () => '' })).toHaveLength(3)
  })

  it('survives a restart (store.json) except live questions, and drops malformed entries', async () => {
    const saved = new Map<string, unknown>()
    const storage = { get: async (key: string) => saved.get(key), set: async (key: string, value: unknown) => { saved.set(key, value) }, save: async () => {} }
    const map = markAwaiting(markAwaiting({}, entry()), entry({ conversationId: 8, via: 'live' }))
    expect(await saveAwaiting(map, storage)).toBe(true)
    expect(saved.has(AWAITING_REPLIES_KEY)).toBe(true)
    expect(Object.keys(await loadAwaiting(storage))).toEqual(['7'])
    expect(sanitizeAwaiting({ a: { conversationId: 'x' }, b: entry({ conversationId: 3 }), c: { ...entry(), via: 'other' } })).toEqual({ 3: entry({ conversationId: 3 }) })
    expect(sanitizeAwaiting(null)).toEqual({})
  })
})

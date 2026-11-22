import { describe, expect, it } from 'vitest'
import {
  asksAboutKnowledge, assignTag, canChangeTag, claimDraftTag, DEFAULT_THREAD_TAG, loadTagMap, sanitizeTagMap, saveTagMap, saveThreadRouteAgent, threadRouteAgent,
  tagAfterCommanderJoins, tagFromParticipants, tagOf, transferSuggestion, THREAD_TAGS_KEY,
} from './tags'

describe('ALMNC-54.4 AC#1: tag from participants', () => {
  it('expert only is a read-only query', () => {
    expect(tagFromParticipants(['expert'])).toBe('query')
    expect(tagFromParticipants(['expert', 'expert'])).toBe('query')
  })
  it('any conversation with the commander is process, including three-way', () => {
    expect(tagFromParticipants(['commander'])).toBe('process')
    expect(tagFromParticipants(['commander', 'expert'])).toBe('process')
    expect(tagFromParticipants(['commander', 'secretary'])).toBe('process')
  })
  it('secretary only is schedule', () => {
    expect(tagFromParticipants(['secretary'])).toBe('schedule')
  })
  it('falls back to process for cases the spec does not define', () => {
    expect(tagFromParticipants([])).toBe('process')
    expect(tagFromParticipants(['expert', 'secretary'])).toBe('process')
    expect(DEFAULT_THREAD_TAG).toBe('process')
  })
})

describe('tag map', () => {
  it('treats conversations without a stored tag as process, keyed by syncId or id', () => {
    const map = { 'sync-a': 'query' as const, 'id:7': 'schedule' as const }
    expect(tagOf(map, { id: 1, syncId: 'sync-a' })).toBe('query')
    expect(tagOf(map, { id: 7, syncId: '' })).toBe('schedule')
    expect(tagOf(map, { id: 2, syncId: 'other' })).toBe('process')
  })
  it('assigns without mutating and returns the same map when nothing changes', () => {
    const map = { a: 'query' as const }
    const next = assignTag(map, 'a', 'process')
    expect(next).toEqual({ a: 'process' })
    expect(map).toEqual({ a: 'query' })
    expect(assignTag(next, 'a', 'process')).toBe(next)
  })
  it('drops unknown values when reading back', () => {
    expect(sanitizeTagMap({ a: 'query', b: 'bogus', c: 3 })).toEqual({ a: 'query' })
    expect(sanitizeTagMap(null)).toEqual({})
    expect(sanitizeTagMap(['query'])).toEqual({})
  })
  it('persists the selected partner for the same synced thread and tag only', async () => {
    const values = new Map<string, unknown>()
    const storage = { get: async (k: string) => values.get(k), set: async (k: string, v: unknown) => { values.set(k, v) }, save: async () => {} }
    await saveThreadRouteAgent({ id: 1, syncId: 'same-thread' }, 'query', 'expert-id', storage)
    expect(await threadRouteAgent({ id: 2, syncId: 'same-thread' }, 'query', storage)).toBe('expert-id')
    expect(await threadRouteAgent({ id: 2, syncId: 'same-thread' }, 'process', storage)).toBeUndefined()
    expect(await threadRouteAgent({ id: 1, syncId: 'different-thread' }, 'query', storage)).toBeUndefined()
  })
  it('loads and saves through store.json, tolerating failures', async () => {
    const values = new Map<string, unknown>()
    const storage = { get: async (k: string) => values.get(k), set: async (k: string, v: unknown) => { values.set(k, v) }, save: async () => {} }
    expect(await saveTagMap({ a: 'schedule' }, storage)).toBe(true)
    expect(values.get(THREAD_TAGS_KEY)).toEqual({ a: 'schedule' })
    expect(await loadTagMap(storage)).toEqual({ a: 'schedule' })
    const broken = { get: async () => { throw new Error('no tauri') }, set: async () => { throw new Error('x') }, save: async () => {} }
    expect(await loadTagMap(broken)).toEqual({})
    expect(await saveTagMap({}, broken)).toBe(false)
  })
})

describe('ALMNC-54.4 AC#2: query becomes process when the commander joins', () => {
  it('upgrades query and schedule, leaves process alone', () => {
    expect(tagAfterCommanderJoins('query')).toBe('process')
    expect(tagAfterCommanderJoins('schedule')).toBe('process')
    expect(tagAfterCommanderJoins('process')).toBeNull()
  })
  it('only allows upgrades to process once a conversation has messages', () => {
    expect(canChangeTag('query', 'process', true)).toBe(true)
    expect(canChangeTag('process', 'query', true)).toBe(false)
    expect(canChangeTag('schedule', 'query', true)).toBe(false)
    expect(canChangeTag('process', 'query', false)).toBe(true)
    expect(canChangeTag('query', 'query', false)).toBe(false)
  })
  it('claims a draft tag only for the conversation created after it was chosen', () => {
    const draft = { tag: 'query' as const, at: 100 }
    const conversations = [{ id: 1, syncId: 'old', createdAt: 50 }, { id: 2, syncId: 'new', createdAt: 120 }]
    expect(claimDraftTag(conversations, 2, draft, {})).toEqual({ key: 'new', tag: 'query' })
    expect(claimDraftTag(conversations, 1, draft, {})).toBeNull()
    expect(claimDraftTag(conversations, 2, draft, { new: 'schedule' })).toBeNull()
    expect(claimDraftTag(conversations, 2, null, {})).toBeNull()
    expect(claimDraftTag(conversations, null, draft, {})).toBeNull()
  })
})

describe('ALMNC-54.4 AC#3: schedule conversation asking about notes or knowledge', () => {
  it('detects notes and knowledge questions in zh-TW, zh and en', () => {
    expect(asksAboutKnowledge('上次會議的筆記放在哪？')).toBe(true)
    expect(asksAboutKnowledge('产线平衡的知识帮我整理')).toBe(true)
    expect(asksAboutKnowledge('Can you summarize my notes on OKRs?')).toBe(true)
    expect(asksAboutKnowledge('下週三下午幫我排跟 A 開會')).toBe(false)
    expect(asksAboutKnowledge('move my 3pm meeting')).toBe(false)
    expect(asksAboutKnowledge('   ')).toBe(false)
  })
  const chats = [
    { id: 1, role: 'user', type: 'chat', content: '明天十點排會議' },
    { id: 2, role: 'system', type: 'chat', content: '已新增：明天 10:00 會議' },
    { id: 3, role: 'user', type: 'chat', content: '那個專案的筆記寫到哪了？' },
    { id: 4, role: 'system', type: 'chat', content: '…' },
  ]
  it('asks on the latest user message in a schedule conversation only', () => {
    expect(transferSuggestion('schedule', chats)).toBe(3)
    expect(transferSuggestion('query', chats)).toBeNull()
    expect(transferSuggestion('process', chats)).toBeNull()
  })
  it('stops asking once dismissed or when the latest user message is about scheduling', () => {
    expect(transferSuggestion('schedule', chats, new Set([3]))).toBeNull()
    expect(transferSuggestion('schedule', [...chats, { id: 5, role: 'user', type: 'chat', content: '改到後天' }])).toBeNull()
    expect(transferSuggestion('schedule', [])).toBeNull()
  })
})

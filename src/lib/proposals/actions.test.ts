// Fork（almanac ALMNC-54.5 AC#2）：再次討論＝附說明，回到產生提案的那段對話（沒有就開一段「處理」對話）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { storeSet } = vi.hoisted(() => ({ storeSet: vi.fn() }))

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => undefined, set: storeSet, save: vi.fn() }) },
}))
vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({})) }
})

const useChatStore = (await import('@/stores/chat')).default
const useThreadsStore = (await import('@/stores/threads')).default
const useDecideStore = (await import('@/stores/decide')).default
const useProposalTrailStore = (await import('@/stores/proposals')).default
const { discussProposal, openConversation } = await import('./actions')

const conv = (id: number) => ({ id, syncId: `s${id}`, syncUpdatedAt: 0, title: `對話 ${id}`, createdAt: 1, updatedAt: 1, messageCount: 3, isPinned: false })
const format = (note: string) => `再次討論「寫提案」：${note}`

let chat: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  vi.clearAllMocks()
  chat = {
    initConversations: vi.fn(async () => {}),
    createConversation: vi.fn(async () => {
      useChatStore.setState({ currentConversationId: 50, conversations: [...useChatStore.getState().conversations, conv(50)] })
      return 50
    }),
    switchConversation: vi.fn(async (id: number) => { useChatStore.setState({ currentConversationId: id, chats: [{ id: 1 }] as never }) }),
    insert: vi.fn(async () => null),
  }
  useChatStore.setState({ conversations: [conv(7)], currentConversationId: null, chats: [], ...chat } as never, true)
  useThreadsStore.setState({ ...useThreadsStore.getInitialState() })
  useDecideStore.setState({ visible: true })
  useProposalTrailStore.setState({ trail: {} })
})

describe('discussProposal', () => {
  it('returns to the source conversation, records the note and posts it as Scott’s message', async () => {
    const id = await discussProposal({ key: 'collect:c1:p1', conversationId: 7 }, '  日期改到下週  ', format)
    expect(id).toBe(7)
    expect(useProposalTrailStore.getState().trail['collect:c1:p1']).toMatchObject({ conversationId: 7, discussion: { note: '日期改到下週' } })
    expect(useDecideStore.getState().visible).toBe(false)
    expect(useThreadsStore.getState().visible).toBe(true)
    expect(chat.switchConversation).toHaveBeenCalledWith(7)
    expect(chat.insert).toHaveBeenCalledWith({ role: 'user', type: 'chat', content: '再次討論「寫提案」：日期改到下週', inserted: false, conversationId: 7 })
    expect(chat.createConversation).not.toHaveBeenCalled()
  })

  it('does nothing without a note', async () => {
    expect(await discussProposal({ key: 'k', conversationId: 7 }, '   ', format)).toBeNull()
    expect(chat.insert).not.toHaveBeenCalled()
    expect(useProposalTrailStore.getState().trail).toEqual({})
  })

  it('opens a new conversation tagged 處理 when the proposal has no (or a deleted) source conversation', async () => {
    const id = await discussProposal({ key: 'collect:c2:p1' }, '拆成兩則', format)
    expect(id).toBe(50)
    expect(chat.createConversation).toHaveBeenCalledOnce()
    expect(useThreadsStore.getState().tagMap).toEqual({ s50: 'process' })
    expect(useProposalTrailStore.getState().trail['collect:c2:p1']?.conversationId).toBe(50)
    expect(chat.insert).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 50 }))

    vi.clearAllMocks()
    await discussProposal({ key: 'k', conversationId: 999 }, '再改', format)
    expect(chat.createConversation).toHaveBeenCalledOnce()
  })

  it('openConversation does not reload a conversation that is already open', async () => {
    useChatStore.setState({ currentConversationId: 7, chats: [{ id: 1 }] as never })
    await openConversation(7)
    expect(chat.switchConversation).not.toHaveBeenCalled()
    expect(useThreadsStore.getState().visible).toBe(true)
  })
})

describe('collect addProposals (ALMNC-54.5 AC#1)', () => {
  it('records the source conversation on proposals that do not carry one', async () => {
    const useCollectStore = (await import('@/stores/collect')).default
    const base = { kind: 'task' as const, body: '', due: '', time: '', tags: [] }
    useCollectStore.getState().addProposals('from-chat', '會議', [{ ...base, id: 'a', title: '甲' }, { ...base, id: 'b', title: '乙', conversationId: 3 }], { conversationId: 7 })
    const item = useCollectStore.getState().items.find(entry => entry.id === 'from-chat')!
    expect(item.proposals.map(p => [p.id, p.conversationId, p.status])).toEqual([['a', 7, 'wait'], ['b', 3, 'wait']])
  })
})

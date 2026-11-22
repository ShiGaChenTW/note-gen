// Fork（almanac ALMNC-54.5 AC#2）：再次討論＝附說明，回到產生提案的那段對話（沒有就開一段「處理」對話）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { storeSet, ask, agentPrompt, submitProposals } = vi.hoisted(() => ({
  storeSet: vi.fn(), ask: vi.fn(), agentPrompt: vi.fn(), submitProposals: vi.fn(),
}))

vi.mock('@/lib/commander/default-deps', () => ({
  createDefaultCommanderDeps: async () => ({
    ask, agentPrompt, submitProposals,
    roster: async () => [{ id: 'mia', name: 'Mia', role: 'commander', enabled: true }],
    labels: { origin: ({ source }: { source: string }) => `Mia · ${source}` },
  }),
}))

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
const useCollectStore = (await import('@/stores/collect')).default
const { projectProposals } = await import('@/lib/decide/project')
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
    insert: vi.fn(async (message: object) => ({ ...message, id: chat.insert.mock.calls.length + 10, createdAt: 0 })),
  }
  useChatStore.setState({ conversations: [conv(7)], currentConversationId: null, chats: [], ...chat } as never, true)
  useThreadsStore.setState({ ...useThreadsStore.getInitialState() })
  useDecideStore.setState({ visible: true })
  useProposalTrailStore.setState({ trail: {} })
  useCollectStore.setState({ items: [] })
  ask.mockResolvedValue('{"due":"2026-11-30"}')
  agentPrompt.mockResolvedValue('Mia commander instructions')
  submitProposals.mockImplementation(async (batch, options) => {
    useCollectStore.getState().addProposals(batch.id, batch.origin, batch.proposals, { recordId: options?.recordId })
  })
})

describe('discussProposal', () => {
  it('returns to the source conversation, records the note and posts it as Scott’s message', async () => {
    const id = await discussProposal({ key: 'thread-card:legacy', conversationId: 7 }, '  日期改到下週  ', format)
    expect(id).toBe(7)
    expect(useProposalTrailStore.getState().trail['thread-card:legacy']).toMatchObject({ conversationId: 7, discussion: { note: '日期改到下週' } })
    expect(useDecideStore.getState().visible).toBe(false)
    expect(useThreadsStore.getState().visible).toBe(true)
    expect(chat.switchConversation).toHaveBeenCalledWith(7)
    expect(chat.insert).toHaveBeenCalledWith({ role: 'user', type: 'chat', content: '再次討論「寫提案」：日期改到下週', inserted: false, conversationId: 7 })
    expect(chat.createConversation).not.toHaveBeenCalled()
  })

  it('revises the proposal in the source conversation and links both sides of the replacement', async () => {
    useCollectStore.getState().addProposals('c1', '會議', [{
      id: 'p1', kind: 'event', title: '寫提案', body: '', due: '2026-11-23', time: '10:00',
      tags: [], conversationId: 7, sourceIds: ['source-1'],
    }], { recordId: 31 })
    const key = 'collect:c1:p1'
    await discussProposal({ key, conversationId: 7 }, '日期改到下週', format)

    expect(agentPrompt).toHaveBeenCalledWith(expect.objectContaining({ id: 'mia' }), 'commander')
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('日期改到下週'))
    expect(chat.insert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      role: 'user', content: '再次討論「寫提案」：日期改到下週', conversationId: 7,
    }))
    expect(chat.insert).toHaveBeenNthCalledWith(2, expect.objectContaining({ role: 'system', conversationId: 7 }))
    const [{ id, recordId, proposals: [revised] }] = useCollectStore.getState().items
    expect(revised).toMatchObject({
      due: '2026-11-30', time: '10:00', sourceIds: ['source-1'], conversationId: 7, previousProposalId: key, status: 'wait',
    })
    expect(recordId).toBe(31)
    const revisedKey = `collect:${id}:${revised.id}`
    const trail = useProposalTrailStore.getState().trail
    expect(trail[key]).toMatchObject({ conversationId: 7, discussion: { note: '日期改到下週' }, supersededBy: revisedKey })
    expect(projectProposals({ items: useCollectStore.getState().items, tasks: [], journal: null, trail }).map(item => item.key)).toEqual([revisedKey])
    expect(useThreadsStore.getState().cards[12]?.[0]).toMatchObject({ title: '寫提案', due: '2026-11-30', status: 'wait' })
    const collect = useCollectStore.getState()
    await expect(collect.accept('c1', 'p1')).rejects.toThrow()
    collect.reject('c1', 'p1')
    expect(useCollectStore.getState().items.find(item => item.id === 'c1')?.proposals[0].status).toBe('wait')
  })

  it('keeps the note and restores the original proposal when the commander produces no valid revision', async () => {
    useCollectStore.getState().addProposals('c1', '會議', [{
      id: 'p1', kind: 'task', title: '寫提案', body: '', due: '2026-11-23', time: '', tags: [], conversationId: 7,
    }])
    ask.mockResolvedValueOnce('{"due":"yesterday"}')
    await expect(discussProposal({ key: 'collect:c1:p1', conversationId: 7 }, '改日期', format)).rejects.toThrow()
    expect(chat.insert).toHaveBeenCalledOnce()
    expect(submitProposals).not.toHaveBeenCalled()
    const trail = useProposalTrailStore.getState().trail
    expect(projectProposals({ items: useCollectStore.getState().items, tasks: [], journal: null, trail })[0]?.status).toBe('wait')
  })

  it('ignores a second submission while a revision of the same proposal is running', async () => {
    useCollectStore.getState().addProposals('c1', '會議', [{
      id: 'p1', kind: 'task', title: '寫提案', body: '', due: '2026-11-23', time: '', tags: [], conversationId: 7,
    }])
    const target = { key: 'collect:c1:p1', conversationId: 7 }
    const first = discussProposal(target, '日期改到下週', format)
    expect(await discussProposal(target, '重複送出的說明', format)).toBeNull()
    await expect(first).resolves.toBe(7)
    expect(ask).toHaveBeenCalledOnce()
    expect(submitProposals).toHaveBeenCalledOnce()
    expect(chat.insert.mock.calls.map(([message]) => message.role)).toEqual(['user', 'system'])
  })

  it('does not supersede the original or announce a revision if saving fails', async () => {
    useCollectStore.getState().addProposals('c1', '會議', [{
      id: 'p1', kind: 'task', title: '寫提案', body: '', due: '2026-11-23', time: '', tags: [], conversationId: 7,
    }])
    submitProposals.mockRejectedValueOnce(new Error('Store unavailable'))
    const key = 'collect:c1:p1'
    await expect(discussProposal({ key, conversationId: 7 }, '日期改到下週', format)).rejects.toThrow('Store unavailable')
    expect(chat.insert).toHaveBeenCalledOnce()
    expect(useProposalTrailStore.getState().trail[key]).toEqual({ conversationId: 7 })
  })

  it('does nothing without a note', async () => {
    expect(await discussProposal({ key: 'k', conversationId: 7 }, '   ', format)).toBeNull()
    expect(chat.insert).not.toHaveBeenCalled()
    expect(useProposalTrailStore.getState().trail).toEqual({})
  })

  it('opens a new conversation tagged 處理 when the proposal has no (or a deleted) source conversation', async () => {
    const id = await discussProposal({ key: 'thread-card:legacy' }, '拆成兩則', format)
    expect(id).toBe(50)
    expect(chat.createConversation).toHaveBeenCalledOnce()
    expect(useThreadsStore.getState().tagMap).toEqual({ s50: 'process' })
    expect(useProposalTrailStore.getState().trail['thread-card:legacy']?.conversationId).toBe(50)
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

// Fork（almanac ALMNC-91）：專家遇到需要外部資料的問題時，在那則回答下面問 Scott 要不要轉給指揮官。
// AI 的判斷用固定回應：模擬專家這一輪呼叫 expert_suggest_commander（真的工具、真的 store），不打 AI。
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import { renderV3, screen } from '@/test/render-v3'
import { agentToolRegistry } from '@/lib/agent/tool-registry'
import emitter from '@/lib/emitter'
import { prepareSidebarCommanderRun, type SidebarRunDeps } from '@/lib/commander/sidebar-session'
import { EXPERT_HANDOFF_TOOL_NAME } from '@/lib/threads/expert-handoff'
import useThreadsStore from '@/stores/threads'
import type { Chat } from '@/db/chats'

const { storeSet } = vi.hoisted(() => ({ storeSet: vi.fn() }))

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => undefined, set: storeSet, save: vi.fn() }) },
}))
vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({ chats: [], conversations: [], currentConversationId: null, isTemporaryConversation: false })),
  }
})

const useChatStore = (await import('@/stores/chat')).default
const { ExpertHandoffPrompt } = await import('./expert-handoff')

const QUESTION = '今天美元兌台幣的匯率是多少？'
const EXPERT = { id: 'e-1', name: 'Alex', role: 'expert' as const, domain: '財務', enabled: true }
const t = zhTW.threads.tag

function conversation(id: number) {
  return { id, syncId: `s${id}`, syncUpdatedAt: 0, title: '匯率', createdAt: 1, updatedAt: 1, messageCount: 2, isPinned: false }
}

/** 專家以只讀身分回答 chatId 這一輪；fixedCall 是 AI 的固定回應（有給就代表專家判斷需要外部資料、呼叫了工具）。 */
async function expertTurn(chatId: number, fixedCall?: { reason: string }) {
  const deps: SidebarRunDeps = {
    roster: async () => [{ id: 'c-1', name: 'Mia', role: 'commander', enabled: true }, EXPERT],
    memoryPrompt: async () => '',
    readFile: async () => null,
    writeSchedule: vi.fn(),
    submitProposals: vi.fn(async () => {}),
    attachCard: vi.fn(),
    attachDirectEdit: vi.fn(),
    logActivity: vi.fn(async () => {}),
    roleLabel: key => key,
    originLabel: agent => agent,
    suggestCommander: id => useThreadsStore.getState().flagExpertHandoff(id),
    now: () => new Date(2026, 10, 27),
  }
  const run = await prepareSidebarCommanderRun({ conversationId: 1, chatId, scottMessages: [QUESTION], readOnly: true, answerAs: EXPERT }, deps)
  if (!fixedCall) return
  const tool = run.transformTools(agentToolRegistry.listTools()).find(entry => entry.name === EXPERT_HANDOFF_TOOL_NAME)!
  await act(async () => { await tool.execute(fixedCall, { runId: 'test', context: { userInput: QUESTION } } as never) })
}

const chats: Chat[] = [
  { id: 10, role: 'user', type: 'chat', content: QUESTION, conversationId: 1, inserted: false, createdAt: 0 },
  { id: 11, role: 'system', type: 'chat', content: '筆記庫裡沒有匯率資料。', conversationId: 1, inserted: false, createdAt: 1 },
]

let sent: string[]
const onSend = (prompt: string) => { sent.push(prompt) }

beforeEach(() => {
  sent = []
  emitter.on('quick-prompt-send', onSend)
  useThreadsStore.setState({ ...useThreadsStore.getInitialState(), tagMap: { s1: 'query' }, loadProjects: vi.fn(async () => {}) })
  useChatStore.setState({ chats, conversations: [conversation(1)], currentConversationId: 1, isTemporaryConversation: false })
})

afterEach(() => {
  emitter.off('quick-prompt-send', onSend)
})

describe('ALMNC-91 AC#1: 專家判斷需要外部資料時，在回答下面問要不要轉給指揮官', () => {
  it('專家呼叫 expert_suggest_commander 後，回答下面出現提示與兩個按鈕', async () => {
    renderV3(<ExpertHandoffPrompt chatId={11} />)
    expect(screen.queryByText(t.expertAsk)).not.toBeInTheDocument()

    await expertTurn(11, { reason: '需要今天的即時匯率' })
    expect(screen.getByRole('status')).toHaveTextContent(t.expertAsk)
    expect(screen.getByRole('button', { name: t.transfer })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.keep })).toBeInTheDocument()
  })

  it('專家沒判斷需要外部資料（AI 沒呼叫工具）就不問', async () => {
    await expertTurn(11)
    renderV3(<ExpertHandoffPrompt chatId={11} />)
    expect(screen.queryByText(t.expertAsk)).not.toBeInTheDocument()
  })

  it('不是查詢對話（已經是處理）就不問', async () => {
    await expertTurn(11, { reason: '需要即時匯率' })
    useThreadsStore.setState({ tagMap: { s1: 'process' } })
    renderV3(<ExpertHandoffPrompt chatId={11} />)
    expect(screen.queryByText(t.expertAsk)).not.toBeInTheDocument()
  })
})

describe('ALMNC-91 AC#2、AC#3: Scott 同意才轉，轉交時帶上原問題；拒絕後同一則訊息不再問', () => {
  it('提示出現時還沒轉；按「轉給指揮官」才改成處理，並把原問題送給指揮官', async () => {
    await expertTurn(11, { reason: '需要即時匯率' })
    const { user } = renderV3(<ExpertHandoffPrompt chatId={11} />)
    expect(useThreadsStore.getState().tagMap.s1).toBe('query')
    expect(sent).toEqual([])

    await user.click(screen.getByRole('button', { name: t.transfer }))
    expect(useThreadsStore.getState().tagMap.s1).toBe('process')
    expect(storeSet).toHaveBeenCalledWith('threadTags', { s1: 'process' })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain(QUESTION)
    expect(screen.queryByText(t.expertAsk)).not.toBeInTheDocument()
  })

  it('按「不用」：不轉、不送，同一則回答即使專家再判斷一次也不再問', async () => {
    await expertTurn(11, { reason: '需要即時匯率' })
    const { user, unmount } = renderV3(<ExpertHandoffPrompt chatId={11} />)
    await user.click(screen.getByRole('button', { name: t.keep }))
    expect(screen.queryByText(t.expertAsk)).not.toBeInTheDocument()
    expect(useThreadsStore.getState().tagMap.s1).toBe('query')
    expect(sent).toEqual([])

    await expertTurn(11, { reason: '還是需要即時匯率' })
    unmount()
    renderV3(<ExpertHandoffPrompt chatId={11} />)
    expect(screen.queryByText(t.expertAsk)).not.toBeInTheDocument()
  })
})

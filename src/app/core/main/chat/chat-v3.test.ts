// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentState, AgentTraceEvent } from '@/lib/agent/types'
import type { Chat } from '@/db/chats'
import messages from '../../../../../messages/zh-TW.json'
import emitter from '@/lib/emitter'
import { ChatV3Context, isChatModeShortcut } from './chat-v3'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return {
    default: create((set) => ({
      chats: [],
      conversations: [],
      currentConversationId: 1,
      isTemporaryConversation: false,
      loading: false,
      agentState: {},
      setAgentState: (partial: Partial<AgentState>) => set((state: { agentState: AgentState }) => ({
        agentState: { ...state.agentState, ...partial },
      })),
    })),
  }
})
vi.mock('@/stores/setting', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ language: 'zh-TW', agentPermissionMode: 'ask', workspacePath: '/fixture' })) }
})
vi.mock('./chat-preview', () => ({ default: () => null }))
vi.mock('./agent-context-tray', () => ({ AgentContextTray: () => null }))
vi.mock('./agent-change-list', () => ({ AgentChangeList: () => null }))
vi.mock('@/components/chat-ui/chat-ui-messages', () => ({ ChatUiMessages: () => null }))
vi.mock('@/lib/agent/debug-log', () => ({ agentDebugLog: () => {} }))
// Fork（almanac ALMNC-54.7）：右側欄 AI 的名字來自 Agent 設定的名單。
vi.mock('@/db/agents', () => ({
  ensureDefaultRoster: async () => false,
  listAgentSettings: async () => [{ id: 'c-1', name: 'Mia', role: 'commander', enabled: true }, { id: 's-1', name: 'Leo', role: 'secretary', enabled: true }],
}))

const { default: useChatStore } = await import('@/stores/chat')
const { default: useSettingStore } = await import('@/stores/setting')
const { default: ChatEmpty } = await import('./chat-empty')
const { AgentRunTimeline } = await import('./agent-run-timeline')
const { PendingAgentReview } = await import('./pending-agent-review')
const { ChatModeSwitch } = await import('./agent-permission-mode')
const { CommanderSpeaker } = await import('./commander-name')

const user: Chat = { id: 11, createdAt: 20, role: 'user', type: 'chat', inserted: false, content: '整理日誌', conversationId: 1 }
const assistant: Chat = { id: 12, createdAt: 21, role: 'system', type: 'chat', inserted: false, conversationId: 1 }
const step: AgentTraceEvent = {
  runId: 'run', id: 'read', timestamp: 21, type: 'tool_result', status: 'success',
  title: '讀取日誌', input: { filePath: 'daily.md' }, output: { data: '原本的內容' },
}
const update: AgentTraceEvent = {
  runId: 'run', id: 'update', timestamp: 22, type: 'approval', status: 'running',
  title: '修改日誌', toolName: 'note_update_file',
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useSettingStore.setState({ agentPermissionMode: 'ask' })
  useChatStore.setState({
    chats: [user, assistant],
    currentConversationId: 1,
    isTemporaryConversation: false,
    agentState: { activeChatId: assistant.id, confirmationHistory: [] } as unknown as AgentState,
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(node: ReactNode, v3 = true) {
  act(() => root.render(h(NextIntlClientProvider, {
    locale: 'zh-TW',
    messages,
    timeZone: 'Asia/Taipei',
    children: h(ChatV3Context.Provider, { value: v3 }, node),
  })))
}

function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(element => element.textContent?.includes(label))
  expect(button, label).toBeDefined()
  act(() => button?.click())
}

describe('v3 chat', () => {
  it('switches modes via unmodified Tab while leaving IME, menus and Shift-Tab alone', () => {
    const isShortcut = (key: string, { menu = false, composing = false, ...native }: {
      menu?: boolean; composing?: boolean; isComposing?: boolean; shiftKey?: boolean; keyCode?: number
    } = {}) => {
      const event = new KeyboardEvent('keydown', { key, ...native })
      return isChatModeShortcut({
        key: event.key, shiftKey: event.shiftKey, keyCode: native.keyCode ?? event.keyCode, nativeEvent: event,
      } as Parameters<typeof isChatModeShortcut>[0], menu, composing)
    }
    expect(isShortcut('Tab')).toBe(true)
    expect(isShortcut('Tab', { menu: true })).toBe(false)
    expect(isShortcut('Tab', { composing: true })).toBe(false)
    expect(isShortcut('Tab', { isComposing: true })).toBe(false)
    expect(isShortcut('Tab', { keyCode: 229 })).toBe(false)
    expect(isShortcut('Tab', { shiftKey: true })).toBe(false)
    expect(isShortcut('Enter')).toBe(false)
  })

  it('exposes an accessible mode switch and disables it during a run', () => {
    const onChange = vi.fn()
    render(h(ChatModeSwitch, { readOnly: true, onChange, disabled: false }))
    expect(container.querySelector('[aria-pressed=true]')?.textContent).toBe('問')
    click('處理')
    expect(onChange).toHaveBeenCalledWith(false)
    render(h(ChatModeSwitch, { readOnly: false, onChange, disabled: true }))
    expect(container.querySelector('[aria-pressed=true]')?.textContent).toBe('處理')
    click('問')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  // Fork（almanac ALMNC-54.7）
  it('introduces the right sidebar AI as the commander by name', async () => {
    render(h(ChatEmpty))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.textContent).toContain('Mia · 指揮官：改動筆記會先變成提案')
    render(h(CommanderSpeaker))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.querySelector('[data-slot=commander-speaker]')?.textContent).toBe('Mia · 指揮官')
  })

  it('inserts a localized draft in either mode and includes the temporary-chat hint', () => {
    const insert = vi.fn()
    const send = vi.fn()
    emitter.on('quick-prompt-insert', insert)
    emitter.on('quick-prompt-send', send)
    try {
      render(h(ChatEmpty))
      click('整理這篇的重點')
      act(() => {
        useSettingStore.setState({ agentPermissionMode: 'read-only' })
        useChatStore.setState({ isTemporaryConversation: true })
      })
      click('這篇還有什麼沒做完？')
      expect(insert.mock.calls).toEqual([['把這篇筆記整理成重點'], ['這篇還有什麼沒做完？']])
      expect(send).not.toHaveBeenCalled()
      expect(container.textContent).toContain('這段臨時對話會自動清除')
      render(h(ChatEmpty), false)
      expect(container.textContent).not.toContain('問我任何事')
    } finally {
      emitter.off('quick-prompt-insert', insert)
      emitter.off('quick-prompt-send', send)
    }
  })

  it('collapses finished steps and keeps tool details available', () => {
    render(h(AgentRunTimeline, { chat: assistant, status: 'completed', traceEvents: [step] }))
    expect(container.querySelector('h3')?.textContent).toBe('整理日誌')
    expect(container.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('100')
    expect(container.textContent).not.toContain('讀取日誌')
    click('看 1 個步驟')
    click('讀取日誌')
    expect(container.textContent).toContain('原本的內容')
    render(h(AgentRunTimeline, { chat: assistant, status: 'completed', traceEvents: [step] }), false)
    expect(container.querySelector('[role=progressbar]')).toBeNull()
  })

  it('keeps exactly one actionable confirmation outside the timeline and expands the existing diff', () => {
    useChatStore.setState({ agentState: {
      ...useChatStore.getState().agentState,
      isRunning: true,
      runId: 'run',
      pendingConfirmation: {
        id: 'approval', runId: 'run', chatId: assistant.id, conversationId: 1, traceEventId: 'update',
        workspacePath: '/fixture', toolName: 'note_update_file', params: {}, kind: 'file',
        filePath: 'journal/daily.md', originalContent: 'old\n', modifiedContent: 'new\n',
      },
    } })
    render(h('main', null,
      h('article', null, h(AgentRunTimeline, {
        chat: assistant, status: 'waiting_approval', isRunning: true, traceEvents: [step, update],
      })),
      h(PendingAgentReview),
      h('footer', null, h('textarea')),
    ))
    expect(container.querySelector('article')?.textContent).toContain('等你確認')
    expect(container.querySelector('article')?.textContent).not.toContain('可以，套用')
    expect(container.querySelector('footer')?.previousElementSibling?.textContent).toContain('要改 daily.md，可以嗎？')
    expect(container.textContent).toContain('+1−1')
    click('看改動')
    expect(Array.from(container.querySelectorAll('code')).map(code => code.textContent)).toEqual([
      expect.stringContaining('old'), expect.stringContaining('new'),
    ])
    click('可以，套用')
    expect(useChatStore.getState().agentState.confirmationHistory.at(-1)).toMatchObject({ id: 'approval', status: 'confirmed', scope: 'once' })
    expect(container.textContent).not.toContain('可以，套用')
  })

  it('places agent questions in the same review dock and returns the selected answer', () => {
    const scrollTo = HTMLElement.prototype.scrollTo
    HTMLElement.prototype.scrollTo = vi.fn()
    try {
      const question = { question: '選哪一天？', multiSelect: false, options: [{ label: '今天' }, { label: '明天' }] }
      useChatStore.setState({ agentState: {
        ...useChatStore.getState().agentState,
        isRunning: true,
        pendingQuestion: { id: 'question', conversationId: 1, chatId: assistant.id, questions: [question] },
      } })
      render(h(PendingAgentReview))
      expect(container.textContent).toContain('選哪一天？')
      click('今天')
      expect(useChatStore.getState().agentState.pendingQuestion?.response).toEqual([
        { question: '選哪一天？', selected: ['今天'] },
      ])
      expect(container.textContent).not.toContain('選哪一天？')
    } finally {
      HTMLElement.prototype.scrollTo = scrollTo
    }
  })

  it('expands batch targets and removes the action when the owning conversation changes', () => {
    useChatStore.setState({ agentState: {
      ...useChatStore.getState().agentState,
      isRunning: true,
      pendingConfirmation: {
        id: 'batch', chatId: assistant.id, conversationId: 1,
        toolName: 'delete_markdown_files_batch', params: { filePaths: ['one.md', 'two.md'] },
      },
    } })
    render(h(PendingAgentReview))
    expect(container.textContent).toContain('要改 2 個檔案')
    click('看檔案清單')
    expect(Array.from(container.querySelectorAll('li')).map(item => item.textContent)).toEqual(['one.md', 'two.md'])
    act(() => useChatStore.setState({ currentConversationId: 2 }))
    expect(container.textContent).not.toContain('可以，套用')
  })
})

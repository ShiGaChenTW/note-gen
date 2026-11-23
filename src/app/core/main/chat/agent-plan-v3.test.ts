// @vitest-environment jsdom
// Fork（almanac ALMNC-75）：V3 對話欄的步驟清單（任務卡）——即時狀態、空清單、重開對話紀錄。
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentState, AgentTraceEvent, ToolCall } from '@/lib/agent/types'
import type { Chat } from '@/db/chats'
import messages from '../../../../../messages/zh-TW.json'
import { ChatV3Context } from './chat-v3'
import { retainCompletedAgentTraceEvents } from '@/lib/agent/trace-retention'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({
      chats: [],
      conversations: [],
      currentConversationId: 1,
      isTemporaryConversation: false,
      loading: false,
      agentState: {},
    })),
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/core/main',
}))
// AgentPanelWithRag 開啟來源用的 store 與導覽，這裡用不到。
vi.mock('@/stores/sidebar', () => ({ useSidebarStore: { getState: () => ({}) } }))
vi.mock('@/stores/article', () => ({ default: () => ({ setActiveFilePath: () => {} }) }))
vi.mock('@/stores/canvas', () => ({ default: { getState: () => ({}) } }))
vi.mock('@/stores/mark', () => ({ default: { getState: () => ({}) } }))
vi.mock('@/stores/tag', () => ({ default: { getState: () => ({}) } }))
vi.mock('@/lib/inbox/actions', () => ({ openRecordInInbox: async () => {} }))
vi.mock('@/app/core/main/canvas/canvas-tab', () => ({ createCanvasTab: () => ({}) }))
vi.mock('@/components/wiki/use-wiki-navigation', () => ({ useWikiNavigation: () => ({ openPage: () => {} }) }))
vi.mock('./chat-preview', () => ({ default: () => null }))
vi.mock('./agent-context-tray', () => ({ AgentContextTray: () => null }))
vi.mock('./agent-change-list', () => ({ AgentChangeList: () => null }))
vi.mock('@/components/chat-ui/chat-ui-messages', () => ({ ChatUiMessages: () => null }))
vi.mock('@/lib/agent/debug-log', () => ({ agentDebugLog: () => {} }))

const { default: useChatStore } = await import('@/stores/chat')
const { AgentRunTimeline } = await import('./agent-run-timeline')
const { AgentExecutionStatus } = await import('./agent-execution-status')
const { AgentPanelWithRag } = await import('./agent-panel-with-rag')

const user: Chat = { id: 31, createdAt: 20, role: 'user', type: 'chat', inserted: false, content: '整理三篇日誌', conversationId: 1 }
const assistant: Chat = { id: 32, createdAt: 21, role: 'system', type: 'chat', inserted: false, conversationId: 1 }

// 一輪模型一次選了三個工具；runtime 只在工具開始時才建 trace event。
const modelRound: AgentTraceEvent = {
  runId: 'run', id: 'model-1', timestamp: 21, duration: 5, type: 'model_response', status: 'success',
  title: '模型选择工具', isIntermediateResponse: false,
  output: {
    finishReason: 'tool_calls',
    toolCalls: [
      { id: 'call-a', name: 'read_markdown_file', argumentsPreview: '{"filePath":"a.md","_display_title":"讀 A 日誌"}' },
      { id: 'call-b', name: 'read_markdown_file', argumentsPreview: '{"filePath":"b.md","_display_title":"讀 B 日誌"}' },
      // 參數預覽被截斷時仍取得顯示標題。
      { id: 'call-c', name: 'update_markdown_file', argumentsPreview: '{"_display_title":"寫回 C 日誌","content":"很長的內容…' },
    ],
  },
}
const toolEvent = (id: string, title: string, status: AgentTraceEvent['status']): AgentTraceEvent => ({
  runId: 'run', id: `trace-${id}`, timestamp: 30, type: 'tool_call', status, title, displayTitle: title,
  toolName: id === 'c' ? 'update_markdown_file' : 'read_markdown_file', ...(status === 'running' ? {} : { duration: 3 }),
})
const toolCall = (id: string, status: ToolCall['status']): ToolCall => ({
  id: `call-${id}`, toolName: 'read_markdown_file', params: {}, status, timestamp: 30,
})

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useChatStore.setState({ chats: [user, assistant], loading: false, agentState: {} as AgentState })
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

function setLive(traceEvents: AgentTraceEvent[], toolCalls: ToolCall[], partial: Partial<AgentState> = {}) {
  act(() => useChatStore.setState({ agentState: {
    activeChatId: assistant.id, isRunning: true, status: 'calling_tool', traceEvents, toolCalls,
    confirmationHistory: [], ...partial,
  } as unknown as AgentState }))
}

/** 每一步的「名稱：狀態」，狀態取自 V3 步驟方塊的 aria-label。 */
function steps() {
  return Array.from(container.querySelectorAll('[role=list] > [role=listitem]')).map(item => {
    const name = item.querySelector('.agent-tool-title')?.textContent
    const state = item.querySelector('[role=img]')?.getAttribute('aria-label')
    return `${name}：${state}`
  })
}

function statusText() {
  return container.querySelector('h3 + [role=status]')?.textContent
}

function buttonLabels() {
  return Array.from(container.querySelectorAll('button')).map(button => button.textContent)
}

describe('V3 步驟清單（ALMNC-75）', () => {
  it('執行中列出整輪的步驟，狀態隨執行即時更新（待辦／進行中／完成／失敗）', () => {
    render(h(AgentExecutionStatus, { chat: assistant }))

    setLive([modelRound, toolEvent('a', '讀 A 日誌', 'running')], [toolCall('a', 'running')])
    expect(steps()).toEqual([
      '讀 A 日誌：進行中',
      '讀 B 日誌：尚未開始',
      '寫回 C 日誌：尚未開始',
    ])
    expect(statusText()).toBe('執行中 0/3')

    setLive(
      [modelRound, toolEvent('a', '讀 A 日誌', 'success'), toolEvent('b', '讀 B 日誌', 'running')],
      [toolCall('a', 'success'), toolCall('b', 'running')],
    )
    expect(steps()).toEqual(['讀 A 日誌：完成', '讀 B 日誌：進行中', '寫回 C 日誌：尚未開始'])
    expect(statusText()).toBe('執行中 1/3')

    setLive(
      [modelRound, toolEvent('a', '讀 A 日誌', 'success'), toolEvent('b', '讀 B 日誌', 'error'), toolEvent('c', '寫回 C 日誌', 'running')],
      [toolCall('a', 'success'), toolCall('b', 'error'), toolCall('c', 'running')],
    )
    expect(steps()).toEqual(['讀 A 日誌：完成', '讀 B 日誌：失敗', '寫回 C 日誌：進行中'])
    expect(statusText()).toBe('執行中 2/3')

    // 下一輪模型開始後，上一輪不再有排隊中的工具。
    const nextRound: AgentTraceEvent = { runId: 'run', id: 'model-2', timestamp: 40, type: 'model_call', status: 'running', title: '模型思考' }
    setLive(
      [modelRound, toolEvent('a', '讀 A 日誌', 'success'), toolEvent('b', '讀 B 日誌', 'error'), toolEvent('c', '寫回 C 日誌', 'success'), nextRound],
      [toolCall('a', 'success'), toolCall('b', 'error'), toolCall('c', 'success')],
    )
    expect(steps().filter(step => step.endsWith('尚未開始'))).toEqual([])
  })

  it('classic 介面不補排隊中的步驟', () => {
    render(h(AgentExecutionStatus, { chat: assistant }), false)
    setLive([modelRound, toolEvent('a', '讀 A 日誌', 'running')], [toolCall('a', 'running')])
    expect(container.textContent).not.toContain('讀 B 日誌')
    expect(container.textContent).not.toContain('寫回 C 日誌')
  })

  it('沒有步驟的回覆不顯示空清單；單一步驟照常列出', () => {
    // 整個回覆只呼叫 render_response：時間軸裡沒有任何可見步驟。
    const renderOnly: AgentTraceEvent[] = [
      { runId: 'run', id: 'ui', timestamp: 21, duration: 4, type: 'tool_call', status: 'success', title: 'render', toolName: 'render_response' },
      { runId: 'run', id: 'final', timestamp: 25, type: 'final', status: 'success', title: '完成' },
    ]
    render(h(AgentRunTimeline, { chat: assistant, status: 'completed', traceEvents: renderOnly }))
    expect(statusText()).toBe('完成')
    expect(buttonLabels().some(label => label?.includes('個步驟'))).toBe(false)
    expect(container.querySelector('[role=list]')).toBeNull()

    // 一開始就停止、還沒有任何步驟。
    render(h(AgentRunTimeline, { chat: assistant, status: 'stopped', traceEvents: [renderOnly[1]] }))
    expect(buttonLabels().some(label => label?.includes('個步驟'))).toBe(false)

    // 單一步驟：有內容就照常提供「看 1 個步驟」。
    render(h(AgentRunTimeline, { chat: assistant, status: 'completed', traceEvents: [toolEvent('a', '讀 A 日誌', 'success')] }))
    expect(buttonLabels()).toContain('看 1 個步驟')
    expect(steps()).toEqual([])
  })

  it('classic 介面沒有步驟時仍保留原本的收合列', () => {
    const finalOnly: AgentTraceEvent = { runId: 'run', id: 'final', timestamp: 25, type: 'final', status: 'success', title: '完成' }
    render(h(AgentRunTimeline, { chat: assistant, status: 'completed', traceEvents: [finalOnly] }), false)
    expect(container.querySelector('[role=progressbar]')).toBeNull()
    const trigger = container.querySelector('button[data-state]')
    expect(trigger?.getAttribute('data-state')).toBe('closed')
  })

  it('重開對話紀錄時顯示存檔當時的最終狀態', () => {
    // 照 chat-send.tsx 存檔的格式：traceEvents 已收尾並經 retainCompletedAgentTraceEvents。
    const agentHistory = JSON.stringify({
      runId: 'run',
      status: 'failed',
      toolCalls: [toolCall('a', 'success'), toolCall('b', 'error')],
      traceEvents: retainCompletedAgentTraceEvents([
        modelRound,
        toolEvent('a', '讀 A 日誌', 'success'),
        toolEvent('b', '讀 B 日誌', 'error'),
      ]),
    })
    const reopened: Chat = { ...assistant, agentHistory }
    useChatStore.setState({ chats: [user, reopened], agentState: {} as AgentState })
    render(h(AgentPanelWithRag, { chat: reopened, agentHistoryJson: agentHistory }))
    expect(container.querySelector('h3')?.textContent).toBe('整理三篇日誌')
    expect(statusText()).toBe('失敗')
    act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '看 2 個步驟')?.click())
    // 不是執行中，不補排隊中的步驟，也沒有殘留的「進行中」。
    expect(steps()).toEqual(['讀 A 日誌：完成', '讀 B 日誌：失敗'])
  })
})

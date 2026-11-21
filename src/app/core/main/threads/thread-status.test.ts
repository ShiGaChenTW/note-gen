// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'
import useThreadsStore from '@/stores/threads'

const { storeSet } = vi.hoisted(() => ({ storeSet: vi.fn() }))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  })
})

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => undefined, set: storeSet, save: vi.fn() }) },
}))
vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({
      chats: [], conversations: [], currentConversationId: null, loading: false, isTemporaryConversation: false,
      initConversations: vi.fn(), startNewConversation: vi.fn(), switchConversation: vi.fn(),
    })),
  }
})
vi.mock('@/stores/setting', () => ({ default: () => ({ language: 'zh-TW' }) }))

const useChatStore = (await import('@/stores/chat')).default
const { ThreadStatusBar } = await import('./thread-status')
const { ThreadsScreen } = await import('./threads-screen')

let container: HTMLDivElement
let root: Root

function conversation(id: number, title: string, messageCount = 2) {
  return { id, syncId: `s${id}`, syncUpdatedAt: 0, title, createdAt: 1, updatedAt: Date.now() - id * 1000, messageCount, isPinned: false }
}

function render(child: ReturnType<typeof h>) {
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages, timeZone: 'Asia/Taipei', children: child })))
}

const text = () => container.textContent ?? ''
const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  useUiModeStore.setState({ mode: 'v3' })
  useThreadsStore.setState({ ...useThreadsStore.getInitialState(), loadProjects: vi.fn(async () => {}) })
  useChatStore.setState({ chats: [], conversations: [], currentConversationId: null, isTemporaryConversation: false })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ALMNC-54.4 AC#1: tag before the conversation name', () => {
  it('lists conversations as 「標籤｜名稱」, untagged ones as 處理', () => {
    useChatStore.setState({ conversations: [conversation(1, '產線平衡的計算方式'), conversation(2, '下週行程調整'), conversation(3, '11/19 會議紀錄整理')] })
    useThreadsStore.setState({ tagMap: { s1: 'query', s2: 'schedule' } })
    render(h(ThreadsScreen))
    act(() => useThreadsStore.getState().show())
    const rows = [...container.querySelectorAll('[data-thread-id]')].map(row => row.querySelector('.truncate')?.textContent)
    expect(rows).toEqual(['查詢｜產線平衡的計算方式', '日程｜下週行程調整', '處理｜11/19 會議紀錄整理'])
  })

  it('lets a new conversation pick its tag and applies it once the conversation exists', async () => {
    render(h(ThreadStatusBar))
    const query = [...container.querySelectorAll<HTMLButtonElement>('[data-slot="thread-status"] button')].find(b => b.textContent === '查詢')!
    act(() => query.click())
    expect(useThreadsStore.getState().draftTag?.tag).toBe('query')
    expect(text()).toContain(messages.threads.tag.hint.query)

    const created = { ...conversation(9, '新對話', 1), createdAt: Date.now() + 1 }
    await act(async () => useChatStore.setState({ conversations: [created], currentConversationId: 9 }))
    expect(useThreadsStore.getState().tagMap).toEqual({ s9: 'query' })
    expect(useThreadsStore.getState().draftTag).toBeNull()
    expect(storeSet).toHaveBeenCalledWith('threadTags', { s9: 'query' })
  })
})

describe('ALMNC-54.4 AC#2: hand a query to the commander', () => {
  it('changes the tag to 處理 and keeps the same conversation', async () => {
    useChatStore.setState({ conversations: [conversation(1, '產線平衡')], currentConversationId: 1 })
    useThreadsStore.setState({ tagMap: { s1: 'query' } })
    render(h(ThreadStatusBar))
    expect(container.querySelector('[data-slot="thread-tag-label"]')?.textContent).toBe('查詢')
    await act(async () => button(messages.threads.tag.handoff)!.click())
    expect(useThreadsStore.getState().tagMap).toEqual({ s1: 'process' })
    expect(useChatStore.getState().currentConversationId).toBe(1)
    expect(container.querySelector('[data-slot="thread-tag-label"]')?.textContent).toBe('處理')
    expect(button(messages.threads.tag.handoff)).toBeUndefined()
  })
})

describe('ALMNC-54.4 AC#3: secretary asks before handing notes questions to the commander', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [conversation(1, '下週行程')], currentConversationId: 1,
      chats: [{ id: 11, role: 'user', type: 'chat', content: '專案 A 的筆記寫到哪了？', inserted: false, createdAt: 0 }],
    })
    useThreadsStore.setState({ tagMap: { s1: 'schedule' } })
  })

  it('asks, and transfers only when Scott agrees', async () => {
    render(h(ThreadStatusBar))
    expect(text()).toContain(messages.threads.tag.transferAsk)
    expect(useThreadsStore.getState().tagMap.s1).toBe('schedule')
    await act(async () => button(messages.threads.tag.transfer)!.click())
    expect(useThreadsStore.getState().tagMap.s1).toBe('process')
    expect(container.querySelector('[data-slot="thread-transfer"]')).toBeNull()
  })

  it('stays a schedule conversation when Scott says no', () => {
    render(h(ThreadStatusBar))
    act(() => button(messages.threads.tag.keep)!.click())
    expect(container.querySelector('[data-slot="thread-transfer"]')).toBeNull()
    expect(useThreadsStore.getState().tagMap.s1).toBe('schedule')
  })
})

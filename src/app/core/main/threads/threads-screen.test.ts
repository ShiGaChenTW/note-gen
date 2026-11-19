// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'
import { useSidebarStore } from '@/stores/sidebar'
import useThreadsStore from '@/stores/threads'
import { ChatV3Context } from '../chat/chat-v3'

const { persist, save, startNewConversation } = vi.hoisted(() => ({
  persist: vi.fn(),
  save: vi.fn(),
  startNewConversation: vi.fn(),
}))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  })
})

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ set: persist, save }) },
}))
vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({
      chats: [], conversations: [], currentConversationId: null, loading: false,
      initConversations: vi.fn(), startNewConversation,
    })),
  }
})
vi.mock('@/stores/setting', () => ({ default: () => ({ language: 'zh-TW' }) }))
vi.mock('../jobs/create-job', () => ({ CreateJobButton: () => null }))
vi.mock('../conversation-summary/summary-dialog', () => ({ ConversationSummaryButton: () => null }))

const { ThreadsScreen } = await import('./threads-screen')
const { ChatDock } = await import('./chat-dock')
const { ChatHeader } = await import('../chat/chat-header')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })
  localStorage.setItem('rightSidebarVisible', 'true')
  useSidebarStore.setState({ ...useSidebarStore.getInitialState(), centerPanelVisible: true, rightSidebarVisible: true })
  useThreadsStore.setState({ ...useThreadsStore.getInitialState(), loadProjects: vi.fn() })
  useUiModeStore.setState({ mode: 'v3' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(h(NextIntlClientProvider, {
    locale: 'zh-TW', messages, timeZone: 'Asia/Taipei',
    children: [
      h(ThreadsScreen, { key: 'threads' }),
      h(ChatV3Context.Provider, { key: 'chat', value: true },
        h(ChatDock, { children: h(ChatHeader) }),
      ),
    ],
  })))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
})

const open = () => act(() => useThreadsStore.getState().show())
const close = () => act(() => useThreadsStore.getState().hide())
const rightVisible = () => useSidebarStore.getState().rightSidebarVisible

describe('v3 threads page', () => {
  it('collapses the right sidebar only while open and leaves stored preferences alone', () => {
    open()
    expect(rightVisible()).toBe(false)
    expect(localStorage.getItem('rightSidebarVisible')).toBe('true')
    close()
    expect(rightVisible()).toBe(true)
    expect(persist).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('collapses even when the center panel was hidden, keeping both preferences', () => {
    useSidebarStore.setState({ centerPanelVisible: false })
    localStorage.setItem('centerPanelVisible', 'false')
    open()
    expect(rightVisible()).toBe(false)
    close()
    expect(rightVisible()).toBe(true)
    expect(useSidebarStore.getState().centerPanelVisible).toBe(false)
    expect(localStorage.getItem('centerPanelVisible')).toBe('false')
    expect(persist).not.toHaveBeenCalled()
  })

  it('preserves an already hidden sidebar', () => {
    useSidebarStore.setState({ rightSidebarVisible: false })
    localStorage.setItem('rightSidebarVisible', 'false')
    open()
    close()
    expect(rightVisible()).toBe(false)
    expect(localStorage.getItem('rightSidebarVisible')).toBe('false')
    expect(persist).not.toHaveBeenCalled()
  })

  it('honors manual reopening and closing while threads remains open', async () => {
    open()
    await act(() => useSidebarStore.getState().toggleRightSidebar())
    expect(rightVisible()).toBe(true)
    expect(persist).toHaveBeenLastCalledWith('rightSidebarVisible', true)
    close()
    expect(rightVisible()).toBe(true)

    open()
    await act(() => useSidebarStore.getState().toggleRightSidebar())
    await act(() => useSidebarStore.getState().toggleRightSidebar())
    close()
    expect(rightVisible()).toBe(false)
    expect(localStorage.getItem('rightSidebarVisible')).toBe('false')
    expect(persist).toHaveBeenLastCalledWith('rightSidebarVisible', false)
  })

  it('restores the sidebar when switching to classic', () => {
    open()
    act(() => useUiModeStore.setState({ mode: 'classic' }))
    expect(rightVisible()).toBe(true)
    expect(container.querySelector('[data-slot="threads-chat-host"]')).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })

  it('offers one usable new-conversation action with an empty chat', () => {
    open()
    const buttons = [...container.querySelectorAll('button')].filter(button =>
      button.textContent?.trim() === messages.threads.newThread
      || button.getAttribute('aria-label') === messages.record.chat.v3.newChat,
    )
    expect(buttons).toHaveLength(1)
    expect(buttons[0].disabled).toBe(false)
    act(() => buttons[0].click())
    expect(startNewConversation).toHaveBeenCalledOnce()
  })
})

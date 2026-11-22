// @vitest-environment jsdom
// Fork（almanac ALMNC-54.7）：秘書直接修改後，對話裡一行確認附「復原」；按了就還原。右側欄指揮官參與的對話標成「處理」。
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
  return { default: create(() => ({ chats: [{ id: 5, conversationId: 3 }], conversations: [], currentConversationId: 3 })) }
})
vi.mock('@/stores/setting', () => ({ default: () => ({ language: 'zh-TW' }) }))

const { ThreadMessageCards } = await import('./thread-cards')

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useUiModeStore.setState({ mode: 'v3' })
  useThreadsStore.setState({ cards: {}, tagMap: {}, projectsLoaded: false })
  storeSet.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render() {
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages, timeZone: 'Asia/Taipei', children: h(ThreadMessageCards, { chatId: 5 }) })))
}

describe('direct edit confirmation', () => {
  it('shows one line with undo, and undo restores the change', async () => {
    const undo = vi.fn(async () => true)
    useThreadsStore.getState().attachDirectEdit(5, { type: 'direct-edit', id: 'd1', what: '11/20 10:00 會議', agent: 'Leo · 秘書', status: 'done' }, undo)
    render()
    expect(container.textContent).toContain('已新增：11/20 10:00 會議')
    expect(container.textContent).toContain('Leo · 秘書')
    const button = Array.from(container.querySelectorAll('button')).find(element => element.textContent?.includes('復原'))
    expect(button).toBeDefined()
    await act(async () => { button!.click() })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('已復原')
    expect(container.querySelector('button')).toBeNull()
  })

  it('says so when the file changed afterwards and nothing was undone', async () => {
    useThreadsStore.getState().attachDirectEdit(5, { type: 'direct-edit', id: 'd2', what: '交報告', status: 'done' }, async () => false)
    render()
    await act(async () => { Array.from(container.querySelectorAll('button')).find(element => element.textContent?.includes('復原'))!.click() })
    expect(container.textContent).toContain('檔案之後改過，沒有復原')
  })
})

describe('commander threads', () => {
  it('tags a conversation the sidebar commander takes part in as 處理', async () => {
    await useThreadsStore.getState().markCommanderThread({ id: 3, syncId: 'sync-3' })
    expect(useThreadsStore.getState().tagMap).toEqual({ 'sync-3': 'process' })
    expect(storeSet).toHaveBeenCalledWith('threadTags', { 'sync-3': 'process' })
  })
})

// @vitest-environment jsdom
// Fork（almanac ALMNC-54.5）：工作台詳情的提案按鈕（接受／再次討論／放棄）、來源對話、14 天提醒。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'

const { discussProposal, openConversation } = vi.hoisted(() => ({
  discussProposal: vi.fn(async () => 7),
  openConversation: vi.fn(async () => {}),
}))

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
  Store: { load: async () => ({ get: async () => undefined, set: vi.fn(), save: vi.fn() }) },
}))
vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ conversations: [], currentConversationId: null, chats: [] })) }
})
vi.mock('@/stores/setting', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ workspacePath: '', language: 'zh-TW' })) }
})
vi.mock('@/lib/proposals/actions', () => ({ discussProposal, openConversation }))
vi.mock('@/lib/decide/actions', () => ({
  refreshJournal: vi.fn(async () => {}), acceptDecision: vi.fn(async () => ({})), rejectDecision: vi.fn(async () => {}),
  DraftNotApplied: class extends Error {},
}))
vi.mock('../organize/organize-history', () => ({ OrganizeHistory: () => null }))
vi.mock('../jobs/job-result', () => ({ JobReviewPreview: () => null }))

const useChatStore = (await import('@/stores/chat')).default
const useCollectStore = (await import('@/stores/collect')).default
const useDecideStore = (await import('@/stores/decide')).default
const { DecideScreen } = await import('./decide-screen')

let container: HTMLDivElement
let root: Root
const DAY = 86_400_000

const proposal = (id: string, conversationId?: number) =>
  ({ id, kind: 'note' as const, title: `提案 ${id}`, body: '內文', due: '', time: '', tags: [], status: 'wait' as const, conversationId })

function render() {
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages, timeZone: 'Asia/Taipei', children: h(DecideScreen) })))
}
const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  useUiModeStore.setState({ mode: 'v3' })
  useCollectStore.setState({
    hydrate: vi.fn(async () => {}),
    items: [
      { id: 'old', input: { kind: 'text', text: '舊資料源' }, createdAt: Date.now() - 20 * DAY, state: 'ready', proposals: [proposal('a', 7)] },
      { id: 'new', input: { kind: 'text', text: '新資料源' }, createdAt: Date.now(), state: 'ready', proposals: [proposal('b')] },
    ],
  })
  useChatStore.setState({ conversations: [{ id: 7, syncId: 's7', syncUpdatedAt: 0, title: '11/19 會議紀錄整理', createdAt: 1, updatedAt: 1, messageCount: 4, isPinned: false }] })
  useDecideStore.setState({ visible: true, selected: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  render()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('decide detail (ALMNC-54.5)', () => {
  it('AC#2: buttons are 接受／再次討論／放棄', () => {
    const detail = container.querySelector('[data-testid="decide-detail"]')!
    const labels = [...detail.querySelectorAll('button')].map(b => b.textContent?.trim()).filter(label => ['接受', '再次討論', '放棄', '收下', '不要'].includes(label ?? ''))
    expect(labels).toEqual(['接受', '再次討論', '放棄'])
  })

  it('AC#1: shows and opens the source conversation', () => {
    const link = container.querySelector<HTMLButtonElement>('[data-testid="decide-source-conversation"]')!
    expect(link.textContent).toBe('來自對話：11/19 會議紀錄整理')
    act(() => link.click())
    expect(openConversation).toHaveBeenCalledWith(7)
  })

  it('AC#2: 再次討論 needs a note, then goes back to the source conversation', async () => {
    act(() => button('再次討論')!.click())
    const send = button(messages.decide.discuss.send)!
    expect(send.disabled).toBe(true)
    const textarea = container.querySelector('textarea')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, '日期改到下週')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(button(messages.decide.discuss.send)!.disabled).toBe(false)
    await act(async () => button(messages.decide.discuss.send)!.click())
    expect(discussProposal).toHaveBeenCalledWith({ key: 'collect:old:a', conversationId: 7 }, '日期改到下週', expect.any(Function))
    const format = (discussProposal.mock.calls[0] as unknown[])[2] as (note: string) => string
    expect(format('日期改到下週')).toBe('再次討論「提案 a」：日期改到下週')
  })

  it('AC#4: reminds that proposals older than 14 days go into the weekly review, and keeps them listed', () => {
    expect(container.querySelector('[data-testid="decide-stale"]')?.textContent).toBe('1 則提案超過 14 天沒決定，會列進每週回顧，不會自動消失')
    expect(container.querySelectorAll('[data-testid="decide-row"]')).toHaveLength(2)
  })

  it('has no source link for proposals without a conversation', () => {
    act(() => useDecideStore.getState().select('collect:new:b'))
    expect(container.querySelector('[data-testid="decide-source-conversation"]')).toBeNull()
  })
})

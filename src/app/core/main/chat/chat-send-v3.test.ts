// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import { ChatV3Context } from './chat-v3'

let loading = false

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})
vi.mock('@/stores/setting', () => ({ default: () => ({ primaryModel: 'fixture' }) }))
vi.mock('@/stores/chat', () => ({ default: () => ({ loading }) }))
vi.mock('@/stores/tag', () => ({ default: () => ({}) }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('./use-chat-agent-session', () => ({
  useChatAgentSession: () => ({ session: { configure: vi.fn(), subscribe: () => () => {} }, sessionId: 'test' }),
}))

const { ChatSend } = await import('./chat-send')

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  loading = false
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(inputValue: string, roundStyle = true, attachedImages: React.ComponentProps<typeof ChatSend>['attachedImages'] = []) {
  act(() => root.render(h(NextIntlClientProvider, {
    locale: 'zh-TW', messages, timeZone: 'Asia/Taipei',
    children: h(ChatV3Context.Provider, { value: roundStyle }, h(ChatSend, { inputValue, roundStyle, attachedImages })),
  })))
  const button = container.querySelector('button')
  expect(button).toBeTruthy()
  return button!
}

it('styles the empty v3 send button as a disabled ghost and typed input as an invert action', () => {
  const empty = render('  ')
  expect(empty.disabled).toBe(true)
  expect(empty.classList).toContain('bg-transparent')
  expect(empty.classList).toContain('text-muted-ink')
  expect(empty.classList).toContain('hover:bg-hover')
  expect(empty.classList).not.toContain('bg-invert')

  const filled = render('問題')
  expect(filled.disabled).toBe(false)
  expect(filled.classList).toContain('bg-invert')
  expect(filled.classList).toContain('text-invert-ink')
})

it('keeps an attachment-only send and the running stop action solid', () => {
  expect(render('', true, [{ id: 'photo', url: 'blob:fixture', name: 'photo.png' }]).classList).toContain('bg-invert')
  loading = true
  const stop = render('')
  expect(stop.getAttribute('aria-label')).toBe(messages.record.chat.input.stop)
  expect(stop.disabled).toBe(false)
  expect(stop.classList).toContain('bg-invert')
})

it('keeps the classic empty send appearance', () => {
  const empty = render('', false)
  expect(empty.disabled).toBe(true)
  expect(empty.classList).toContain('bg-primary')
  expect(empty.classList).not.toContain('bg-invert')
})

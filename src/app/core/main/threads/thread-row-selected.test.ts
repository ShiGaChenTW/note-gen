// @vitest-environment jsdom
// Fork（almanac ALMNC-79.5）：對話列表目前那串用「選中浮起」，和側欄、筆記清單一致。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import { THREAD_TAGS } from '@/lib/threads/tags'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  const memory = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) })
})

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/core/main', useSearchParams: () => new URLSearchParams() }))

const { ThreadRow } = await import('./threads-screen')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(current: boolean) {
  const thread = { id: 1, syncId: 's1', title: '週會整理', updatedAt: Date.now(), messageCount: 3, isPinned: false } as never
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(ThreadRow, {
    thread, tag: THREAD_TAGS[0], pending: 0, project: '', projects: [], current, now: Date.now(), onOpen: vi.fn(), onMove: vi.fn(),
  }) })))
  return container.querySelector<HTMLElement>('[data-thread-id="1"]')!
}

it('raises the current thread row only', () => {
  expect(render(true).className).toContain('v3:selected-raised')
  expect(render(false).className).not.toContain('selected-raised')
})

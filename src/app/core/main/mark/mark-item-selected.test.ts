// @vitest-environment jsdom
// Fork（almanac ALMNC-79.5）：V3 記錄清單的選中列浮起、不用左側線條；classic 照舊用左側墨色線條。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import type { Mark } from '@/db/marks'
import useMarkStore from '@/stores/mark'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  const memory = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) })
})

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/core/main', useSearchParams: () => new URLSearchParams() }))

const { MarkItem } = await import('./mark-item')

const mark: Mark = { id: 7, tagId: 1, type: 'text', content: '預算表的數字要先對過', desc: '', url: '', deleted: 0, createdAt: Date.now() }

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

it('raises the active record row and keeps the classic left line only outside V3', () => {
  act(() => useMarkStore.setState({ activeMarkId: mark.id } as never))
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(MarkItem, { mark, variant: 'list' }) })))
  const row = container.querySelector<HTMLElement>('.v3\\:selected-raised')
  expect(row).not.toBeNull()
  // classic 仍有左側線條；V3 用 v3:border-l-transparent 蓋掉
  expect(row!.className).toContain('border-l-ink')
  expect(row!.className).toContain('v3:border-l-transparent')
})

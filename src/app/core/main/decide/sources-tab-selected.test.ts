// @vitest-environment jsdom
// Fork（almanac ALMNC-79.5）：工作台資料源清單的選中列用「選中浮起」，和側欄、筆記清單一致。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import type { SourceListRow } from '@/lib/workbench/sources-tab'
import useWorkbenchStore from '@/stores/workbench'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})

const { SourcesTab } = await import('./sources-tab')

const row = (id: string, title: string): SourceListRow => ({
  id, origin: 'source', kind: 'web', title, excerpt: '', content: '', from: 'https://x.test', at: Date.now(), status: 'wait', outputs: 0, version: 1,
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('raises the selected source row and leaves the others flat', () => {
  const rows = [row('src:a', '七大浪費'), row('src:b', '週會逐字稿')]
  act(() => useWorkbenchStore.getState().selectRow('src:a'))
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(SourcesTab, { rows, commanderName: '指揮官', onDesk: vi.fn() }) })))
  const selected = container.querySelector<HTMLElement>('[data-row="src:a"]')!
  const other = container.querySelector<HTMLElement>('[data-row="src:b"]')!
  expect(selected.className).toContain('v3:selected-raised')
  expect(other.className).not.toContain('selected-raised')
})

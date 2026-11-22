// @vitest-environment jsdom
// Fork（almanac ALMNC-56.7，RPT-2026-009 P05）：V3 完全不放「需處理」、也不掃整個 vault；classic 照舊。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'
import type { IndexedNote } from '@/lib/vault-index/index-note'

const spy = vi.hoisted(() => ({ stale: vi.fn() }))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

vi.mock('@/lib/today/today-model', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/today/today-model')>()
  return { ...original, staleInboxNotes: (...args: Parameters<typeof original.staleInboxNotes>) => { spy.stale(); return original.staleInboxNotes(...args) } }
})
vi.mock('@/stores/daily-settings', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ inboxFolder: 'Inbox', staleDays: 7, initSettings: async () => {} })) }
})
vi.mock('@/stores/inbox', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ records: [], processed: new Map() })), selectStaleRecords: () => [] }
})
vi.mock('../status-bar-order', () => ({ StatusBarItem: ({ children }: { children: unknown }) => children }))

const useVaultIndexStore = (await import('@/stores/vault-index')).default
const { TodayStatusItem } = await import('./today-status-item')

const OLD = Date.now() - 30 * 86_400_000
const note = (path: string): [string, IndexedNote] =>
  [path, { path, mtime: OLD, frontmatter: null, tasks: [], links: [], aliases: [], tags: [], headings: [], blockIds: [] }]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  spy.stale.mockClear()
  useVaultIndexStore.setState({ notes: new Map([note('Inbox/old.md'), note('Notes/a.md')]), revision: 1, status: 'scanning' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render() {
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(TodayStatusItem) })))
}

it('P05: V3 never renders the 需處理 item and never scans the vault, even once the index is ready', () => {
  useUiModeStore.setState({ mode: 'v3' })
  render()
  expect(container.innerHTML).toBe('')
  act(() => useVaultIndexStore.setState({ status: 'ready', revision: 2 }))
  expect(container.innerHTML).toBe('')
  expect(spy.stale).not.toHaveBeenCalled()
})

it('classic keeps computing and showing the entry as before', () => {
  useUiModeStore.setState({ mode: 'classic' })
  render()
  expect(spy.stale).toHaveBeenCalled()
  expect(container.querySelector('button')).not.toBeNull()
  act(() => useVaultIndexStore.setState({ status: 'ready' }))
  expect(container.textContent).toContain('1')
})

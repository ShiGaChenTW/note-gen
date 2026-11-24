// @vitest-environment jsdom
// Fork（almanac ALMNC-83.1）：V3 下檔案、資料夾、記錄、標籤、畫布右鍵選單不列 LLM Wiki；classic 照舊。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUiModeStore } from '@/lib/fork-ui'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('./use-wiki-navigation', () => ({ useWikiNavigation: () => ({ openPage: async () => {}, openFolder: async () => {} }) }))
vi.mock('./use-wiki-error-message', () => ({ useWikiErrorMessage: () => (error: unknown) => String(error) }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/lib/wiki/context', () => ({
  assertWikiContextCurrent: async () => {},
  getWikiContext: () => new Promise(() => {}),
  subscribeWikiWorkspaceChanges: () => () => {},
}))
vi.mock('@/components/ui/context-menu', () => ({
  ContextMenuGroup: ({ children }: { children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'wiki-group' }, children),
  ContextMenuItem: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
}))

await vi.hoisted(async () => {
  // Node's optional localStorage global can shadow jsdom's Storage.
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

const { WikiMenuItems } = await import('./wiki-menu-items')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useUiModeStore.setState({ mode: 'v3' })
})

async function render() {
  await act(async () => root.render(React.createElement(WikiMenuItems, { kind: 'article', id: 'notes/a.md', label: 'a' })))
  return host.innerHTML
}

it('renders nothing in V3', async () => {
  useUiModeStore.setState({ mode: 'v3' })
  expect(await render()).toBe('')
})

it('keeps the LLM Wiki menu in classic', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  expect(await render()).not.toBe('')
})

// @vitest-environment jsdom
// almanac ALMNC-83.1：新介面（V3）的 rag 頁叫「語意檢索」，不出現 LLM Wiki；classic 照舊。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'

vi.mock('@/components/wiki/wiki-settings-panel', () => ({ WikiSettingsPanel: () => React.createElement('section', null, 'WIKI_SETTINGS_PANEL') }))
vi.mock('@/components/wiki/use-wiki-data', () => ({
  useWikiData: () => ({ data: { context: { id: 'c' }, settings: { semanticSearchEnabled: false } }, refresh: async () => {} }),
}))
vi.mock('@/components/wiki/use-wiki-error-message', () => ({ useWikiErrorMessage: () => (error: unknown) => String(error) }))
vi.mock('@/components/wiki/use-wiki-action-scope', () => ({ useWikiActionScope: () => ({ busy: false, beginAction: () => ({ isCurrent: () => true, finish: () => {} }) }) }))
vi.mock('@/lib/wiki/settings', () => ({ updateWikiSettings: async () => {} }))
vi.mock('@/lib/wiki/context', () => ({ assertWikiContextCurrent: async () => {} }))
vi.mock('@/stores/ragSettings', () => {
  const state = { automaticSearchEnabled: true, agentStrategy: 'balanced', enabledSourceTypes: [], excludedPaths: [], initSettings: async () => {}, updateSetting: async () => {} }
  return { default: (select?: (value: typeof state) => unknown) => select ? select(state) : state, DEFAULT_RAG_SETTINGS: { excludedPaths: [] } }
})
vi.mock('./model-setting', () => ({ ModelSetting: () => null }))
vi.mock('./settings', () => ({ Settings: () => null }))

const { default: KnowledgeSetting } = await import('./page')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
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
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: React.createElement(KnowledgeSetting) }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
  return host.textContent ?? ''
}

it('shows 語意檢索 without LLM Wiki in V3', async () => {
  useUiModeStore.setState({ mode: 'v3' })
  const text = await render()
  expect(text).toContain('語意檢索')
  expect(text).not.toContain('WIKI_SETTINGS_PANEL')
  expect(text).not.toMatch(/wiki/i)
  expect(text).not.toContain('知識庫')
})

it('keeps the classic page with LLM Wiki', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  const text = await render()
  expect(text).toContain(zhTW.wiki.title)
  expect(text).toContain('WIKI_SETTINGS_PANEL')
})

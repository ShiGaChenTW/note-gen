// @vitest-environment jsdom
// almanac ALMNC-83.1 驗收 #2：新介面（V3）手機對話標頭看不到 Wiki 按鈕；classic 照舊。
// 隱藏只是不畫按鈕：不呼叫任何 wiki 刪除或清理，Wiki 資料夾留著。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'

const spies = vi.hoisted(() => ({
  openFolder: vi.fn(async () => {}),
  fsRemove: vi.fn(async () => {}),
  removeWikiSource: vi.fn(async () => {}),
  removeWikiScope: vi.fn(async () => {}),
  removeWikiJob: vi.fn(async () => {}),
  removeWikiMarkdownCache: vi.fn(async () => {}),
  deleteKnowledgeSource: vi.fn(async () => {}),
}))

vi.mock('@/components/wiki/use-wiki-navigation', () => ({ useWikiNavigation: () => ({ openFolder: spies.openFolder }) }))
vi.mock('@/app/mobile/components/mobile-me-sheet', () => ({ MobileMeSheet: () => null }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/stores/chat', () => {
  const state = {
    startNewConversation: () => {}, startTemporaryConversation: () => {}, conversations: [], currentConversationId: null,
    isTemporaryConversation: false, switchConversation: () => {}, deleteConversation: () => {}, chats: [], loading: false,
  }
  return { default: (select?: (value: typeof state) => unknown) => select ? select(state) : state }
})
vi.mock('@/stores/setting', () => {
  const state = { language: 'zh-TW' }
  return { default: (select?: (value: typeof state) => unknown) => select ? select(state) : state }
})
// 刪除／清理路徑全換成間諜：V3 隱藏時一個都不該被叫到
vi.mock('@tauri-apps/plugin-fs', () => ({ remove: spies.fsRemove }))
vi.mock('@/lib/wiki/queue', () => ({ removeWikiSource: spies.removeWikiSource }))
vi.mock('@/lib/wiki/settings', () => ({ removeWikiScope: spies.removeWikiScope }))
vi.mock('@/db/wiki', () => ({ removeWikiJob: spies.removeWikiJob, removeWikiMarkdownCache: spies.removeWikiMarkdownCache }))
vi.mock('@/db/knowledge', () => ({ deleteKnowledgeSource: spies.deleteKnowledgeSource }))

const { MobileChatHeader } = await import('./mobile-chat-header')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.values(spies).forEach(spy => spy.mockClear())
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
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: React.createElement(MobileChatHeader) }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
}

const wikiButton = () => host.querySelector(`button[aria-label="${zhTW.wiki.open}"]`)
const searchButton = () => host.querySelector(`button[aria-label="${zhTW.search.placeholder}"]`)

function expectNoWikiDeletion() {
  expect(spies.fsRemove).not.toHaveBeenCalled()
  expect(spies.removeWikiSource).not.toHaveBeenCalled()
  expect(spies.removeWikiScope).not.toHaveBeenCalled()
  expect(spies.removeWikiJob).not.toHaveBeenCalled()
  expect(spies.removeWikiMarkdownCache).not.toHaveBeenCalled()
  expect(spies.deleteKnowledgeSource).not.toHaveBeenCalled()
}

it('V3：手機對話標頭沒有 Wiki 按鈕，其他按鈕照常', async () => {
  useUiModeStore.setState({ mode: 'v3' })
  await render()
  expect(searchButton()).not.toBeNull()
  expect(wikiButton()).toBeNull()
  expect(host.innerHTML).not.toMatch(/wiki/i)
  expect(spies.openFolder).not.toHaveBeenCalled()
  expectNoWikiDeletion()
})

it('classic：手機對話標頭有 Wiki 按鈕，按下開 Wiki 資料夾', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  await render()
  const button = wikiButton() as HTMLButtonElement | null
  expect(button).not.toBeNull()
  await act(async () => button!.click())
  expect(spies.openFolder).toHaveBeenCalledTimes(1)
  expectNoWikiDeletion()
})

it('classic → V3 → classic 來回切：按鈕只是隱藏又回來，過程不刪 wiki 資料', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  await render()
  expect(wikiButton()).not.toBeNull()
  await act(async () => useUiModeStore.setState({ mode: 'v3' }))
  expect(wikiButton()).toBeNull()
  await act(async () => useUiModeStore.setState({ mode: 'classic' }))
  expect(wikiButton()).not.toBeNull()
  expectNoWikiDeletion()
})

// @vitest-environment jsdom
// almanac ALMNC-83.1 驗收 #2：V3 的「資料使用與對話」卡說明只講語意檢索、不標「共用設定」（不提 Wiki）；
// classic 說明提 Wiki 並標「共用設定」。KnowledgeSettingCard 沒給 label 就不畫標籤。
// 既有資料不刪：V3 只換文字，渲染時不呼叫任何設定寫入或 wiki 刪除。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { MessageSquare } from 'lucide-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'

const spies = vi.hoisted(() => ({
  initSettings: vi.fn(async () => {}),
  updateSetting: vi.fn(async () => {}),
  fsRemove: vi.fn(async () => {}),
  removeWikiSource: vi.fn(async () => {}),
  removeWikiScope: vi.fn(async () => {}),
  updateWikiSettings: vi.fn(async () => {}),
  removeWikiJob: vi.fn(async () => {}),
  removeWikiMarkdownCache: vi.fn(async () => {}),
  deleteKnowledgeSource: vi.fn(async () => {}),
}))

vi.mock('@/stores/ragSettings', () => {
  const state = {
    automaticSearchEnabled: true, agentStrategy: 'balanced', enabledSourceTypes: ['article'], excludedPaths: ['Wiki'],
    initSettings: spies.initSettings, updateSetting: spies.updateSetting,
  }
  return { default: (select?: (value: typeof state) => unknown) => select ? select(state) : state, DEFAULT_RAG_SETTINGS: { excludedPaths: [] } }
})
vi.mock('@tauri-apps/plugin-fs', () => ({ remove: spies.fsRemove }))
vi.mock('@/lib/wiki/queue', () => ({ removeWikiSource: spies.removeWikiSource }))
vi.mock('@/lib/wiki/settings', () => ({ removeWikiScope: spies.removeWikiScope, updateWikiSettings: spies.updateWikiSettings }))
vi.mock('@/db/wiki', () => ({ removeWikiJob: spies.removeWikiJob, removeWikiMarkdownCache: spies.removeWikiMarkdownCache }))
vi.mock('@/db/knowledge', () => ({ deleteKnowledgeSource: spies.deleteKnowledgeSource }))

const { WikiKnowledgePreferences } = await import('./wiki-knowledge-preferences')
const { KnowledgeSettingCard } = await import('./knowledge-setting-card')

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

async function render(element: React.ReactElement) {
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: element }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
}

const card = () => host.querySelector('[role="region"]') as HTMLElement
const badge = () => card().querySelector('[data-slot="badge"]')
const description = () => card().querySelector('[data-slot="card-description"]')?.textContent

function expectNoWriteOrDeletion() {
  expect(spies.updateSetting).not.toHaveBeenCalled()
  expect(spies.fsRemove).not.toHaveBeenCalled()
  expect(spies.removeWikiSource).not.toHaveBeenCalled()
  expect(spies.removeWikiScope).not.toHaveBeenCalled()
  expect(spies.updateWikiSettings).not.toHaveBeenCalled()
  expect(spies.removeWikiJob).not.toHaveBeenCalled()
  expect(spies.removeWikiMarkdownCache).not.toHaveBeenCalled()
  expect(spies.deleteKnowledgeSource).not.toHaveBeenCalled()
}

it('V3：資料使用與對話卡說明只講語意檢索，沒有「共用設定」標籤，也不提 Wiki', async () => {
  useUiModeStore.setState({ mode: 'v3' })
  await render(React.createElement(WikiKnowledgePreferences))
  expect(card().querySelector('[role="heading"]')?.textContent).toBe(zhTW.wiki.chatSettingsTitle)
  expect(description()).toBe(zhTW.settings.rag.semanticChatDescription)
  expect(badge()).toBeNull()
  expect(host.textContent).not.toContain(zhTW.wiki.sharedMode)
  expect(host.textContent).not.toContain(zhTW.wiki.chatSettingsDescription)
  expect(host.textContent).not.toMatch(/wiki/i)
  expectNoWriteOrDeletion()
})

it('classic：說明提 Wiki 並標「共用設定」', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  await render(React.createElement(WikiKnowledgePreferences))
  expect(description()).toBe(zhTW.wiki.chatSettingsDescription)
  expect(description()).toMatch(/Wiki/)
  expect(badge()?.textContent).toBe(zhTW.wiki.sharedMode)
  expectNoWriteOrDeletion()
})

it('classic → V3 → classic：只換說明與標籤，不寫設定、不刪 wiki', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  await render(React.createElement(WikiKnowledgePreferences))
  expect(badge()).not.toBeNull()
  await act(async () => useUiModeStore.setState({ mode: 'v3' }))
  expect(badge()).toBeNull()
  expect(description()).toBe(zhTW.settings.rag.semanticChatDescription)
  await act(async () => useUiModeStore.setState({ mode: 'classic' }))
  expect(badge()?.textContent).toBe(zhTW.wiki.sharedMode)
  expectNoWriteOrDeletion()
})

it('KnowledgeSettingCard：沒給 label 不畫標籤，有給就畫', async () => {
  await render(React.createElement(KnowledgeSettingCard, { title: 'T', description: 'D', icon: MessageSquare }))
  expect(card().querySelector('[role="heading"]')?.textContent).toBe('T')
  expect(badge()).toBeNull()
  await render(React.createElement(KnowledgeSettingCard, { title: 'T', description: 'D', icon: MessageSquare, label: 'L' }))
  expect(badge()?.textContent).toBe('L')
})

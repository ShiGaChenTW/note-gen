// @vitest-environment jsdom
// almanac ALMNC-83.1 驗收 #2：V3 的資料夾檢視沒有 LLM Wiki 卡，只留語意檢索卡；classic 兩張都有。
// 既有 wiki 資料不刪：V3 照樣讀 wiki 資料（useWikiData），但不呼叫任何 wiki 寫入、刪除或清理。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'

const spies = vi.hoisted(() => ({
  useWikiData: vi.fn(),
  setWikiFolderEnabled: vi.fn(async () => {}),
  startWikiFolderCompilation: vi.fn(async () => {}),
  calculateFolderVectors: vi.fn(async () => ({})),
  fsRemove: vi.fn(async () => {}),
  removeWikiSource: vi.fn(async () => {}),
  removeWikiScope: vi.fn(async () => {}),
  updateWikiSettings: vi.fn(async () => {}),
  removeWikiJob: vi.fn(async () => {}),
  removeWikiMarkdownCache: vi.fn(async () => {}),
  deleteKnowledgeSource: vi.fn(async () => {}),
  deleteVectorDocumentsByFilename: vi.fn(async () => {}),
  deleteVectorDocumentsByPrefix: vi.fn(async () => {}),
  clearVectorDb: vi.fn(async () => {}),
}))

const wikiData = vi.hoisted(() => ({
  context: { id: 'ctx' },
  settings: { enabled: true, semanticSearchEnabled: true, started: true, paused: false },
  sources: [
    { sourceType: 'article', sourceKey: 'article:notes/a.md', source: { locator: { filePath: 'notes/a.md' } }, status: 'ready' },
  ],
  jobs: [],
}))

vi.mock('@/components/wiki/use-wiki-data', () => ({ useWikiData: spies.useWikiData }))
vi.mock('@/components/wiki/use-wiki-action-scope', () => ({ useWikiActionScope: () => ({ busy: false, beginAction: () => ({ isCurrent: () => true, finish: () => {} }) }) }))
vi.mock('@/lib/wiki/folders', () => ({
  getWikiFolderSelection: () => ({ included: true, inheritedFrom: null, hasOverrides: false }),
  setWikiFolderEnabled: spies.setWikiFolderEnabled,
  startWikiFolderCompilation: spies.startWikiFolderCompilation,
}))
vi.mock('@/lib/wiki/settings', () => ({
  getWikiSettings: async () => wikiData.settings,
  isWikiArticlePathSelected: () => true,
  removeWikiScope: spies.removeWikiScope,
  updateWikiSettings: spies.updateWikiSettings,
}))
vi.mock('@/lib/wiki/context', () => ({ assertWikiContextCurrent: async () => {}, captureWikiWorkspaceGuard: () => () => true }))
vi.mock('@/lib/wiki/sources', () => ({ collectWikiArticleSourceDocuments: async () => [] }))
vi.mock('@/lib/files', () => ({ collectMarkdownFiles: async () => [{ path: 'notes/a.md' }] }))
vi.mock('@/lib/folder-vector', () => ({ calculateFolderVectors: spies.calculateFolderVectors }))
vi.mock('@/db/vector', () => ({
  getVectorIndexStatsForFiles: async () => ({ documentCount: 1, chunkCount: 3, lastUpdatedAt: null }),
  deleteVectorDocumentsByFilename: spies.deleteVectorDocumentsByFilename,
  deleteVectorDocumentsByPrefix: spies.deleteVectorDocumentsByPrefix,
  clearVectorDb: spies.clearVectorDb,
}))
vi.mock('@/stores/article', () => {
  const state = { vectorIndexedFiles: new Set(), initVectorIndexedFiles: async () => {}, setVectorCalcStatus: () => {} }
  const store = (select?: (value: typeof state) => unknown) => select ? select(state) : state
  store.getState = () => state
  return { default: store }
})
vi.mock('@/stores/setting', () => {
  const state = { workspacePath: '/vault', assetsPath: 'assets' }
  const store = (select?: (value: typeof state) => unknown) => select ? select(state) : state
  store.getState = () => state
  return { default: store }
})
vi.mock('@/stores/settings-dialog', () => ({ useSettingsDialogStore: { getState: () => ({ openSettings: () => {} }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ remove: spies.fsRemove }))
vi.mock('@/lib/wiki/queue', () => ({ removeWikiSource: spies.removeWikiSource }))
vi.mock('@/db/wiki', () => ({ removeWikiJob: spies.removeWikiJob, removeWikiMarkdownCache: spies.removeWikiMarkdownCache }))
vi.mock('@/db/knowledge', () => ({ deleteKnowledgeSource: spies.deleteKnowledgeSource }))

const { FolderStatsView } = await import('./folder-stats')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.values(spies).forEach(spy => spy.mockReset())
  spies.useWikiData.mockReturnValue({ data: wikiData, error: null, loading: false, refresh: async () => {} })
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
  const view = React.createElement(FolderStatsView, { folderPath: 'notes', folderFiles: ['notes/a.md'] })
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: view }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
}

const headings = () => [...host.querySelectorAll('[role="heading"]')].map(node => node.textContent)
const wikiToggle = () => host.querySelector(`[aria-label="${zhTW.article.file.folderView.wikiSourceToggle}"]`) as HTMLButtonElement | null

function expectNoWikiWriteOrDeletion() {
  expect(spies.setWikiFolderEnabled).not.toHaveBeenCalled()
  expect(spies.startWikiFolderCompilation).not.toHaveBeenCalled()
  expect(spies.calculateFolderVectors).not.toHaveBeenCalled()
  expect(spies.fsRemove).not.toHaveBeenCalled()
  expect(spies.removeWikiSource).not.toHaveBeenCalled()
  expect(spies.removeWikiScope).not.toHaveBeenCalled()
  expect(spies.updateWikiSettings).not.toHaveBeenCalled()
  expect(spies.removeWikiJob).not.toHaveBeenCalled()
  expect(spies.removeWikiMarkdownCache).not.toHaveBeenCalled()
  expect(spies.deleteKnowledgeSource).not.toHaveBeenCalled()
  expect(spies.deleteVectorDocumentsByFilename).not.toHaveBeenCalled()
  expect(spies.deleteVectorDocumentsByPrefix).not.toHaveBeenCalled()
  expect(spies.clearVectorDb).not.toHaveBeenCalled()
}

it('V3：資料夾檢視只有語意檢索卡，沒有 LLM Wiki 卡；wiki 資料照讀、不寫不刪', async () => {
  useUiModeStore.setState({ mode: 'v3' })
  await render()
  expect(headings()).toEqual([zhTW.settings.rag.ragTitle])
  expect(host.textContent).not.toMatch(/wiki/i)
  expect(wikiToggle()).toBeNull()
  expect(host.textContent).not.toContain(zhTW.article.file.folderView.organizeFolder)
  expect(host.textContent).not.toContain(zhTW.article.file.folderView.updateFolder)
  expect(spies.useWikiData).toHaveBeenCalled()
  expectNoWikiWriteOrDeletion()
})

it('classic：資料夾檢視有 LLM Wiki 卡與語意檢索卡', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  await render()
  expect(headings()).toEqual([zhTW.wiki.wikiTitle, zhTW.settings.rag.ragTitle])
  expect(wikiToggle()).not.toBeNull()
  expect(host.textContent).toContain(zhTW.article.file.folderView.updateFolder)
  expectNoWikiWriteOrDeletion()
})

it('classic 的 Wiki 開關確實會寫 wiki（證明間諜有接上，V3 的「沒呼叫」不是空測）', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  await render()
  await act(async () => wikiToggle()!.click())
  expect(spies.setWikiFolderEnabled).toHaveBeenCalledWith('notes', false, 'ctx')
})

it('classic → V3 → classic：LLM Wiki 卡隱藏後原樣回來，切換過程不寫不刪 wiki', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  await render()
  expect(headings()).toContain(zhTW.wiki.wikiTitle)
  await act(async () => useUiModeStore.setState({ mode: 'v3' }))
  expect(headings()).toEqual([zhTW.settings.rag.ragTitle])
  await act(async () => useUiModeStore.setState({ mode: 'classic' }))
  expect(headings()).toEqual([zhTW.wiki.wikiTitle, zhTW.settings.rag.ragTitle])
  expect(host.textContent).toContain(zhTW.article.file.folderView.updateFolder)
  expectNoWikiWriteOrDeletion()
})

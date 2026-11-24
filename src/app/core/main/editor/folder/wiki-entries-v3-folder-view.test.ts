// @vitest-environment jsdom
// almanac ALMNC-83.1 驗收 #2：V3 下 Wiki 資料夾不再進 LLM Wiki 專屬檢視，改用一般資料夾檢視，
// 而且資料夾裡的 Wiki 筆記照樣列出（檔案保留、不刪）；classic 仍進 Wiki 專屬檢視。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'

const spies = vi.hoisted(() => ({
  statsProps: [] as Array<{ folderPath: string; folderFiles: string[] }>,
  wikiProps: [] as Array<{ folderPath: string }>,
  fsRemove: vi.fn(async () => {}),
  removeWikiSource: vi.fn(async () => {}),
  removeWikiScope: vi.fn(async () => {}),
  removeWikiJob: vi.fn(async () => {}),
  removeWikiMarkdownCache: vi.fn(async () => {}),
  deleteKnowledgeSource: vi.fn(async () => {}),
}))

vi.mock('./folder-stats', () => ({
  FolderStatsView: (props: { folderPath: string; folderFiles: string[] }) => {
    spies.statsProps.push(props)
    return React.createElement('section', { 'data-view': 'folder-stats' }, props.folderFiles.join(','))
  },
}))
vi.mock('./wiki-folder-view', () => ({
  WikiFolderView: (props: { folderPath: string }) => {
    spies.wikiProps.push(props)
    return React.createElement('section', { 'data-view': 'wiki-folder' }, 'LLM_WIKI_FOLDER_VIEW')
  },
}))
vi.mock('./skills-list', () => ({ SkillsListView: () => null }))
vi.mock('./skill-detail', () => ({ SkillDetailView: () => null }))
vi.mock('@/stores/skills', () => {
  const state = { getSkillsByScope: () => [], initSkills: () => {}, initialized: true }
  return { useSkillsStore: (select?: (value: typeof state) => unknown) => select ? select(state) : state }
})
const tree = vi.hoisted(() => {
  const wiki: Record<string, unknown> = { name: 'Wiki', isDirectory: true, isFile: false }
  wiki.children = [
    { name: 'index.md', isFile: true, isDirectory: false, parent: wiki },
    { name: 'topic.md', isFile: true, isDirectory: false, parent: wiki },
  ]
  const notes: Record<string, unknown> = { name: 'notes', isDirectory: true, isFile: false }
  notes.children = [{ name: 'a.md', isFile: true, isDirectory: false, parent: notes }]
  return [wiki, notes]
})
vi.mock('@/stores/article', () => {
  const state = { fileTree: tree }
  const store = (select?: (value: typeof state) => unknown) => select ? select(state) : state
  store.getState = () => state
  return { default: store }
})
vi.mock('@tauri-apps/plugin-fs', () => ({ remove: spies.fsRemove }))
vi.mock('@/lib/wiki/queue', () => ({ removeWikiSource: spies.removeWikiSource }))
vi.mock('@/lib/wiki/settings', () => ({ removeWikiScope: spies.removeWikiScope }))
vi.mock('@/db/wiki', () => ({ removeWikiJob: spies.removeWikiJob, removeWikiMarkdownCache: spies.removeWikiMarkdownCache }))
vi.mock('@/db/knowledge', () => ({ deleteKnowledgeSource: spies.deleteKnowledgeSource }))

const { FolderView } = await import('./index')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  spies.statsProps.length = 0
  spies.wikiProps.length = 0
  ;[spies.fsRemove, spies.removeWikiSource, spies.removeWikiScope, spies.removeWikiJob, spies.removeWikiMarkdownCache, spies.deleteKnowledgeSource]
    .forEach(spy => spy.mockClear())
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useUiModeStore.setState({ mode: 'v3' })
})

async function render(folderPath: string) {
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: React.createElement(FolderView, { folderPath }) }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
}

const view = () => host.querySelector('[data-view]')?.getAttribute('data-view')

function expectNoWikiDeletion() {
  expect(spies.fsRemove).not.toHaveBeenCalled()
  expect(spies.removeWikiSource).not.toHaveBeenCalled()
  expect(spies.removeWikiScope).not.toHaveBeenCalled()
  expect(spies.removeWikiJob).not.toHaveBeenCalled()
  expect(spies.removeWikiMarkdownCache).not.toHaveBeenCalled()
  expect(spies.deleteKnowledgeSource).not.toHaveBeenCalled()
}

it('V3：Wiki 資料夾用一般資料夾檢視，Wiki 筆記照樣列出', async () => {
  useUiModeStore.setState({ mode: 'v3' })
  await render('Wiki')
  expect(view()).toBe('folder-stats')
  expect(spies.wikiProps).toHaveLength(0)
  expect(host.textContent).not.toContain('LLM_WIKI_FOLDER_VIEW')
  expect(spies.statsProps.at(-1)?.folderFiles).toEqual(['Wiki/index.md', 'Wiki/topic.md'])
  expectNoWikiDeletion()
})

it('classic：Wiki 資料夾進 LLM Wiki 專屬檢視', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  await render('Wiki')
  expect(view()).toBe('wiki-folder')
  expect(spies.wikiProps.at(-1)?.folderPath).toBe('Wiki')
  expect(spies.statsProps).toHaveLength(0)
  expectNoWikiDeletion()
})

it.each(['v3', 'classic'] as const)('%s：一般資料夾不受影響，都用一般資料夾檢視', async (mode) => {
  useUiModeStore.setState({ mode })
  await render('notes')
  expect(view()).toBe('folder-stats')
  expect(spies.statsProps.at(-1)?.folderFiles).toEqual(['notes/a.md'])
})

it('同一個 Wiki 資料夾 classic → V3 → classic：只換檢視，檔案清單不變、不刪資料', async () => {
  useUiModeStore.setState({ mode: 'classic' })
  await render('Wiki')
  expect(view()).toBe('wiki-folder')
  await act(async () => useUiModeStore.setState({ mode: 'v3' }))
  expect(view()).toBe('folder-stats')
  expect(spies.statsProps.at(-1)?.folderFiles).toEqual(['Wiki/index.md', 'Wiki/topic.md'])
  await act(async () => useUiModeStore.setState({ mode: 'classic' }))
  expect(view()).toBe('wiki-folder')
  expectNoWikiDeletion()
})

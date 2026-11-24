// @vitest-environment jsdom
// almanac ALMNC-83.3 驗收 #1：提示詞功能關閉時，收件匣勾選一筆 Prompt 素材也不提供「整理成提示詞」（記錄本身照列）。
// 對照組把開關切成 true，證明同樣勾選後 harness 看得到「整理成提示詞」按鈕。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { create } from 'zustand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import type { Mark } from '@/db/marks'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})

const flag = vi.hoisted(() => ({ actual: undefined as boolean | undefined, value: undefined as boolean | undefined }))

vi.mock('@/lib/prompt-library/feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/prompt-library/feature')>()
  flag.actual = actual.PROMPT_LIBRARY_ENABLED
  return { get PROMPT_LIBRARY_ENABLED() { return flag.value ?? flag.actual } }
})
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) } }))

const promptDraft: Mark = { id: 7, tagId: 1, type: 'prompt-draft', content: '幫我寫週報的提示詞原文', url: '', deleted: 0, createdAt: Date.UTC(2026, 10, 24) }

vi.mock('@/stores/inbox', async () => {
  const { create: createStore } = await import('zustand')
  const store = createStore(() => ({
    visible: true, hide: () => {}, records: [] as Mark[], trashRecords: [] as Mark[], processed: new Map(),
    showProcessed: false, setShowProcessed: () => {}, trash: false, setTrash: () => {},
    focusedMarkId: null as number | null, setFocusedMarkId: () => {}, refresh: async () => {},
  }))
  return { default: store }
})
vi.mock('@/stores/mark', () => ({ default: create(() => ({ marks: [], allMarks: [] })) }))
vi.mock('@/stores/tag', () => ({ default: create(() => ({ tags: [], fetchTags: async () => {} })) }))
vi.mock('@/stores/article', () => ({ default: { getState: () => ({ activeFilePath: '', setActiveFilePath: async () => {}, loadFileTree: async () => {} }) } }))
vi.mock('@/lib/inbox/actions', () => ({
  addTagToRecords: vi.fn(), convertRecordsToNotes: vi.fn(), notifyRecordSaved: vi.fn(), restoreRecords: vi.fn(),
  setRecordsProcessed: vi.fn(), setRecordsUnprocessed: vi.fn(), trashRecords: vi.fn(),
}))
vi.mock('@/lib/editor-deactivation', () => ({ prepareActiveEditorPathMutationDurably: async () => true }))
vi.mock('../file/file-dnd', () => ({ moveFileManagerEntries: vi.fn() }))
vi.mock('../mark/mark-detail-panel', () => ({ MarkDetailPanel: () => null }))
vi.mock('../mark/organize-notes', () => ({ OrganizeNotes: () => null }))
vi.mock('../mark/organize-prompt-dialog', () => ({ OrganizePromptDialog: () => h('div', { 'data-marker': 'organize-prompt-dialog' }) }))
vi.mock('../sidebar-v3/section-tabs', () => ({ CollectTabs: () => null }))

const { InboxScreen } = await import('./inbox-screen')
const { default: useInboxStore } = await import('@/stores/inbox')

const ORGANIZE_INTO_PROMPT = zhTW.inbox.organizeIntoPrompt

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useInboxStore.setState({ records: [promptDraft] })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  flag.value = undefined
})

async function renderAndSelectPromptDraft() {
  await act(async () => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(InboxScreen) })))
  const checkbox = host.querySelector<HTMLButtonElement>(`[role="checkbox"][aria-label="${promptDraft.content}"]`)
  expect(checkbox).not.toBeNull()
  await act(async () => checkbox!.click())
  expect(checkbox!.getAttribute('aria-checked')).toBe('true')
}

const organizeIntoPromptButton = () => [...host.querySelectorAll('button')].find(button => button.textContent?.includes(ORGANIZE_INTO_PROMPT))

describe('ALMNC-83.3 inbox 整理成提示詞 follows PROMPT_LIBRARY_ENABLED', () => {
  it('the real feature flag is off', () => {
    expect(flag.actual).toBe(false)
  })

  it('a selected Prompt 素材 record offers 整理 but not 整理成提示詞', async () => {
    await renderAndSelectPromptDraft()
    expect(host.textContent).toContain(zhTW.inbox.organize)
    expect(host.textContent).toContain(zhTW.inbox.convert)
    expect(organizeIntoPromptButton()).toBeUndefined()
    expect(host.textContent).not.toContain(ORGANIZE_INTO_PROMPT)
  })

  it('control: with the flag on, the same selection shows 整理成提示詞', async () => {
    flag.value = true
    await renderAndSelectPromptDraft()
    expect(organizeIntoPromptButton()).toBeDefined()
  })
})

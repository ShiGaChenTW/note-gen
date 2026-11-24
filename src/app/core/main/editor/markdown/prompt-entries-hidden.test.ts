// @vitest-environment jsdom
// almanac ALMNC-83.3 驗收 #1：提示詞功能關閉時，Markdown 編輯器上方不顯示提示詞版本列（PromptVersionBanner）。
// 渲染真正的 MdEditor，TipTap 編輯器與版本列換成標記元素；對照組把開關切成 true，證明 harness 看得到版本列。
import React, { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../../messages/zh-TW.json'

await vi.hoisted(async () => { vi.stubGlobal('React', (await import('react')).default) })

const flag = vi.hoisted(() => ({ actual: undefined as boolean | undefined, value: undefined as boolean | undefined }))

vi.mock('@/lib/prompt-library/feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/prompt-library/feature')>()
  flag.actual = actual.PROMPT_LIBRARY_ENABLED
  return { get PROMPT_LIBRARY_ENABLED() { return flag.value ?? flag.actual } }
})
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }) } }))
vi.mock('./tiptap-editor', () => ({ TipTapEditor: () => h('div', { 'data-marker': 'tiptap-editor' }) }))
vi.mock('./outline', () => ({ Outline: () => null }))
vi.mock('./doc-title-field', () => ({ DocTitleField: () => null, focusEditorBodyStart: () => {} }))
vi.mock('./prompt-version-banner', () => ({
  PromptVersionBanner: ({ filePath }: { filePath: string }) => h('div', { 'data-marker': 'prompt-version-banner', 'data-path': filePath }),
}))
vi.mock('@/lib/editor-deactivation', () => ({
  editorPathsReferToSameFile: () => false,
  getCurrentEditorWorkspaceRoot: async () => null,
  prepareActiveEditorDeactivationDurably: async () => true,
  workspaceRootsReferToSameLocation: () => false,
}))
vi.mock('@/lib/self-hosted-sync/files', () => ({ writeSelfHostedWorkspaceText: async () => false }))
vi.mock('@/stores/article', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({
      saveCurrentArticle: async () => {}, isPulling: false, activeFilePath: 'Prompts/週報.md', currentArticle: '', justPulledFile: false,
      loading: false, setTabDisposition: () => {}, setCurrentArticle: () => {}, openTabs: [], aiGeneratingFilePath: null, aiTerminateFn: null,
    })),
  }
})
vi.mock('@/stores/setting', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({ enableOutline: false, outlinePosition: 'right', outlinePlacement: 'editor', workspacePath: '/vault' })),
    useSettingsHydrationStore: create(() => ({ status: 'ready' })),
  }
})
vi.mock('@/stores/sidebar', async () => {
  const { create } = await import('zustand')
  return { useSidebarStore: create(() => ({ leftSidebarVisible: true, leftSidebarTab: 'files', toggleLeftSidebar: async () => {} })) }
})
vi.mock('@/stores/active-note-editor', () => ({ useActiveNoteEditorStore: { getState: () => ({ register: () => () => {} }) } }))

const { MdEditor } = await import('./md-editor-wrapper')

const FILE = 'Prompts/週報.md'
const PROMPT_NOTE = '---\ntype: prompt\n---\n請幫我寫週報'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  flag.value = undefined
})

async function renderEditor() {
  const tabContentsRef = { current: { [FILE]: PROMPT_NOTE } as Record<string, string> }
  await act(async () => root.render(h(NextIntlClientProvider, {
    locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei',
    children: h(MdEditor, { tabContentsRef, filePath: FILE, isActive: true }),
  })))
  // 編輯器真的掛上了（不是停在載入中），版本列有沒有出現才有意義。
  expect(host.querySelector('[data-marker="tiptap-editor"]')).not.toBeNull()
}

const banner = () => host.querySelector('[data-marker="prompt-version-banner"]')

describe('ALMNC-83.3 prompt version banner follows PROMPT_LIBRARY_ENABLED', () => {
  it('the real feature flag is off', () => {
    expect(flag.actual).toBe(false)
  })

  it('a prompt note opens in the editor without the 提示詞版本 banner', async () => {
    await renderEditor()
    expect(banner()).toBeNull()
  })

  it('control: with the flag on, the banner is mounted for the same note', async () => {
    flag.value = true
    await renderEditor()
    expect(banner()?.getAttribute('data-path')).toBe(FILE)
  })
})

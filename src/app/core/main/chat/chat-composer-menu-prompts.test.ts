// @vitest-environment jsdom
// Fork（almanac ALMNC-81）：提示詞功能關閉時，對話輸入框的「/」選單不列出提示詞；指令照常列出。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import useVaultIndexStore from '@/stores/vault-index'
import type { IndexedNote } from '@/lib/vault-index/index-note'
import { PROMPT_LIBRARY_ENABLED } from '@/lib/prompt-library/feature'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  const memory = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) })
})

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/core/main', useSearchParams: () => new URLSearchParams() }))

const { ChatComposerMenu } = await import('./chat-composer-menu')

const prompt: IndexedNote = {
  path: 'Prompts/週報摘要.md', mtime: 1, frontmatter: { type: 'prompt' }, tasks: [], links: [], aliases: [], tags: [], headings: [], blockIds: [],
}

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

it('leaves prompts out of the / menu while the prompt feature is off', async () => {
  expect(PROMPT_LIBRARY_ENABLED).toBe(false)
  act(() => useVaultIndexStore.getState().replaceAll(new Map([[prompt.path, prompt]])))
  const noop = vi.fn()
  await act(async () => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(ChatComposerMenu, {
    mode: 'command', query: '', excludedItemKeys: new Set(), onClose: noop, onCommandSelect: noop, onFileSelect: noop, onFolderSelect: noop,
    onRecordSelect: noop, onCanvasSelect: noop, onSkillSelect: noop, onPromptSelect: noop,
  }) })))
  const text = document.body.textContent ?? ''
  expect(text).toContain(zhTW.record.chat.input.composerMenu.commands.summarize.label)
  expect(text).not.toContain('週報摘要')
  expect(text).not.toContain(zhTW.record.chat.input.composerMenu.prompts.title)
})

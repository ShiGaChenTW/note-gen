// @vitest-environment jsdom
// almanac ALMNC-83.3 驗收 #1：提示詞功能關閉時，記錄對話框的類型選單不列 Prompt 素材、⌘8（Windows Alt+8）不會選到它，
// 從托盤或外部指定 prompt-draft 開啟時改用自動判斷。unified-record-input.test.ts 測的是類型清單函式本身；這裡實際渲染對話框。
// 對照組把開關切成 true，證明同一套 harness 看得到 Prompt 素材、快捷鍵也選得到。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import common from '../../../../../messages/common/zh-TW.json'

await vi.hoisted(async () => { vi.stubGlobal('React', (await import('react')).default) })

const flag = vi.hoisted(() => ({ actual: undefined as boolean | undefined, value: undefined as boolean | undefined }))

vi.mock('@/lib/prompt-library/feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/prompt-library/feature')>()
  flag.actual = actual.PROMPT_LIBRARY_ENABLED
  return { get PROMPT_LIBRARY_ENABLED() { return flag.value ?? flag.actual } }
})
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
vi.mock('@/db/marks', () => ({ insertMark: vi.fn() }))
vi.mock('@/lib/link-capture', () => ({ captureLink: vi.fn() }))
vi.mock('@/lib/web-capture/images', () => ({ localizeCapturedImages: vi.fn(), removeLinkAssetGroup: vi.fn() }))
vi.mock('./use-record-completion', () => ({ useRecordCompletion: () => vi.fn() }))
vi.mock('./record-save-target', () => ({ RecordSaveTarget: () => null }))
vi.mock('./todo-form', () => ({ TodoForm: () => null }))
vi.mock('@/lib/workbench/actions', () => ({ addNewSource: vi.fn() }))
vi.mock('@/lib/workbench/open', () => ({ openAddSource: vi.fn(), openNewDocument: vi.fn(), openWorkbench: vi.fn() }))
vi.mock('@/lib/workbench/use-workbench', () => ({ useCommanderName: () => 'Leo' }))
vi.mock('@/stores/mark', () => ({ default: () => ({ addQueue: vi.fn(), setQueue: vi.fn(), removeQueue: vi.fn() }) }))
vi.mock('@/stores/recording', () => ({ default: () => ({ isRecording: false, recordingDuration: 0 }) }))
vi.mock('@/stores/setting', () => ({ default: Object.assign(() => ({}), { getState: () => ({ recordSaveTargetMode: 'current' }) }) }))
vi.mock('@/stores/tag', () => {
  const state = { currentTagId: 1, tags: [], fetchTags: async () => undefined, initTags: async () => undefined }
  return { default: Object.assign(() => state, { getState: () => state }) }
})
// V3 類型列是下拉選單，選項要點開才渲染；這裡把它換成直接列出收到的選項，看的是對話框實際交給它的清單。
vi.mock('./record-dialog-v3', async (importOriginal) => ({
  ...await importOriginal<typeof import('./record-dialog-v3')>(),
  V3TypeRow: ({ value, options }: { value: string; options: { value: string; label: string }[] }) =>
    h('ul', { 'data-testid': 'v3-type-options', 'data-value': value }, options.map(option => h('li', { key: option.value, 'data-value': option.value }, option.label))),
}))

const { UnifiedRecordDialog } = await import('./unified-record-dialog')
const { default: emitter } = await import('@/lib/emitter')
const { useUiModeStore } = await import('@/lib/fork-ui')

const PROMPT_DRAFT = messages.record.mark.type['prompt-draft']

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  flag.value = undefined
})

const flush = (ms = 0) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

async function openDialog(mode: 'v3' | 'classic', payload?: { type?: string }) {
  useUiModeStore.setState({ mode })
  await act(async () => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: { ...messages, common }, timeZone: 'Asia/Taipei', children: h(UnifiedRecordDialog) })))
  act(() => emitter.emit('unified-record-open', payload as never))
  await flush(60)
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
}

const classicSelect = () => document.body.querySelector<HTMLSelectElement>('[role="dialog"] select')!
const classicOptionValues = () => [...classicSelect().options].map(option => option.value)
const v3Options = () => document.body.querySelector<HTMLElement>('[data-testid="v3-type-options"]')!

// jsdom 的 navigator.platform 是空字串，對話框會走 Windows 的 Alt+數字。
function pressTypeShortcut(digit: string) {
  const dialog = document.body.querySelector('[role="dialog"]')!
  act(() => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: digit, code: `Digit${digit}`, altKey: true, bubbles: true })) })
}

describe('ALMNC-83.3 unified record dialog follows PROMPT_LIBRARY_ENABLED', () => {
  it('the real feature flag is off', () => {
    expect(flag.actual).toBe(false)
  })

  it('classic: the type select has no Prompt 素材 option', async () => {
    await openDialog('classic')
    expect(classicOptionValues()).toEqual(['auto', 'link', 'text', 'image', 'file', 'recording', 'scan', 'todo'])
    expect(classicSelect().textContent).not.toContain(PROMPT_DRAFT)
  })

  it('v3: the type menu receives no Prompt 素材 option', async () => {
    await openDialog('v3')
    const values = [...v3Options().querySelectorAll('li')].map(li => li.getAttribute('data-value'))
    expect(values).toEqual(['auto', 'link', 'text', 'image', 'file', 'recording', 'scan', 'todo'])
    expect(v3Options().textContent).not.toContain(PROMPT_DRAFT)
  })

  it('the 8th type shortcut selects nothing (7th still picks 待辦)', async () => {
    await openDialog('classic')
    pressTypeShortcut('8')
    expect(classicSelect().value).toBe('auto')
    pressTypeShortcut('7')
    expect(classicSelect().value).toBe('todo')
  })

  it('opening with type prompt-draft (tray menu / external caller) falls back to auto-detect', async () => {
    await openDialog('classic', { type: 'prompt-draft' })
    expect(classicSelect().value).toBe('auto')
    await act(async () => root.render(null))
    await openDialog('v3', { type: 'prompt-draft' })
    expect(v3Options().getAttribute('data-value')).toBe('auto')
  })

  it('control: with the flag on, Prompt 素材 is listed, the 8th shortcut picks it and an explicit open keeps it', async () => {
    flag.value = true
    await openDialog('classic')
    expect(classicOptionValues()).toContain('prompt-draft')
    pressTypeShortcut('8')
    expect(classicSelect().value).toBe('prompt-draft')
    await act(async () => root.render(null))
    await openDialog('v3', { type: 'prompt-draft' })
    expect(v3Options().textContent).toContain(PROMPT_DRAFT)
    expect(v3Options().getAttribute('data-value')).toBe('prompt-draft')
  })
})

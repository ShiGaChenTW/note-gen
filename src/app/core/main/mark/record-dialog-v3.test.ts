// @vitest-environment jsdom
// Fork（almanac ALMNC-56 重跑稽核）：新增資料源對話框——匯入 Email、會議逐字稿、訂閱 RSS 時顯示「處理中」並 disable 按鈕，
// 結束後焦點回到按下的按鈕；V3 的類型列用下拉選單（不用原生 select）、停止錄音鈕用 danger 色；classic 維持原樣。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import common from '../../../../../messages/common/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const fake = vi.hoisted(() => {
  let release: (value: unknown) => void = () => undefined
  return {
    importEmail: vi.fn(() => new Promise(resolve => { release = resolve })),
    release: (value: unknown) => release(value),
    subscribe: vi.fn(),
    recording: { isRecording: false, recordingDuration: 0 },
  }
})

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
vi.mock('@/db/marks', () => ({ insertMark: vi.fn() }))
vi.mock('@/lib/link-capture', () => ({ captureLink: vi.fn() }))
vi.mock('@/lib/web-capture/images', () => ({ localizeCapturedImages: vi.fn(), removeLinkAssetGroup: vi.fn() }))
vi.mock('./use-record-completion', () => ({ useRecordCompletion: () => vi.fn() }))
vi.mock('./record-save-target', () => ({ RecordSaveTarget: () => null }))
vi.mock('./todo-form', () => ({ TodoForm: () => null }))
vi.mock('@/lib/workbench/actions', () => ({ addNewSource: vi.fn() }))
vi.mock('@/lib/workbench/open', () => ({ openAddSource: vi.fn(), openWorkbench: vi.fn() }))
vi.mock('@/lib/workbench/use-workbench', () => ({ useCommanderName: () => 'Leo' }))
vi.mock('@/lib/source-import/rss-store', () => ({ default: { getState: () => ({ subscribe: fake.subscribe }) } }))
vi.mock('@/lib/source-import/import-files', () => ({
  DROP_EXTENSIONS: { email: ['eml'], meeting: ['vtt'] },
  MEETING_EXTENSIONS: ['vtt'],
  extensionOf: (name: string) => name.split('.').pop() ?? '',
  pickImportFiles: vi.fn(async () => [{ name: 'a.eml' }]),
  readDroppedFiles: vi.fn(async () => []),
  importEmailFiles: fake.importEmail,
  importMeetingFiles: vi.fn(),
}))
vi.mock('@/stores/mark', () => ({ default: () => ({ addQueue: vi.fn(), setQueue: vi.fn(), removeQueue: vi.fn() }) }))
vi.mock('@/stores/recording', () => ({ default: () => fake.recording }))
vi.mock('@/stores/setting', () => ({ default: Object.assign(() => ({}), { getState: () => ({ recordSaveTargetMode: 'current' }) }) }))
vi.mock('@/stores/tag', () => {
  const state = { currentTagId: 1, tags: [], fetchTags: async () => undefined, initTags: async () => undefined }
  return { default: Object.assign(() => state, { getState: () => state }) }
})

const { UnifiedRecordButton, UnifiedRecordDialog } = await import('./unified-record-dialog')
const { default: emitter } = await import('@/lib/emitter')

let container: HTMLDivElement
let root: Root

function render(node: ReturnType<typeof h>) {
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: { ...messages, common }, timeZone: 'Asia/Taipei', children: node })))
}

const button = (label: string) => [...document.body.querySelectorAll('button')].find(entry => entry.textContent?.trim() === label)
const flush = (ms = 0) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  useUiModeStore.setState({ mode: 'v3' })
  fake.recording.isRecording = false
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('新增資料源對話框（V3）', () => {
  it('匯入 Email 時顯示「正在匯入 Email…」並 disable 按鈕；結束後狀態列消失、焦點回到 Email 按鈕', async () => {
    render(h(UnifiedRecordDialog))
    act(() => emitter.emit('unified-record-open', { target: 'source' }))
    await flush(60)
    const email = button('Email')!
    email.focus()
    await act(async () => email.click())
    await flush()
    const status = document.body.querySelector('[data-testid="import-progress"]')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toBe('正在匯入 Email…')
    expect(document.body.querySelector('[role="dialog"]')!.getAttribute('aria-busy')).toBe('true')
    expect(button('Email')!.disabled).toBe(true)
    await act(async () => fake.release({ total: 0, added: 0, skipped: 0, duplicates: 0, dropped: 0 }))
    await flush(40)
    expect(document.body.querySelector('[data-testid="import-progress"]')).toBeNull()
    expect(button('Email')!.disabled).toBe(false)
    expect(document.activeElement).toBe(button('Email'))
  })

  it('類型列用 V3 下拉選單，不用原生 select', async () => {
    render(h(UnifiedRecordDialog))
    act(() => emitter.emit('unified-record-open', { target: 'source' }))
    await flush(60)
    expect(document.body.querySelector('[role="dialog"] select')).toBeNull()
    const row = document.body.querySelector('[data-testid="record-type-row"]')!
    expect(row.className).toContain('rounded-(--r)')
    expect(row.querySelector('[data-testid="record-type-trigger"]')!.getAttribute('aria-label')).toBe(messages.record.mark.unified.typeLabel)
  })

  it('classic 的類型列維持原生 select', async () => {
    useUiModeStore.setState({ mode: 'classic' })
    render(h(UnifiedRecordDialog))
    act(() => emitter.emit('unified-record-open'))
    await flush(60)
    expect(document.body.querySelector('[role="dialog"] select')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="record-type-row"]')).toBeNull()
  })
})

describe('錄音中的停止鈕', () => {
  it('V3 用 danger 色，classic 維持紅色', () => {
    fake.recording.isRecording = true
    render(h(UnifiedRecordButton, { target: 'source' }))
    const stop = () => container.querySelector(`button[aria-label="${messages.record.mark.unified.stopRecording}"]`)!
    expect(stop().className).toContain('text-danger')
    expect(stop().className).not.toContain('text-red-500')
    act(() => useUiModeStore.setState({ mode: 'classic' }))
    expect(stop().className).toContain('text-red-500')
  })
})

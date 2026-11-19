// @vitest-environment jsdom
import React, { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import messages from '../../../../messages/zh-TW.json'
import common from '../../../../messages/common/zh-TW.json'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useUiModeStore } from '@/lib/fork-ui'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { ModelSelect } from './chat/model-select'
import { UnifiedSyncStatus } from './unified-sync-status'
import { FileFooter } from './file/file-footer'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  vi.stubGlobal('localStorage', { getItem: () => null })
})

vi.mock('@/lib/workspace', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/workspace')>(),
  getDefaultArticleAbsolutePath: async () => '/test-workspace',
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/stores/sync-platform-switch', async importOriginal => ({
  ...await importOriginal<typeof import('@/stores/sync-platform-switch')>(),
  restorePlatformSwitchRecovery: async () => {},
}))
vi.mock('@/hooks/use-self-hosted-sync-status', () => ({
  useSelfHostedSyncStatus: () => ({ progress: null, refresh: () => {} }),
}))
vi.mock('@/hooks/use-self-hosted-note-conflicts', () => ({
  useSelfHostedNoteConflicts: () => ({ conflicts: [] }),
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  useUiModeStore.setState({ mode: 'v3' })
  useSettingsHydrationStore.setState({ status: 'error' })
  useSettingsDialogStore.setState({ open: false, activeSection: 'about' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(child: React.ReactElement) {
  const providerProps = {
    locale: 'zh-TW',
    messages: { ...messages, common },
    timeZone: 'Asia/Taipei',
    children: createElement(TooltipProvider, null, child),
  }
  act(() => root.render(createElement(NextIntlClientProvider, providerProps)))
  return host.querySelector('button')!
}

it('opens AI settings when the v3 status bar has no selected model', () => {
  useSettingStore.setState({ primaryModel: '', aiModelList: [] })
  const button = render(createElement(ModelSelect, { display: 'status' }))
  expect(button.textContent).toContain(messages.record.chat.input.modelSelect.noModel)
  act(() => button.click())
  expect(useSettingsDialogStore.getState()).toMatchObject({ open: true, activeSection: 'ai' })
})

it('opens sync settings directly when the v3 status bar cannot load sync configuration', () => {
  const button = render(createElement(UnifiedSyncStatus))
  expect(button.textContent).toContain(messages.syncOverview.configurationFailed)
  act(() => button.click())
  expect(useSettingsDialogStore.getState()).toMatchObject({ open: true, activeSection: 'sync' })
})

it('keeps the classic sync error trigger as a popover', () => {
  useUiModeStore.setState({ mode: 'classic' })
  const button = render(createElement(UnifiedSyncStatus))
  expect(button.getAttribute('aria-haspopup')).toBe('dialog')
  act(() => button.click())
  expect(useSettingsDialogStore.getState().open).toBe(false)
  expect(button.getAttribute('aria-expanded')).toBe('true')
})


it('describes the sync error and settings action when the status button receives focus', () => {
  const button = render(createElement(UnifiedSyncStatus))
  act(() => button.focus())
  const expected = messages.statusBar.settingsErrorHint.replace('{reason}', messages.syncOverview.configurationFailed)
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(expected)
})

it('still opens the sync popover through the error details button', () => {
  render(createElement(UnifiedSyncStatus))
  const details = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
  act(() => details.click())
  expect(details.getAttribute('aria-expanded')).toBe('true')
  expect(useSettingsDialogStore.getState().open).toBe(false)
})

it('links the workspace status to sync settings when configuration loading fails', async () => {
  const button = render(createElement(FileFooter))
  expect(button.textContent).toContain(messages.syncOverview.configurationFailed)
  await act(async () => button.click())
  expect(useSettingsDialogStore.getState()).toMatchObject({ open: true, activeSection: 'sync' })
})

it('keeps the status bar model picker when a configured model is selected', async () => {
  useSettingsHydrationStore.setState({ status: 'ready' })
  useSettingStore.setState({
    primaryModel: 'test-model',
    aiModelList: [{ key: 'test-model', title: 'Test provider', baseURL: 'https://example.test', model: 'Test model' }],
  })
  const button = render(createElement(ModelSelect, { display: 'status' }))
  expect(button.textContent).toContain('Test model')
  const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} })
  try {
    await act(async () => button.click())
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(useSettingsDialogStore.getState().open).toBe(false)
  } finally {
    if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

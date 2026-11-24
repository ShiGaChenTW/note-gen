// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import en from '../../../../../messages/en.json'

const ui = vi.hoisted(() => ({ v3: true }))
vi.mock('@/lib/fork-ui', () => ({ useUiV3: () => ui.v3 }))
vi.mock('@/stores/setting', () => ({
  default: () => ({
    editorContentWidth: 'wide',
    editorLineHeight: 'comfortable',
    setEditorContentWidth: vi.fn(),
    setEditorLineHeight: vi.fn(),
  }),
}))
vi.mock('next-intl', async importOriginal => {
  const { createTranslator } = await importOriginal<typeof import('next-intl')>()
  return {
    useTranslations: () => createTranslator({ locale: 'en', messages: { settings: en.settings }, namespace: 'settings.editor.layout' }),
  }
})

async function renderWidthOptions() {
  const { default: LayoutSettings } = await import('./layout-settings')
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(React.createElement(LayoutSettings)))
  const group = container.querySelector(`[aria-label="${en.settings.editor.layout.contentWidth.title}"]`)
  const labels = Array.from(group?.querySelectorAll('button') ?? []).map(button => button.textContent)
  await act(async () => root.unmount())
  container.remove()
  return labels
}

afterEach(() => {
  ui.v3 = true
})

it('新介面的編輯器設定只列工具列那三種寬度', async () => {
  const options = en.settings.editor.layout.contentWidth.options
  expect(await renderWidthOptions()).toEqual([options.narrow, options.wide, options.full])
})

it('舊介面照舊列四種寬度', async () => {
  ui.v3 = false
  const options = en.settings.editor.layout.contentWidth.options
  expect(await renderWidthOptions()).toEqual([options.narrow, options.standard, options.wide, options.full])
})

// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import en from '../../../../../messages/en.json'
import { useAutoAcceptSettings } from '@/lib/workbench/auto-accept-settings'
import { AutoAcceptSettings } from './auto-accept-settings'

const store = vi.hoisted(() => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
}))
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: async () => store } }))
vi.mock('@/lib/fork-ui', () => ({ useUiV3: () => true }))
vi.mock('next-intl', async importOriginal => {
  const { createTranslator } = await importOriginal<typeof import('next-intl')>()
  return {
    useTranslations: () => createTranslator({ locale: 'en', messages: { autoAcceptLinks: en.autoAcceptLinks }, namespace: 'autoAcceptLinks' }),
  }
})

it('在一般設定顯示預設開啟的開關，關閉時儲存偏好', async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  useAutoAcceptSettings.setState({ enabled: true, ready: false })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  try {
    await act(async () => root.render(React.createElement(AutoAcceptSettings)))
    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"]')!
    expect(container.querySelector(`label[for="${toggle.id}"]`)?.textContent).toBe(en.autoAcceptLinks.title)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.disabled).toBe(false)
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(store.set).toHaveBeenCalledWith('almanacAutoAcceptLinks', false)
    expect(store.save).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

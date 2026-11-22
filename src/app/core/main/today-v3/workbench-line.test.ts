// @vitest-environment jsdom
// Fork（almanac ALMNC-54.14）：今天頁「工作台 · N 件」——顯示件數（0 件不顯示），點了跳到工作台的審核分頁。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import en from '../../../../../messages/en.json'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => undefined, set: vi.fn(), save: vi.fn() }) },
}))

const useDecideStore = (await import('@/stores/decide')).default
const useWorkbenchStore = (await import('@/stores/workbench')).default
const { WorkbenchLine } = await import('./workbench-line')

let container: HTMLDivElement
let root: Root

function render(count: number, locale: 'zh-TW' | 'en' = 'zh-TW') {
  act(() => root.render(h(NextIntlClientProvider, { locale, messages: locale === 'en' ? en : messages, timeZone: 'Asia/Taipei', children: h(WorkbenchLine, { count }) })))
}
const line = () => container.querySelector<HTMLButtonElement>('[data-testid="today-v3-workbench"]')

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useDecideStore.setState({ visible: false })
  useWorkbenchStore.setState({ tab: 'sources' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('WorkbenchLine', () => {
  it('AC#3: shows 「工作台 · N 件」 with the workbench count (thousands grouped)', () => {
    render(5)
    expect(line()!.textContent).toBe('工作台 · 5 件')
    expect(line()!.getAttribute('aria-label')).toBe('打開工作台，5 件等你處理')
    render(1240)
    expect(line()!.textContent).toBe('工作台 · 1,240 件')
    render(3, 'en')
    expect(line()!.textContent).toBe('Workbench · 3')
  })

  it('hides when nothing is waiting (like 「N 項到期」 at 0)', () => {
    render(0)
    expect(line()).toBeNull()
  })

  it('AC#3: clicking jumps to the workbench review tab', () => {
    render(2)
    act(() => line()!.click())
    expect(useDecideStore.getState().visible).toBe(true)
    expect(useWorkbenchStore.getState().tab).toBe('review')
  })
})

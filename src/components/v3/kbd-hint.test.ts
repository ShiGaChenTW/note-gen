// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import messages from '../../../messages/zh-TW.json'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const { KbdHint } = await import('./kbd-hint')

it('renders Tab as a keycap and exposes the localized tooltip on focus', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const description = messages.record.chat.v3.mode.shortcut
  try {
    act(() => root.render(h(KbdHint, { description })))
    const key = container.querySelector('kbd')!
    expect(key.textContent).toBe('Tab')
    expect([...key.classList]).toEqual(expect.arrayContaining([
      'border-line', 'bg-transparent', 'text-[11px]', 'font-mono', 'text-muted-ink',
    ]))
    act(() => key.focus())
    const tooltip = document.getElementById(key.getAttribute('aria-describedby')!)
    expect(tooltip?.getAttribute('role')).toBe('tooltip')
    expect(tooltip?.textContent).toBe(description)
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})

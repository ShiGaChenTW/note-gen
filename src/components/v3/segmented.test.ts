// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const { Segmented } = await import('./segmented')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(kind: 'tabs' | 'mode', disabled = false) {
  function Fixture() {
    const [value, onChange] = useState('first')
    return createElement(Segmented, {
      kind, value, onChange, disabled, label: 'View',
      items: [
        { value: 'first', label: 'First' },
        { value: 'second', label: 'Unavailable', disabled: true },
        { value: 'last', label: 'Last' },
      ],
    })
  }
  act(() => root.render(createElement(Fixture)))
  return host.querySelectorAll('button')
}

function press(button: HTMLButtonElement, key: string) {
  act(() => button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
}

describe('Segmented', () => {
  it('moves focus across enabled tabs and activates on click', () => {
    const [first, unavailable, last] = render('tabs')
    expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('View')
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(unavailable.disabled).toBe(true)
    expect(last.tabIndex).toBe(-1)
    first.focus()
    press(first, 'ArrowRight')
    expect(document.activeElement).toBe(last)
    expect(first.getAttribute('aria-selected')).toBe('true')
    act(() => last.click())
    expect(last.getAttribute('aria-selected')).toBe('true')
    expect(last.tabIndex).toBe(0)
    press(last, 'ArrowRight')
    expect(document.activeElement).toBe(first)
  })

  it('selects the next enabled mode with the arrow keys', () => {
    const [first, , last] = render('mode')
    first.focus()
    press(first, 'ArrowLeft')
    expect(document.activeElement).toBe(last)
    expect(last.getAttribute('aria-pressed')).toBe('true')
    expect(first.tabIndex).toBe(-1)
  })

  it('disables every button when the whole switch is disabled', () => {
    const buttons = render('mode', true)
    expect([...buttons].every(button => button.disabled)).toBe(true)
  })

  it('hands focus to the next page tablist when a tab is activated from the keyboard', () => {
    // 模擬：點頁籤打開另一個畫面，新畫面帶著自己的一組頁籤重新掛載
    function Page({ page, go }: { page: string, go: (v: string) => void }) {
      return createElement(Segmented, {
        key: page, kind: 'tabs', value: page, onChange: go, label: 'Pages',
        items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      })
    }
    function Fixture() {
      const [page, go] = useState('a')
      return createElement(Page, { page, go })
    }
    act(() => root.render(createElement(Fixture)))
    const b = [...host.querySelectorAll('button')].find(button => button.textContent === 'B')!
    act(() => { b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })) })
    const active = document.activeElement as HTMLElement
    expect(active.textContent).toBe('B')
    expect(active.getAttribute('aria-selected')).toBe('true')
  })
})

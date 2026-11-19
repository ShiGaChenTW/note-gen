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
})

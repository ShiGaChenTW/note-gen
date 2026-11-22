// @vitest-environment jsdom
// almanac ALMNC-56.2 A11、V07：工具列共用按鈕與 roving tabindex。
import { act, createElement, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const { ToolbarIconButton, rovingTargetIndex, useRovingToolbar } = await import('./toolbar')

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

let setItems: (items: Array<{ label: string, disabled?: boolean }>) => void = () => {}

function render(initial: Array<{ label: string, disabled?: boolean }>) {
  function Fixture() {
    const ref = useRef<HTMLDivElement>(null)
    const [items, update] = useState(initial)
    setItems = update
    const roving = useRovingToolbar(ref)
    return createElement('div', { ref, role: 'toolbar', ...roving },
      ...items.map(item => createElement(ToolbarIconButton, { key: item.label, 'aria-label': item.label, disabled: item.disabled })))
  }
  act(() => root.render(createElement(Fixture)))
}

const buttons = () => [...host.querySelectorAll('button')]
const byLabel = (label: string) => buttons().find(button => button.getAttribute('aria-label') === label)!
const tabStops = () => buttons().filter(button => button.tabIndex === 0).map(button => button.getAttribute('aria-label'))

function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement as HTMLElement
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })) })
}

describe('rovingTargetIndex', () => {
  it('moves with the arrows, wraps at both ends and jumps with Home/End', () => {
    expect(rovingTargetIndex('ArrowRight', 0, 3)).toBe(1)
    expect(rovingTargetIndex('ArrowRight', 2, 3)).toBe(0)
    expect(rovingTargetIndex('ArrowLeft', 0, 3)).toBe(2)
    expect(rovingTargetIndex('Home', 2, 3)).toBe(0)
    expect(rovingTargetIndex('End', 0, 3)).toBe(2)
  })

  it('mirrors the arrows for right-to-left text and ignores other keys', () => {
    expect(rovingTargetIndex('ArrowRight', 1, 3, true)).toBe(0)
    expect(rovingTargetIndex('ArrowLeft', 1, 3, true)).toBe(2)
    expect(rovingTargetIndex('ArrowDown', 1, 3)).toBeNull()
    expect(rovingTargetIndex('Tab', 1, 3)).toBeNull()
    expect(rovingTargetIndex('ArrowRight', 0, 0)).toBeNull()
  })
})

describe('useRovingToolbar', () => {
  it('leaves a single tab stop and moves focus with the arrow keys, skipping disabled buttons', () => {
    render([{ label: 'a' }, { label: 'b', disabled: true }, { label: 'c' }, { label: 'd' }])
    expect(tabStops()).toEqual(['a'])
    byLabel('a').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(byLabel('c'))
    expect(tabStops()).toEqual(['c'])
    press('End')
    expect(document.activeElement).toBe(byLabel('d'))
    press('ArrowRight')
    expect(document.activeElement).toBe(byLabel('a'))
    press('ArrowLeft')
    expect(document.activeElement).toBe(byLabel('d'))
    press('Home')
    expect(document.activeElement).toBe(byLabel('a'))
  })

  it('keeps modified arrows for the browser and other handlers', () => {
    render([{ label: 'a' }, { label: 'b' }])
    byLabel('a').focus()
    press('ArrowRight', { shiftKey: true })
    press('ArrowRight', { metaKey: true })
    expect(document.activeElement).toBe(byLabel('a'))
  })

  it('remembers the last focused button and falls back when it goes away', () => {
    render([{ label: 'a' }, { label: 'b' }, { label: 'c' }])
    act(() => byLabel('b').focus())
    expect(tabStops()).toEqual(['b'])
    act(() => setItems([{ label: 'a' }, { label: 'b', disabled: true }, { label: 'c' }]))
    expect(tabStops()).toEqual(['a'])
    act(() => setItems([{ label: 'x', disabled: true }, { label: 'c' }]))
    expect(tabStops()).toEqual(['c'])
  })
})

describe('ToolbarIconButton', () => {
  it('shares one shape, hover and focus ring, and only sets aria-pressed for toggles', () => {
    act(() => root.render(createElement('div', null,
      createElement(ToolbarIconButton, { 'aria-label': 'plain' }),
      createElement(ToolbarIconButton, { 'aria-label': 'toggle', pressed: true }),
      createElement(ToolbarIconButton, { 'aria-label': 'menu', active: true }),
    )))
    const [plain, toggle, menu] = buttons()
    for (const button of [plain, toggle, menu]) {
      expect(button.type).toBe('button')
      expect(button.className).toContain('size-7')
      expect(button.className).toContain('rounded-md')
      expect(button.className).toContain('enabled:hover:bg-hover')
      expect(button.className).toContain('focus-visible:ring-1')
    }
    expect(plain.hasAttribute('aria-pressed')).toBe(false)
    expect(plain.className).not.toContain('bg-active')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.className).toContain('bg-active')
    expect(menu.hasAttribute('aria-pressed')).toBe(false)
    expect(menu.className).toContain('bg-active')
  })
})

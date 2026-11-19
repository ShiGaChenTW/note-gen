// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const { SectionLabel } = await import('./section-label')
const { Count } = await import('./count')
const { EmptyState } = await import('./empty-state')
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  root = createRoot(host)
})

afterEach(() => act(() => root.unmount()))

function render(node: ReactNode) {
  act(() => root.render(node))
  return host.firstElementChild
}

describe('v3 primitives', () => {
  it('keeps mixed Chinese labels untracked and preserves the trailing slot', () => {
    const label = render(createElement(SectionLabel, {
      underline: true, trailing: createElement(Count, { value: 4 }),
    }, '我的 Inbox'))
    expect(label?.textContent).toBe('我的 Inbox4')
    expect(label?.querySelector('span')?.classList.contains('tracking-normal')).toBe(true)
    expect(label?.querySelector('span')?.classList.contains('uppercase')).toBe(false)
    expect(label?.classList.contains('border-b')).toBe(true)
  })

  it('opts into Latin typography explicitly', () => {
    const label = render(createElement(SectionLabel, { latin: true }, 'Inbox'))
    expect(label?.querySelector('span')?.classList.contains('tracking-[0.08em]')).toBe(true)
    expect(label?.querySelector('span')?.classList.contains('uppercase')).toBe(true)
  })

  it('hides zero by default and gives an explicit zero no background', () => {
    expect(render(createElement(Count, { value: 0 }))).toBeNull()
    const zero = render(createElement(Count, { value: 0, showZero: true, emphasis: true }))
    expect(zero?.textContent).toBe('0')
    expect(zero?.classList.contains('text-ui-numeric')).toBe(true)
    expect(zero?.classList.contains('text-faint')).toBe(true)
    expect(zero?.classList.contains('bg-hover')).toBe(false)
    expect(zero?.classList.contains('font-semibold')).toBe(false)
  })

  it('renders a top-aligned message, icon and action', () => {
    const Icon = ({ className }: { className?: string }) => createElement('svg', { className, 'aria-hidden': true })
    const state = render(createElement(EmptyState, {
      icon: Icon, text: '尚無筆記',
      action: createElement('button', { type: 'button' }, '新增'),
    }))
    expect(state?.classList.contains('text-ui-compact')).toBe(true)
    expect(state?.classList.contains('items-start')).toBe(true)
    expect(state?.classList.contains('justify-start')).toBe(true)
    expect(state?.querySelector('svg')?.classList.contains('size-4')).toBe(true)
    expect([...state!.querySelectorAll('p')].map(p => p.textContent)).toEqual(['尚無筆記'])
    expect(state?.querySelector('button')?.textContent).toBe('新增')
  })
})

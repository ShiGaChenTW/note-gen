// @vitest-environment jsdom
import React, { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DateCell } from './date-navigation'

it('combines today, selection and content independently in a date cell', () => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    act(() => root.render(createElement(DateCell, { day: '19', today: true, selected: true, hasContent: true })))
    const cell = host.querySelector('button')!
    expect(cell.classList).toContain('bg-invert')
    expect(cell.classList).toContain('text-invert-ink')
    expect(cell.classList).toContain('tabular-nums')
    expect(cell.getAttribute('aria-current')).toBe('date')
    expect(cell.querySelector('[data-date-number]')?.classList).toContain('font-bold')
    expect(cell.querySelector('[data-date-today]')?.classList).toContain('bg-current')
    expect(cell.querySelector('[data-date-content]')?.classList).toContain('bg-current')
    act(() => root.render(createElement(DateCell, { day: '20' })))
    expect(cell.classList).not.toContain('bg-invert')
    expect(cell.getAttribute('aria-current')).toBeNull()
    expect(cell.querySelector('[data-date-today]')?.classList).not.toContain('bg-current')
    expect(cell.querySelector('[data-date-content]')?.classList).not.toContain('bg-current')
  } finally {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  }
})

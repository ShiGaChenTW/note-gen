// @vitest-environment jsdom
// Fork（almanac ALMNC-56.7，RPT-2026-009 A07）：中欄筆記清單可以用關閉鈕或 Esc 收起；中間面板從夠寬變成窄於 640 px 時自動收起。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'
import { crossedBelow, NOTE_LIST_COLLAPSE_PX, useNoteListStore } from '@/lib/note-list/note-list'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

vi.mock('@/stores/article', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ activeFilePath: '', setActiveFilePath: vi.fn(async () => {}) })) }
})
vi.mock('@/stores/note-marks', async () => {
  const { create } = await import('zustand')
  const none: string[] = []
  return { default: create(() => ({ load: async () => {} })), selectWorkspaceMarks: () => none }
})
vi.mock('@/stores/setting', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({ workspacePath: '' })) }
})
vi.mock('../sidebar-v3/use-vault-name', () => ({ useVaultName: () => 'MyVault' }))

const { NoteListColumn } = await import('./note-list-column')

let observed: { callback: ResizeObserverCallback, target: Element | null }
class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) { observed = { callback, target: null } }
  observe(target: Element) { observed.target = target }
  unobserve() {}
  disconnect() {}
}

function resize(width: number) {
  act(() => observed.callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver))
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  useUiModeStore.setState({ mode: 'v3' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => useNoteListStore.getState().show(''))
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h('div', { 'data-testid': 'center' }, h(NoteListColumn)) })))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  act(() => useNoteListStore.getState().hide())
})

const list = () => container.querySelector<HTMLElement>('[data-note-list]')

describe('A07: closing the note list', () => {
  it('closes with the header close button', () => {
    const close = container.querySelector<HTMLButtonElement>('[data-testid="note-list-close"]')!
    expect(close.getAttribute('aria-label')).toBe('關閉筆記清單')
    act(() => close.click())
    expect(useNoteListStore.getState().visible).toBe(false)
    expect(list()).toBeNull()
  })

  it('closes with Esc from inside the list', () => {
    const close = container.querySelector<HTMLButtonElement>('[data-testid="note-list-close"]')!
    close.focus()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => { close.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(useNoteListStore.getState().visible).toBe(false)
  })

  it('collapses when the centre panel shrinks below 640 px (e.g. the right sidebar opens)', () => {
    expect(observed.target).toBe(container.querySelector('[data-testid="center"]'))
    resize(900)
    resize(700)
    expect(useNoteListStore.getState().visible).toBe(true)
    resize(600)
    expect(useNoteListStore.getState().visible).toBe(false)
  })

  it('stays open when opened while the panel is already narrow', () => {
    resize(560)
    resize(540)
    expect(useNoteListStore.getState().visible).toBe(true)
  })
})

describe('crossedBelow', () => {
  it('fires only when the width goes from ≥ threshold to < threshold', () => {
    expect(NOTE_LIST_COLLAPSE_PX).toBe(640)
    expect(crossedBelow(null, 500)).toBe(false)
    expect(crossedBelow(800, 700)).toBe(false)
    expect(crossedBelow(640, 639)).toBe(true)
    expect(crossedBelow(900, 400)).toBe(true)
    expect(crossedBelow(500, 400)).toBe(false)
    expect(crossedBelow(400, 900)).toBe(false)
  })
})

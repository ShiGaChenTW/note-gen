// @vitest-environment jsdom
// Fork（almanac ALMNC-56.7，RPT-2026-009 A07）：中欄筆記清單可以用關閉鈕或 Esc 收起；中間面板從夠寬變成窄於 640 px 時自動收起。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import { useUiModeStore } from '@/lib/fork-ui'
import { crossedBelow, NOTE_LIST_COLLAPSE_PX, useNoteListStore } from '@/lib/note-list/note-list'
import useVaultIndexStore from '@/stores/vault-index'
import type { IndexedNote } from '@/lib/vault-index/index-note'

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

// 清單虛擬化（ALMNC-56.3 P03）後 @tanstack/react-virtual 也會建 ResizeObserver：記下全部，找觀察中間面板的那一個。
let observers: { callback: ResizeObserverCallback, targets: Element[] }[] = []
class FakeResizeObserver {
  private entry: { callback: ResizeObserverCallback, targets: Element[] }
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: [] }
    observers.push(this.entry)
  }
  observe(target: Element) { this.entry.targets.push(target) }
  unobserve() {}
  disconnect() {}
}

const centerPanel = () => container.querySelector('[data-testid="center"]')!
const panelObserver = () => observers.find(entry => entry.targets.includes(centerPanel()))

function resize(width: number) {
  act(() => panelObserver()!.callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver))
}

let container: HTMLDivElement
let root: Root

// jsdom 沒有版面：給捲動區一個高度，虛擬清單才畫得出看得到的那幾列。
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!

beforeEach(() => {
  observers = []
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 })
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
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
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
    expect(panelObserver()).toBeDefined()
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

// ALMNC-56.3 P03：清單虛擬化；自動存檔只把存檔的那一則搬到最上面。
describe('P03: virtualised list with incremental updates', () => {
  const note = (path: string, mtime: number) => ({ path, mtime }) as unknown as IndexedNote
  const titles = () => [...container.querySelectorAll('[data-note-list] li button span:first-child')].map(node => node.textContent)

  afterEach(() => act(() => useVaultIndexStore.getState().reset('')))

  it('renders only the rows near the viewport, not the whole vault', () => {
    const notes = new Map(Array.from({ length: 400 }, (_, index) => [`n${index}.md`, note(`n${index}.md`, 1000 + index)] as const))
    act(() => useVaultIndexStore.getState().replaceAll(notes))
    const rows = container.querySelectorAll('[data-note-list] li')
    expect(container.querySelector('[data-note-list] header span')?.textContent).toBe('400')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(50)
    expect(rows[0].getAttribute('aria-setsize')).toBe('400')
    expect(titles()[0]).toBe('n399')
  })

  it('moves an autosaved note to the top through the vault change log', () => {
    act(() => useVaultIndexStore.getState().replaceAll(new Map([
      ['a.md', note('a.md', 100)], ['b.md', note('b.md', 200)], ['c.md', note('c.md', 300)],
    ])))
    expect(titles()).toEqual(['c', 'b', 'a'])
    act(() => useVaultIndexStore.getState().upsert([note('a.md', 400)]))
    expect(useVaultIndexStore.getState().changeLog.at(-1)).toMatchObject({ upserted: ['a.md'], removed: [] })
    expect(titles()).toEqual(['a', 'c', 'b'])
    act(() => useVaultIndexStore.getState().remove(['c.md']))
    expect(titles()).toEqual(['a', 'b'])
  })
})

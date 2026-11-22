// @vitest-environment jsdom
// Fork（almanac ALMNC-56.7，RPT-2026-009 A12）：今天頁窄於 1000 px 時，右欄（等你定、今天收進來）接在中欄下方，不再整欄隱藏。
// jsdom 不算 container query，這裡檢查版面結構與窄版的 class。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import { buildTodayLayout } from '@/lib/today-v3/layout'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const NOW = new Date('2026-11-22T10:00:00')

vi.mock('./use-today-v3-data', () => ({
  useTodayV3Data: () => ({
    now: NOW, day: NOW, dayKey: '2026-11-22', viewingToday: true, tasks: [], todayPath: '20261122.md', dayPath: '20261122.md',
    noteKeys: new Set<string>(), journalExists: false, calendarAccess: 'authorized',
    layout: buildTodayLayout({ now: NOW, journalContent: null, dailyNote: null, tasks: [], events: [], decisions: [], captures: [] }),
  }),
}))
vi.mock('../today/use-today-actions', () => ({ useTodayActions: () => ({ busy: new Set(), toggleTask: vi.fn(), openNote: vi.fn() }) }))
vi.mock('@/lib/timeslots/use-pending-slots', () => ({ usePendingSlots: () => [] }))
vi.mock('@/lib/decide/use-decisions', () => ({ useDecisions: () => [] }))
vi.mock('../decide/decide-parts', () => ({ useDecideActions: () => ({ busy: null, accept: vi.fn(), reject: vi.fn() }) }))
vi.mock('@/lib/workbench/use-workbench', () => ({ useWorkbenchCount: () => 0 }))
vi.mock('./composer', () => ({ TodayComposer: () => null }))
vi.mock('./date-strip', () => ({ DateStrip: () => null }))

const { TodayV3Screen } = await import('./today-v3-screen')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(TodayV3Screen) })))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('A12: the right rail follows the centre column inside one narrow-width scroll area, instead of being hidden', () => {
  const main = container.querySelector<HTMLElement>('[data-testid="today-v3-main"]')!
  const center = container.querySelector<HTMLElement>('[data-testid="today-v3-center"]')!
  const right = container.querySelector<HTMLElement>('[data-testid="today-v3-right"]')!
  // 中欄在前、右欄在後，同一個容器
  expect([...main.children]).toEqual([center, right])
  expect(right.querySelector('[data-testid="today-v3-decide"]')).not.toBeNull()
  expect(right.querySelector('[data-testid="today-v3-captures"]')).not.toBeNull()
  // 寬版：容器 display: contents，兩欄照舊是格線的兩欄
  expect(main.className.split(' ')).toContain('contents')
  // 窄版：容器變成一欄一起捲動，右欄不再隱藏
  expect(main.className).toContain('@max-[1000px]:block')
  expect(main.className).toContain('@max-[1000px]:overflow-y-auto')
  expect(right.className).not.toMatch(/@max-\[1000px\]:hidden/)
  expect(right.className).toContain('@max-[1000px]:overflow-visible')
  expect(center.className).toContain('@max-[1000px]:overflow-visible')
})

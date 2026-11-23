// @vitest-environment jsdom
// Fork（almanac ALMNC-79.4）：今天頁參考圖風格——行程是圓角色塊、日誌目前段落淡底、不用左側線條；
// 右側清單「圖示＋標題＋類型」、圖示不加方塊底；今天要完成是 6px 卡片；週列選中日浮起。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import { buildTodayLayout, type CaptureLike } from '@/lib/today-v3/layout'
import type { DecideItem } from '@/lib/decide/project'
import { collectTasks } from '@/lib/vault-index/index-core'
import { indexNote } from '@/lib/vault-index/index-note'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const NOW = new Date(2026, 10, 24, 9, 0)
const at = (hour: number, minute = 0) => new Date(2026, 10, 24, hour, minute).getTime()
const tasks = collectTasks([indexNote('Daily/2026-11-24.md', [
  '- [x] 回覆設計組 📅 2026-11-24 ✅ 2026-11-24',
  '- [ ] 交 Q4 預算表初稿 📅 2026-11-24 ⏰ 15:00',
].join('\n'), 1)])
const decision = (key: string, kind: DecideItem['kind']): DecideItem => ({
  key, source: 'collect', kind, title: `提案 ${key}`, origin: '收集', summary: '', when: '', at: 0,
  preview: { type: 'newNote', diff: { context: [], removed: [], added: [], hidden: 0 } },
  duplicates: [], ref: { source: 'collect', itemId: key, proposalId: key }, status: 'wait',
} as DecideItem)
const captures: CaptureLike[] = [
  { id: 'c1', createdAt: at(8, 30), state: 'ready', input: { kind: 'link', text: 'https://lean.test' } },
]
const layout = buildTodayLayout({
  now: NOW,
  journalContent: '預算表的數字要先對過。\n\n今天先把 Q4 的欄位確認完。',
  dailyNote: null,
  tasks,
  events: [{ id: 'e1', title: '規格討論', start: at(13), end: at(14, 20), allDay: false, calendar: 'Work' }],
  decisions: [decision('d1', 'note'), decision('d2', 'event')],
  captures,
})

vi.mock('./use-today-v3-data', () => ({
  useTodayV3Data: () => ({
    now: NOW, day: NOW, dayKey: '2026-11-24', viewingToday: true, tasks, todayPath: '20261124.md', dayPath: '20261124.md',
    noteKeys: new Set<string>(), journalExists: true, calendarAccess: 'authorized', layout,
  }),
}))
vi.mock('../today/use-today-actions', () => ({ useTodayActions: () => ({ busy: new Set(), toggleTask: vi.fn(), openNote: vi.fn() }) }))
vi.mock('@/lib/timeslots/use-pending-slots', () => ({ usePendingSlots: () => [] }))
vi.mock('@/lib/decide/use-decisions', () => ({ useDecisions: () => [] }))
vi.mock('../decide/decide-parts', () => ({ useDecideActions: () => ({ busy: null, accept: vi.fn(), reject: vi.fn() }) }))
vi.mock('@/lib/workbench/use-workbench', () => ({ useWorkbenchCount: () => 2 }))
vi.mock('./composer', () => ({ TodayComposer: () => null }))
vi.mock('./date-strip', () => ({ DateStrip: () => null }))

const { TodayV3Screen } = await import('./today-v3-screen')
const { DateCell } = await import('@/components/v3/date-navigation')

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

it('draws timeline blocks as rounded fills with no side line, time on its own line when tall', () => {
  const blocks = [...container.querySelectorAll<HTMLElement>('[data-testid="today-v3-timeline"] [data-kind]')]
  expect(blocks.length).toBeGreaterThan(0)
  for (const block of blocks) {
    expect(block.className).toContain('rounded-(--r-row)')
    expect(block.className).not.toMatch(/(^|\s)border(-l)?(-\d)?(\s|$)/)
  }
  const meeting = blocks.find(block => block.textContent?.includes('規格討論'))!
  expect(meeting.querySelector('.font-mono')!.className).toContain('block')
})

it('marks the current journal paragraph with a soft fill instead of a left line', () => {
  const paragraphs = [...container.querySelectorAll<HTMLElement>('[data-testid="today-v3-journal"] p')]
  expect(paragraphs).toHaveLength(2)
  expect(paragraphs[1].className).toContain('bg-hover')
  expect(paragraphs.every(p => !p.className.includes('border-l'))).toBe(true)
})

it('puts today\'s tasks in a 6px card with hairline separators', () => {
  const list = container.querySelector<HTMLElement>('[data-testid="today-v3-todo"] ul')!
  expect(list.className).toContain('rounded-(--r-md)')
  expect(list.className).toContain('divide-y')
  expect(list.querySelectorAll('li')).toHaveLength(2)
})

it('lists workbench items and captures as icon + title + kind rows without icon tiles', () => {
  const decide = [...container.querySelectorAll<HTMLElement>('[data-testid="today-v3-decide"] button')].filter(button => button.textContent?.includes('提案'))
  expect(decide).toHaveLength(2)
  for (const row of decide) {
    const icons = row.querySelectorAll('svg')
    expect(icons).toHaveLength(2) // 類型圖示＋右側箭頭
    expect(icons[0].parentElement).toBe(row) // 圖示直接在列上，沒有包方塊底
    expect(row.textContent).toContain('收集')
  }
  const capture = container.querySelector<HTMLElement>('[data-testid="today-v3-captures"] svg')!.parentElement!
  expect(capture.textContent).toContain('https://lean.test')
  expect(capture.textContent).toContain(zhTW.todayV3.captures.kind.link)
})

it('raises the selected day in the week strip', () => {
  act(() => root.render(h(DateCell, { day: '24', weekday: '二', selected: true })))
  expect(container.querySelector('button')!.className).toContain('v3:selected-raised')
})

// @vitest-environment jsdom
// Fork（almanac ALMNC-56.4，RPT-2026-009 A05）：時間軸提案的收下／不要按鈕夠大、間距夠，讀屏名稱帶上提案標題。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import zhTW from '../../../../../messages/zh-TW.json'
import type { TimelineProposal, TimelineView } from '@/lib/today-v3/layout'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const { HOUR_PX, PROPOSAL_MIN_PX, Timeline } = await import('./timeline')

let container: HTMLDivElement
let root: Root

const view: TimelineView = { startHour: 6, endHour: 24, allDay: [], entries: [], nowMin: null, nowTime: '' }
const proposal = (key: string, title: string, startMin: number, endMin: number): TimelineProposal =>
  ({ key, title, startMin, endMin, time: '09:00', end: '09:30' })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(proposals: TimelineProposal[], onAccept = vi.fn(), onReject = vi.fn()) {
  act(() => root.render(h(NextIntlClientProvider, {
    locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei',
    children: h(Timeline, { view, dayKey: '2026-11-22', onOpenTask: vi.fn(), noAccess: false, proposals, onAccept, onReject }),
  })))
  return { onAccept, onReject }
}

it('A05: proposal buttons are at least 24px tall with an 8px gap, named after the proposal', () => {
  const { onAccept, onReject } = render([proposal('p1', '週會準備', 9 * 60, 9 * 60 + 30), proposal('p2', '回信給廠商', 14 * 60, 15 * 60)])
  const blocks = [...container.querySelectorAll<HTMLElement>('[data-testid="today-v3-proposal"]')]
  expect(blocks).toHaveLength(2)
  const [first, second] = blocks.map(block => [...block.querySelectorAll('button')])
  for (const button of [...first, ...second]) expect(button.className).toContain('min-h-6')
  expect(first[0].parentElement!.className).toContain('gap-2')
  // 多個提案的按鈕讀屏名稱不再重複
  expect(first.map(button => button.getAttribute('aria-label'))).toEqual(['收下「週會準備」', '不要「週會準備」'])
  expect(second.map(button => button.getAttribute('aria-label'))).toEqual(['收下「回信給廠商」', '不要「回信給廠商」'])
  // 看得到的字照舊
  expect(first.map(button => button.textContent)).toEqual(['收下', '不要'])
  act(() => first[0].click())
  act(() => second[1].click())
  expect(onAccept).toHaveBeenCalledWith('p1')
  expect(onReject).toHaveBeenCalledWith('p2')
})

it('A05: a 30-minute proposal block is tall enough for the label, title and 24px buttons', () => {
  render([proposal('p1', '週會準備', 9 * 60, 9 * 60 + 30)])
  const block = container.querySelector<HTMLElement>('[data-testid="today-v3-proposal"]')!
  expect(Number.parseFloat(block.style.height)).toBe(PROPOSAL_MIN_PX)
  expect(PROPOSAL_MIN_PX).toBeGreaterThan(HOUR_PX / 2)
  expect(PROPOSAL_MIN_PX).toBeGreaterThanOrEqual(10 + 2 + 16 + 16 + 4 + 24)
})

it('has the named-action string in all three locales', () => {
  for (const messages of [zhTW, zh, en]) expect(messages.todayV3.timeline.namedAction).toMatch(/\{action\}.*\{title\}/)
})

// @vitest-environment jsdom
// Fork（almanac ALMNC-79.5）：知識報告抽屜的引文在 V3 用淡底，不用左側線條；classic 照舊。
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../../messages/zh-TW.json'

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  const memory = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) })
})

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/core/main', useSearchParams: () => new URLSearchParams() }))
vi.mock('./report-card', () => ({
  LevelBadge: () => null,
  useStartReport: () => ({ start: vi.fn(), running: false }),
  useLatestReport: () => ({
    path: '報告/2026-11.md',
    report: {
      generated: '', period: '2026-11', tokens: 100, suggestions: [],
      topics: [{
        name: '精實', level: 2, prevLevel: null, gap: null, comment: '', remark: '', score: 1, noteCount: 1,
        folders: [], mocs: [], notes: [], tags: [],
        evidence: [{ quote: '先找出瓶頸', path: '閱讀/七大浪費.md' }],
      }],
    },
  }),
}))

const { ReportDrawer } = await import('./report-drawer')
const { useKnowledgeReportStore } = await import('@/lib/knowledge-report')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('shows evidence quotes on a soft fill in V3 instead of a left line', () => {
  act(() => useKnowledgeReportStore.setState({ drawer: 'latest' } as never))
  act(() => root.render(h(NextIntlClientProvider, { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: h(ReportDrawer) })))
  const quote = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('先找出瓶頸'))!
  expect(quote).toBeTruthy()
  expect(quote.className).toContain('v3:border-l-0')
  expect(quote.className).toContain('v3:bg-hover')
})

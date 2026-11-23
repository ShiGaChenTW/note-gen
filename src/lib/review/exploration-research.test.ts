import { expect, it, vi } from 'vitest'
import { explorationWeek, researchExplorationSources } from './research'

it('每週跨領域最多 3 則，重複網址不占用額度，手動再跑同一週只補餘額', async () => {
  const urls = new Set(['https://example.org/known'])
  let used = 1
  const deps = {
    lookup: vi.fn(async (query: string) => [
      { title: '已登錄', url: 'https://example.org/known', snippet: '' },
      ...[1, 2, 3, 4].map(n => ({ title: '資料', url: `https://example.org/${encodeURIComponent(query)}/${n}`, snippet: '' })),
    ]),
    count: async () => used,
    register: vi.fn(async ({ url }: { url: string }) => {
      if (urls.has(url)) return false
      urls.add(url)
      used++
      return true
    }),
  }
  const topics = [{ name: '生態', questions: ['棲地？', '濕地？'] }, { name: '地理', questions: ['地形？'] }]
  const now = new Date(2026, 10, 23, 9)
  expect(await researchExplorationSources(topics, deps, now, 3)).toBe(2)
  expect(used).toBe(3)
  const calls = deps.lookup.mock.calls.length
  expect(await researchExplorationSources(topics, deps, now, 3)).toBe(0)
  expect(deps.lookup).toHaveBeenCalledTimes(calls)
  used = 0
  expect(await researchExplorationSources(topics, deps, new Date(2026, 10, 30, 9), 1)).toBe(1)
})

it('週期依本地日期由星期一零時開始', () => {
  expect(explorationWeek(new Date(2026, 10, 29, 22))).toEqual({
    start: new Date(2026, 10, 23).getTime(), end: new Date(2026, 10, 30).getTime(),
  })
})

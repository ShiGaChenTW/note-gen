// Fork（almanac ALMNC-92）：指揮官查到的外部資料——從工具結果取證據、同一份資料不重複比對、包裝工具收集證據。
import { describe, expect, it, vi } from 'vitest'
import type { AgentTool } from '@/lib/agent/types'
import { collectFetchedEvidence, evidenceFromToolResult, evidenceKey, memorySeen, mergeEvidence, storeSeen, type FetchedItem } from './fetched'

const search = {
  ok: true,
  message: '找到 2 個來源',
  data: {
    query: '節拍時間',
    provider: 'native',
    sources: [
      { title: '新版標準', url: 'https://example.com/std', snippet: '節拍時間改為 45 秒' },
      { title: '沒網址', url: 'javascript:alert(1)', snippet: 'x' },
      { title: '', url: 'https://example.com/b', snippet: '' },
    ],
  },
}
const page = { ok: true, message: '已讀取', data: { title: '新版標準（全文）', url: 'https://example.com/std#top', content: '全文：節拍時間改為 45 秒。' } }

describe('evidenceFromToolResult', () => {
  it('takes title, url and snippet from web_search sources, skipping non-http urls', () => {
    expect(evidenceFromToolResult('web_search', search)).toEqual([
      { title: '新版標準', url: 'https://example.com/std', snippet: '節拍時間改為 45 秒' },
      { title: 'https://example.com/b', url: 'https://example.com/b', snippet: '' },
    ])
  })

  it('takes the page text from web_read_page', () => {
    expect(evidenceFromToolResult('web_read_page', page)).toEqual([{ title: '新版標準（全文）', url: 'https://example.com/std#top', snippet: '全文：節拍時間改為 45 秒。' }])
  })

  it('ignores failed calls and tools that do not fetch external data', () => {
    expect(evidenceFromToolResult('web_search', { ok: false, message: 'off', error: 'WEB_SEARCH_FAILED' })).toEqual([])
    expect(evidenceFromToolResult('knowledge_search', search)).toEqual([])
    expect(evidenceFromToolResult('mcp_call_tool', page)).toEqual([])
  })
})

describe('mergeEvidence', () => {
  it('keeps one item per url, prefers the page that was read and puts read pages first', () => {
    const items: FetchedItem[] = [
      ...evidenceFromToolResult('web_search', search).map(evidence => ({ evidence, read: false })),
      ...evidenceFromToolResult('web_read_page', page).map(evidence => ({ evidence, read: true })),
    ]
    expect(mergeEvidence(items).map(item => item.title)).toEqual(['新版標準（全文）', 'https://example.com/b'])
    expect(mergeEvidence(items, 1)).toHaveLength(1)
    expect(evidenceKey({ url: 'https://Example.com/std/#top' })).toBe(evidenceKey({ url: 'https://example.com/std' }))
  })
})

describe('seen evidence', () => {
  it('claims each key once; released keys can be claimed again', async () => {
    const seen = memorySeen()
    expect(await seen.claim(['a', 'b', 'a'])).toEqual(['a', 'b'])
    expect(await seen.claim(['a', 'c'])).toEqual(['c'])
    await seen.release(['c'])
    expect(await seen.claim(['c'])).toEqual(['c'])
  })

  it('persists in the store, keeps only the newest keys, and serializes concurrent claims', async () => {
    const data = new Map<string, unknown>()
    const store = { get: async (key: string) => data.get(key), set: async (key: string, value: unknown) => { data.set(key, value) } }
    const seen = storeSeen(store, 'k', 3)
    const [first, second] = await Promise.all([seen.claim(['a', 'b']), seen.claim(['b', 'c'])])
    expect([first, second]).toEqual([['a', 'b'], ['c']])
    await seen.claim(['d'])
    expect(data.get('k')).toEqual(['b', 'c', 'd'])
    expect(await storeSeen(store, 'k', 3).claim(['a', 'd'])).toEqual(['a'])
  })
})

describe('collectFetchedEvidence', () => {
  const tool = (name: string, result: unknown): AgentTool => ({
    name, title: name, description: '', category: 'web', risk: 'read', inputSchema: { type: 'object' }, execute: vi.fn(async () => result as never),
  })

  it('passes results through unchanged and collects evidence only from successful web tools', async () => {
    const collect = vi.fn()
    const notes = tool('knowledge_search', search)
    const [wrapped, failed, other] = collectFetchedEvidence([tool('web_search', search), tool('web_read_page', { ok: false, message: 'blocked' }), notes], collect)
    const context = { runId: 'r', context: { userInput: '' } }
    expect(await wrapped.execute({ query: '節拍' }, context)).toBe(search)
    await failed.execute({ url: 'https://x.test' }, context)
    await other.execute({}, context)
    expect(other).toBe(notes)
    expect(collect).toHaveBeenCalledTimes(1)
    expect(collect.mock.calls[0][0]).toEqual([
      { evidence: expect.objectContaining({ url: 'https://example.com/std' }), read: false },
      { evidence: expect.objectContaining({ url: 'https://example.com/b' }), read: false },
    ])
  })
})

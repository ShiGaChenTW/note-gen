// almanac ALMNC-46：稍後讀清單的去重與狀態流轉（待送 → 已送電子紙 → 放回待送；擷取失敗 → 無法擷取）。
import { describe, expect, it, vi } from 'vitest'
import {
  addReadLater, applyExtraction, extractPending, isBriefingCandidate, markReadLaterSent, needsExtraction, normalizeReadLater,
  normalizeReadLaterUrl, pickDailyArticles, removeReadLater, requeueReadLater, retryReadLater,
  type ExtractionOutcome, type ReadLaterItem,
} from './read-later'

const T = Date.UTC(2026, 10, 21)
const ok = (title: string): ExtractionOutcome => ({ ok: true, title, author: '作者', content: `${title} 正文`, images: ['https://e.com/a.jpg'] })

function withItems(...urls: string[]): ReadLaterItem[] {
  return urls.reduce<ReadLaterItem[]>((items, url, index) => addReadLater(items, url, T + index).items, [])
}

describe('normalizeReadLaterUrl（同一網址不重複）', () => {
  it('去掉 #片段、追蹤參數、結尾斜線，主機轉小寫；沒寫協定補 https', () => {
    expect(normalizeReadLaterUrl('https://Example.com/post/1/?utm_source=x&id=2#top')).toBe('https://example.com/post/1?id=2')
    expect(normalizeReadLaterUrl('example.com/a')).toBe('https://example.com/a')
    expect(normalizeReadLaterUrl('https://example.com:443/a?fbclid=1')).toBe('https://example.com/a')
  })

  it('不是 http(s) 文章連結回傳 null', () => {
    expect(normalizeReadLaterUrl('')).toBeNull()
    expect(normalizeReadLaterUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeReadLaterUrl('ftp://example.com/a')).toBeNull()
    expect(normalizeReadLaterUrl('not a url')).toBeNull()
  })
})

describe('addReadLater／removeReadLater', () => {
  it('加入後是待送、還沒擷取；同一網址（正規化後）不重複加入', () => {
    const first = addReadLater([], 'https://example.com/a?utm_medium=x', T)
    expect(first).toMatchObject({ result: 'added', url: 'https://example.com/a' })
    expect(first.items).toEqual([{ url: 'https://example.com/a', addedAt: T, status: 'pending' }])
    expect(needsExtraction(first.items[0])).toBe(true)
    const again = addReadLater(first.items, 'https://EXAMPLE.com/a/#x', T + 1)
    expect(again.result).toBe('duplicate')
    expect(again.items).toHaveLength(1)
    expect(addReadLater(first.items, 'nope', T).result).toBe('invalid')
  })

  it('移除', () => {
    expect(removeReadLater(withItems('https://e.com/a', 'https://e.com/b'), 'https://e.com/a').map(item => item.url)).toEqual(['https://e.com/b'])
  })
})

describe('擷取結果', () => {
  it('成功：仍是待送、存下標題作者正文圖片，可以進簡報', () => {
    const [item] = applyExtraction(withItems('https://e.com/a'), 'https://e.com/a', ok('甲'), T + 9)
    expect(item).toEqual({
      url: 'https://e.com/a', addedAt: T, status: 'pending', title: '甲', author: '作者', content: '甲 正文', images: ['https://e.com/a.jpg'], extractedAt: T + 9,
    })
    expect(isBriefingCandidate(item)).toBe(true)
  })

  it('失敗：標成無法擷取並記原因，不進簡報', () => {
    for (const reason of ['paywall', 'summary-only', 'unreachable'] as const) {
      const [item] = applyExtraction(withItems('https://e.com/a'), 'https://e.com/a', { ok: false, reason }, T + 9)
      expect(item).toMatchObject({ status: 'unextractable', error: reason, extractedAt: T + 9 })
      expect(item.content).toBeUndefined()
      expect(isBriefingCandidate(item)).toBe(false)
    }
  })

  it('只套用在還在等擷取的那則（已送出或已擷取的不被覆蓋）', () => {
    const extracted = applyExtraction(withItems('https://e.com/a'), 'https://e.com/a', ok('甲'), T)
    expect(applyExtraction(extracted, 'https://e.com/a', { ok: false, reason: 'unreachable' }, T + 1)).toEqual(extracted)
  })
})

describe('送出與放回待送', () => {
  const extracted = () => applyExtraction(withItems('https://e.com/a', 'https://e.com/b'), 'https://e.com/a', ok('甲'), T)

  it('送出：有正文的待送文章移到已送電子紙；還沒擷取的不動', () => {
    const items = markReadLaterSent(extracted(), ['https://e.com/a', 'https://e.com/b'], T + 50)
    expect(items[0]).toMatchObject({ status: 'sent', sentAt: T + 50 })
    expect(items[1].status).toBe('pending')
  })

  it('已送電子紙的可以放回待送（保留正文，清掉送出時間）', () => {
    const sent = markReadLaterSent(extracted(), ['https://e.com/a'], T + 50)
    const [item] = requeueReadLater(sent, 'https://e.com/a')
    expect(item.status).toBe('pending')
    expect(item.sentAt).toBeUndefined()
    expect(item.content).toBe('甲 正文')
    expect(isBriefingCandidate(item)).toBe(true)
  })

  it('放回待送只對已送的有效；無法擷取的用重新擷取回到待送', () => {
    const failed = applyExtraction(withItems('https://e.com/a'), 'https://e.com/a', { ok: false, reason: 'paywall' }, T)
    expect(requeueReadLater(failed, 'https://e.com/a')).toEqual(failed)
    const [retried] = retryReadLater(failed, 'https://e.com/a')
    expect(retried).toEqual({ url: 'https://e.com/a', addedAt: T, status: 'pending' })
    expect(needsExtraction(retried)).toBe(true)
  })
})

describe('pickDailyArticles（每日精選文章）', () => {
  it('最早存的先送、最多 3 篇；無法擷取、還沒擷取、已送的都跳過', () => {
    let items = withItems('https://e.com/1', 'https://e.com/2', 'https://e.com/3', 'https://e.com/4', 'https://e.com/5', 'https://e.com/6')
    items = applyExtraction(items, 'https://e.com/1', { ok: false, reason: 'paywall' }, T)
    for (const url of ['https://e.com/2', 'https://e.com/4', 'https://e.com/5', 'https://e.com/6']) items = applyExtraction(items, url, ok(url), T)
    items = markReadLaterSent(items, ['https://e.com/2'], T)
    expect(pickDailyArticles(items).map(item => item.url)).toEqual(['https://e.com/4', 'https://e.com/5', 'https://e.com/6'])
    expect(pickDailyArticles([])).toEqual([])
  })
})

describe('extractPending（一篇失敗不擋其他篇）', () => {
  it('依序擷取；擷取函式丟錯的那篇標成連不上，其他照常', async () => {
    let items = withItems('https://e.com/a', 'https://e.com/b', 'https://e.com/c')
    const extract = vi.fn(async (url: string): Promise<ExtractionOutcome> => {
      if (url.endsWith('/a')) throw new Error('offline')
      if (url.endsWith('/b')) return { ok: false, reason: 'summary-only' }
      return ok('丙')
    })
    const updates: number[] = []
    await extractPending(() => items, extract, next => { items = next; updates.push(next.length) }, () => T + 1)
    expect(extract).toHaveBeenCalledTimes(3)
    expect(items.map(item => [item.status, item.error])).toEqual([
      ['unextractable', 'unreachable'], ['unextractable', 'summary-only'], ['pending', undefined],
    ])
    expect(pickDailyArticles(items).map(item => item.url)).toEqual(['https://e.com/c'])
    expect(updates).toEqual([3, 3, 3])
  })

  it('擷取期間被移除的文章不會被加回來', async () => {
    let items = withItems('https://e.com/a', 'https://e.com/b')
    await extractPending(() => items, async url => {
      if (url.endsWith('/a')) items = removeReadLater(items, 'https://e.com/b')
      return ok(url)
    }, next => { items = next })
    expect(items.map(item => item.url)).toEqual(['https://e.com/a'])
  })
})

describe('normalizeReadLater（從 store.json 讀回）', () => {
  it('丟掉壞資料與重複網址，依存入時間排序；無法擷取一定帶原因', () => {
    expect(normalizeReadLater([
      { url: 'https://e.com/b', addedAt: 2, status: 'sent', sentAt: 5, content: 'x', extractedAt: 3 },
      { url: 'https://e.com/a', addedAt: 1, status: 'unextractable' },
      { url: 'https://e.com/a/', addedAt: 9, status: 'pending' },
      { url: 'bad', addedAt: 1 },
      { addedAt: 1 },
    ])).toEqual([
      { url: 'https://e.com/a', addedAt: 1, status: 'unextractable', error: 'unreachable' },
      { url: 'https://e.com/b', addedAt: 2, status: 'sent', sentAt: 5, content: 'x', extractedAt: 3 },
    ])
    expect(normalizeReadLater('junk')).toEqual([])
  })
})

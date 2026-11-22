// Fork（almanac ALMNC-57.2）：RSS 2.0、Atom、RSS 1.0 解析，feed 自動探索、字元集、去重鍵、資料源內容。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decodeFeedBytes, discoverFeedLinks, looksLikeFeedUrl, NotAFeedError, parseFeed, rssItemKey, rssItemSourceContent, rssSourceInputs,
} from './rss'

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8')
}

const TAIPEI = 8 * 60

describe('parseFeed：RSS 2.0', () => {
  const feed = parseFeed(fixture('rss2.xml'), 'https://ie.example.com/feed.xml')

  it('feed 標題（實體已解開）與網站連結', () => {
    expect(feed).toMatchObject({ format: 'rss', title: '工業工程週報 & 筆記', link: 'https://ie.example.com/' })
    expect(feed.items).toHaveLength(3)
  })

  it('CDATA 標題裡的 HTML 轉成文字；摘要的 HTML（CDATA 或跳脫過的）轉成純文字', () => {
    const [first, second] = feed.items
    expect(first).toMatchObject({
      guid: 'https://ie.example.com/posts/5s',
      link: 'https://ie.example.com/posts/5s',
      title: '精實生產的 5S：整理先於整頓',
      published: Date.UTC(2026, 10, 20, 0, 0),
      author: 'Scott',
      summary: '5S 的第一步是整理：把不需要的東西拿掉。\n\n第二段 & 更多。',
    })
    expect(second).toMatchObject({ guid: '1042', title: '看板（Kanban）的 WIP 上限', summary: 'WIP 上限讓流程可見。', published: Date.UTC(2026, 10, 18, 9, 30) })
  })

  it('相對連結轉成完整網址；沒有 description 時用 content:encoded', () => {
    expect(feed.items[1].link).toBe('https://ie.example.com/posts/wip')
    expect(feed.items[2]).toMatchObject({ link: 'https://ie.example.com/posts/no-guid', summary: '只有 content:encoded 的內文。' })
    expect(feed.items[2].guid).toBeUndefined()
  })
})

describe('parseFeed：Atom', () => {
  const feed = parseFeed(fixture('atom.xml'), 'https://blog.example.org/atom.xml')

  it('feed 標題、alternate 連結', () => {
    expect(feed).toMatchObject({ format: 'atom', title: 'Example Blog', link: 'https://blog.example.org/' })
  })

  it('entry：id 當 guid、rel=alternate 連結（xml:base 解相對路徑）、published 優先、作者、type=html 摘要；<source> 裡的欄位不會混進來', () => {
    expect(feed.items[0]).toEqual({
      guid: 'tag:blog.example.org,2026:queues',
      link: 'https://blog.example.org/2026/11/queues',
      title: 'Queues <and> flow',
      published: Date.UTC(2026, 10, 21, 1, 0),
      summary: "Little's law: L = λW.",
      author: 'Amy Lin',
    })
  })

  it('沒有 published 用 updated；xhtml 內容轉成文字', () => {
    expect(feed.items[1]).toMatchObject({ title: 'Second entry', published: Date.UTC(2026, 10, 19, 12), summary: 'XHTML content.' })
  })
})

describe('parseFeed：其他', () => {
  it('RSS 1.0（RDF）：rdf:about 當 guid', () => {
    const xml = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel rdf:about="https://r.example/"><title>RDF Feed</title><link>https://r.example/</link></channel>
      <item rdf:about="https://r.example/a"><title>A</title><link>https://r.example/a</link><dc:date>2026-11-20T00:00:00Z</dc:date><description>aaa</description></item>
    </rdf:RDF>`
    const feed = parseFeed(xml)
    expect(feed).toMatchObject({ format: 'rdf', title: 'RDF Feed' })
    expect(feed.items[0]).toMatchObject({ guid: 'https://r.example/a', link: 'https://r.example/a', published: Date.UTC(2026, 10, 20), summary: 'aaa' })
  })

  it('沒跳脫好的 & 這種小錯照樣解析（不用嚴格的 XML 解析器）', () => {
    const feed = parseFeed('<rss><channel><title>A & B</title><item><title>Tom & Jerry</title><link>https://x.example/1?a=1&b=2</link></item></channel></rss>')
    expect(feed.title).toBe('A & B')
    expect(feed.items[0]).toMatchObject({ title: 'Tom & Jerry', link: 'https://x.example/1?a=1&b=2' })
  })

  it('不是 feed（HTML 網頁）丟 NotAFeedError', () => {
    expect(() => parseFeed(fixture('page-with-feed.html'))).toThrow(NotAFeedError)
  })
})

describe('discoverFeedLinks', () => {
  it('找出網頁宣告的 RSS／Atom feed，轉成完整網址', () => {
    expect(discoverFeedLinks(fixture('page-with-feed.html'), 'https://ie.example.com/blog/')).toEqual([
      'https://ie.example.com/feed.xml',
      'https://ie.example.com/atom.xml',
    ])
  })
})

describe('decodeFeedBytes', () => {
  it('Content-Type 的 charset 優先，其次 XML 宣告（Big5 feed）', () => {
    const big5 = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="big5"?><rss><channel><title>'), 0xa4, 0xa4, 0xa4, 0xe5, ...new TextEncoder().encode('</title></channel></rss>')])
    expect(parseFeed(decodeFeedBytes(big5)).title).toBe('中文')
    expect(parseFeed(decodeFeedBytes(big5, 'application/rss+xml; charset=big5')).title).toBe('中文')
    expect(decodeFeedBytes(new TextEncoder().encode('﻿<rss/>'), 'text/xml')).toBe('<rss/>')
  })
})

describe('去重鍵與資料源', () => {
  const feedUrl = 'https://ie.example.com/feed.xml'

  it('guid 有 scheme（網址、tag:、urn:）直接用；只是編號的加上 feed 網址；沒有 guid 用連結；都沒有用雜湊', () => {
    expect(rssItemKey(feedUrl, { guid: 'https://ie.example.com/posts/5s', title: '', summary: '' })).toBe('https://ie.example.com/posts/5s')
    expect(rssItemKey(feedUrl, { guid: 'tag:blog.example.org,2026:queues', title: '', summary: '' })).toBe('tag:blog.example.org,2026:queues')
    expect(rssItemKey(feedUrl, { guid: '1042', link: 'https://x/1', title: '', summary: '' })).toBe(`${feedUrl}#1042`)
    expect(rssItemKey(feedUrl, { link: 'https://ie.example.com/posts/no-guid', title: '', summary: '' })).toBe('https://ie.example.com/posts/no-guid')
    expect(rssItemKey(feedUrl, { title: 'x', summary: '' })).toMatch(new RegExp(`^${feedUrl}#[0-9a-f]{8}$`))
  })

  it('資料源內容：第一行標題，接著連結、發佈時間、作者、來源，空一行後摘要；來處是文章連結', () => {
    const [item] = parseFeed(fixture('rss2.xml'), feedUrl).items
    expect(rssItemSourceContent(item, '工業工程週報', TAIPEI)).toBe([
      '精實生產的 5S：整理先於整頓',
      '',
      '連結：https://ie.example.com/posts/5s',
      '發佈時間：2026-11-20 08:00',
      '作者：Scott',
      '來源：工業工程週報',
      '',
      '5S 的第一步是整理：把不需要的東西拿掉。\n\n第二段 & 更多。',
    ].join('\n'))
    expect(rssSourceInputs({ url: feedUrl, name: '工業工程週報' }, [item], TAIPEI)[0]).toMatchObject({
      id: 'src_rss:https://ie.example.com/posts/5s', kind: 'rss', origin: 'https://ie.example.com/posts/5s',
    })
  })

  it('looksLikeFeedUrl：只是提示用', () => {
    expect(looksLikeFeedUrl('https://ie.example.com/feed.xml')).toBe(true)
    expect(looksLikeFeedUrl('https://example.com/rss')).toBe(true)
    expect(looksLikeFeedUrl('https://example.com/blog/atom/')).toBe(true)
    expect(looksLikeFeedUrl('https://example.com/article/hello')).toBe(false)
    expect(looksLikeFeedUrl('not a url')).toBe(false)
  })
})

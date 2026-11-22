// Fork（almanac ALMNC-57.2）：RSS 2.0／RSS 1.0（RDF）／Atom 解析 → 每篇文章一則外部資料源（標題、連結、發佈時間、摘要）。
// 規格：almanac/2026-11-22_proposal_data-entry-email-rss-meeting.md §2。全文由指揮官分析時用既有的網頁擷取抓（to-text.ts 的 rss）。
// 不用 DOMParser：真實世界的 feed 常有沒跳脫的 & 之類的小錯，嚴格的 XML 解析會整個失敗；這裡用寬鬆的標籤比對。全是純函式。
import { clipText, decodeCharset, decodeEntities, formatDateTime, htmlToText, parseDate, stableHash } from './text'

export interface FeedItem {
  guid?: string
  link?: string
  title: string
  /** 發佈時間（毫秒）。 */
  published?: number
  /** 純文字摘要（HTML 已轉成文字，最多 SUMMARY_MAX 字）。 */
  summary: string
  author?: string
}

export interface ParsedFeed {
  format: 'rss' | 'atom' | 'rdf'
  title: string
  link?: string
  items: FeedItem[]
}

export const SUMMARY_MAX = 1000

export class NotAFeedError extends Error {
  readonly code = 'not_feed'
  constructor() {
    super('not an RSS or Atom feed')
    this.name = 'NotAFeedError'
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 標籤內文：CDATA 段落原樣保留，其他部分解 XML 實體。 */
function textOf(raw: string): string {
  let out = ''
  let last = 0
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g
  for (let match = re.exec(raw); match; match = re.exec(raw)) {
    out += decodeEntities(raw.slice(last, match.index)) + match[1]
    last = re.lastIndex
  }
  return out + decodeEntities(raw.slice(last))
}

interface Tag {
  attrs: string
  inner: string
}

function findTags(block: string, name: string): Tag[] {
  const escaped = escapeRegExp(name)
  const re = new RegExp(`<${escaped}(\\s[^>]*?)?(?:\\/>|>([\\s\\S]*?)<\\/${escaped}\\s*>)`, 'gi')
  const tags: Tag[] = []
  for (let match = re.exec(block); match; match = re.exec(block)) tags.push({ attrs: match[1] ?? '', inner: match[2] ?? '' })
  return tags
}

function findTag(block: string, names: readonly string[]): Tag | undefined {
  for (const name of names) {
    const tag = findTags(block, name)[0]
    if (tag) return tag
  }
  return undefined
}

function attrOf(attrs: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs)
  const value = match ? match[1] ?? match[2] : undefined
  return value === undefined ? undefined : decodeEntities(value)
}

/** 標題：純文字；Atom 的 type="html"／"xhtml"，或裡面還有 HTML 標籤（沒跳脫好的），就當 HTML 轉成文字。 */
function plainTitle(tag: Tag | undefined): string {
  if (!tag) return ''
  const text = textOf(tag.inner)
  const html = /^(html|xhtml)$/i.test(attrOf(tag.attrs, 'type') ?? '') || /<[a-zA-Z][^>]*>/.test(text)
  const plain = html ? htmlToText(text) : text
  return plain.replace(/\s+/g, ' ').trim()
}

function summaryOf(tag: Tag | undefined): string {
  if (!tag) return ''
  return clipText(htmlToText(textOf(tag.inner)), SUMMARY_MAX)
}

function resolveUrl(href: string | undefined, base: string | undefined): string | undefined {
  const value = href?.trim()
  if (!value) return undefined
  try {
    return new URL(value, base || undefined).href
  } catch {
    return /^https?:\/\//i.test(value) ? value : undefined
  }
}

function itemBlocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'gi')
  const blocks: string[] = []
  for (let match = re.exec(xml); match; match = re.exec(xml)) blocks.push(match[0])
  return blocks
}

function rssItem(block: string, base: string | undefined): FeedItem {
  const guidTag = findTag(block, ['guid'])
  const guid = guidTag ? textOf(guidTag.inner).trim() : attrOf(/^<item\b([^>]*)>/i.exec(block)?.[1] ?? '', 'rdf:about')
  const linkTag = findTag(block, ['link'])
  const permalink = guidTag && attrOf(guidTag.attrs, 'isPermaLink')?.toLowerCase() !== 'false' && /^https?:\/\//i.test(guid ?? '') ? guid : undefined
  const link = resolveUrl(linkTag ? textOf(linkTag.inner) || attrOf(linkTag.attrs, 'href') : permalink, base)
  const published = parseDate(textOf(findTag(block, ['pubDate', 'dc:date', 'published', 'updated'])?.inner ?? ''))
  const author = plainTitle(findTag(block, ['dc:creator', 'author']))
  return {
    ...(guid ? { guid } : {}),
    ...(link ? { link } : {}),
    title: plainTitle(findTag(block, ['title'])),
    ...(published !== undefined ? { published } : {}),
    summary: summaryOf(findTag(block, ['description', 'content:encoded', 'summary'])),
    ...(author ? { author } : {}),
  }
}

function atomLink(block: string, base: string | undefined): string | undefined {
  const links = findTags(block, 'link').map(tag => ({ rel: (attrOf(tag.attrs, 'rel') ?? 'alternate').toLowerCase(), type: attrOf(tag.attrs, 'type') ?? '', href: attrOf(tag.attrs, 'href') }))
  const best = links.find(link => link.rel === 'alternate' && (!link.type || /html/i.test(link.type)))
    ?? links.find(link => link.rel === 'alternate')
    ?? links[0]
  return resolveUrl(best?.href, base)
}

function atomEntry(raw: string, feedBase: string | undefined): FeedItem {
  // <source> 是轉載來源的資訊，裡面也有 title／id／link，先拿掉。
  const block = raw.replace(/<source\b[\s\S]*?<\/source\s*>/gi, '')
  const base = resolveUrl(attrOf(/^<entry\b([^>]*)>/i.exec(block)?.[1] ?? '', 'xml:base'), feedBase) ?? feedBase
  const guid = textOf(findTag(block, ['id'])?.inner ?? '').trim()
  const link = atomLink(block, base)
  const published = parseDate(textOf(findTag(block, ['published', 'updated', 'issued', 'modified'])?.inner ?? ''))
  const authorTag = findTag(block, ['author'])
  const author = authorTag ? plainTitle(findTag(authorTag.inner, ['name'])) : ''
  return {
    ...(guid ? { guid } : {}),
    ...(link ? { link } : {}),
    title: plainTitle(findTag(block, ['title'])),
    ...(published !== undefined ? { published } : {}),
    summary: summaryOf(findTag(block, ['summary', 'content'])),
    ...(author ? { author } : {}),
  }
}

/** 解析 feed；不是 RSS／Atom 就丟 NotAFeedError。feedUrl 用來把相對連結轉成完整網址。 */
export function parseFeed(xml: string, feedUrl?: string): ParsedFeed {
  const text = xml.replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '')
  if (/<feed[\s>]/i.test(text) && !/<rss[\s>]/i.test(text)) {
    const header = text.split(/<entry\b/i)[0]
    const feedBase = resolveUrl(attrOf(/<feed\b([^>]*)>/i.exec(text)?.[1] ?? '', 'xml:base'), feedUrl) ?? feedUrl
    const link = atomLink(header, feedBase)
    return {
      format: 'atom',
      title: plainTitle(findTag(header, ['title'])),
      ...(link ? { link } : {}),
      items: itemBlocks(text, 'entry').map(block => atomEntry(block, feedBase)),
    }
  }
  const rdf = /<rdf:RDF[\s>]/i.test(text)
  if (rdf || /<rss[\s>]/i.test(text) || /<channel[\s>]/i.test(text)) {
    const channel = findTag(text, ['channel'])
    const header = (channel?.inner ?? text).split(/<item\b/i)[0]
    const linkTag = findTag(header, ['link'])
    const link = resolveUrl(linkTag ? textOf(linkTag.inner) : undefined, feedUrl)
    return {
      format: rdf ? 'rdf' : 'rss',
      title: plainTitle(findTag(header, ['title'])),
      ...(link ? { link } : {}),
      items: itemBlocks(text, 'item').map(block => rssItem(block, link ?? feedUrl)),
    }
  }
  throw new NotAFeedError()
}

/** HTML 網頁裡宣告的 feed（<link rel="alternate" type="application/rss+xml|atom+xml">），轉成完整網址。 */
export function discoverFeedLinks(html: string, pageUrl: string): string[] {
  const links: string[] = []
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1]
    const rel = (attrOf(attrs, 'rel') ?? '').toLowerCase().split(/\s+/)
    const type = (attrOf(attrs, 'type') ?? '').toLowerCase()
    if (!rel.includes('alternate') || !/application\/(rss|atom)\+xml|application\/rdf\+xml/.test(type)) continue
    const href = resolveUrl(attrOf(attrs, 'href'), pageUrl)
    if (href && !links.includes(href)) links.push(href)
  }
  return links
}

/** 回應的位元組 → 文字：Content-Type 的 charset 優先，其次 <?xml encoding="…"?>，都沒有就 UTF-8。 */
export function decodeFeedBytes(bytes: Uint8Array, contentType?: string | null): string {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1]
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 200))
  const fromXml = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1]
  return decodeCharset(bytes, fromHeader ?? fromXml ?? 'utf-8').replace(/^﻿/, '')
}

/** 看起來像 feed 的網址（路徑或查詢裡有 rss、atom、feed、.xml）。只用來提示，訂閱時仍以實際內容為準。 */
export function looksLikeFeedUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    if (!/^https?:$/.test(url.protocol)) return false
    return /(^|[/._-])(rss|atom|feeds?)([/._-]|$)|\.xml$|\.rdf$/i.test(`${url.pathname}${url.search}`)
  } catch {
    return false
  }
}

/**
 * 去重鍵：guid（看起來是全域唯一的——網址、urn:、tag: 這種有 scheme 的——直接用；只是編號的加上 feed 網址），
 * 沒有 guid 用連結，連結也沒有就用標題＋時間的雜湊。
 */
export function rssItemKey(feedUrl: string, item: FeedItem): string {
  const guid = item.guid?.trim()
  if (guid) return /^[a-z][a-z0-9+.-]*:/i.test(guid) ? guid : `${feedUrl}#${guid}`
  if (item.link) return item.link
  return `${feedUrl}#${stableHash(`${item.title}|${item.published ?? ''}`)}`
}

export function rssItemSourceId(feedUrl: string, item: FeedItem): string {
  return `src_rss:${rssItemKey(feedUrl, item)}`
}

/** 資料源內容：第一行標題，接著連結、發佈時間、來源（訂閱名稱），空一行後是摘要。offsetMinutes 給測試固定時區用。 */
export function rssItemSourceContent(item: FeedItem, feedName: string, offsetMinutes?: number): string {
  const meta = [
    item.link && `連結：${item.link}`,
    item.published !== undefined && `發佈時間：${formatDateTime(item.published, offsetMinutes)}`,
    item.author && `作者：${item.author}`,
    feedName && `來源：${feedName}`,
  ].filter(Boolean)
  return [item.title || item.link || '（沒有標題）', '', ...meta, ...(item.summary ? ['', item.summary] : [])].join('\n')
}

/** 新文章 → 要寫進資料源表的內容；來處是文章連結（指揮官分析時抓全文），沒有連結就用 feed 網址。 */
export function rssSourceInputs(feed: { url: string, name: string }, items: readonly FeedItem[], offsetMinutes?: number): Array<{ id: string, kind: 'rss', content: string, origin: string }> {
  return items.map(item => ({
    id: rssItemSourceId(feed.url, item),
    kind: 'rss' as const,
    content: rssItemSourceContent(item, feed.name, offsetMinutes),
    origin: item.link ?? feed.url,
  }))
}

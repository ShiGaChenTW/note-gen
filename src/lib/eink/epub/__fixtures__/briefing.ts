// almanac ALMNC-48：EPUB 測試共用的假資料（只給測試用）。
// 以 ALMNC-47 的 fullInputs 為底，補上：中文長文（超過 5 頁）、圖片、wikilink、附錄裡的舊釘選資料。
import zhTW from '../../../../../messages/zh-TW.json'
import { assembleBriefing } from '@/lib/eink/briefing/assemble'
import { DAY, TEXTS, at, fullInputs, pinSnap } from '@/lib/eink/briefing/__fixtures__/inputs'
import type { Briefing } from '@/lib/eink/briefing/types'
import type { EpubImageAsset } from '../document'
import { epubTextsFromMessages } from '../texts'

export const EPUB_TEXTS = epubTextsFromMessages(zhTW, 'zh-TW')
export const DAY_PARTS = TEXTS.dayParts
export const GENERATED_AT = new Date(2026, 10, 21, 6, 30).getTime()

/** 48×32 灰階漸層的 baseline JPEG（sips 產生），epubcheck 會檢查圖檔格式，所以要是真的 JPEG。 */
export const TINY_JPEG = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAASABIAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAADCgAwAEAAAAAQAAACAAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIACAAMAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAQEBAQEBAYEBAYJBgYGCQwJCQkJDA8MDAwMDA8SDw8PDw8PEhISEhISEhIVFRUVFRUZGRkZGRwcHBwcHBwcHBz/2wBDAQQFBQcHBwwHBwwdFBAUHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR3/3QAEAAP/2gAMAwEAAhEDEQA/APiTR+1fq7rP8Ver6x3r8otG/hoA9X0b+Gnaz/FXq+s/xU3Rv4aAPVtG/hr8ptZ/ir1fWf4q/VnRv4aAP//Q+JNH7V+rus/xV6vrHevyi0b+GgD1fRv4adrP8Ver6z/FTdG/hoA9W0b+Gvym1n+KvV9Z/ir9WdG/hoA//9k='), c => c.charCodeAt(0))

/** 一段約 n 個中文字的段落。 */
export function paragraph(seed: string, n: number): string {
  const sentence = `${seed}是電子紙上的深度閱讀材料，排版要穩定、斷行要自然。`
  let text = ''
  while (Array.from(text).length < n) text += sentence
  return text
}

/** 有 count 段、每段 chars 字的中文長文，第 2 段後面插一張圖。 */
export function longArticle(seed: string, count: number, chars: number, imageUrl?: string): string {
  const blocks: string[] = []
  for (let i = 0; i < count; i++) {
    blocks.push(`${paragraph(`${seed}第${i + 1}段`, chars)}`)
    if (i === 1 && imageUrl) blocks.push(`![示意圖](${imageUrl})`)
  }
  return blocks.join('\n\n')
}

/** 中文、圖片、內部連結都有的一天。 */
export function sampleBriefing(): Briefing {
  const inputs = fullInputs()
  if (inputs.pins.status === 'ok') {
    inputs.pins.data = [
      pinSnap('專案/電子紙.md', 0, {}, '# 電子紙\n\n今天第一次釘選，放全文。參考 [[舊]] 與 [[不存在的筆記]]、[[舊|上次的筆記]]。\n\n- 第一點 **粗體**\n- 第二點 <b>不是標籤</b>\n\n[相對連結](其他.md) 與 [外部連結](https://example.com/a?b=1&c=2)'),
      pinSnap('舊.md', 1, { firstSentAt: at(10), lastSentAt: at(20) }, '# 舊\n\n以前送過的釘選資料，全文在附錄。回到 [[電子紙]]。'),
    ]
  }
  if (inputs.readLater.status === 'ok') {
    inputs.readLater.data = [
      { url: 'https://ex.com/old', addedAt: at(1), status: 'pending', title: '最早存的長文', author: '作者甲', content: longArticle('甲', 12, 300, 'https://img.ex.com/a.png'), extractedAt: at(1, 9) },
      { url: 'https://ex.com/new', addedAt: at(2), status: 'pending', title: '第二篇長文', content: longArticle('乙', 12, 300, 'https://img.ex.com/b.png'), extractedAt: at(2, 9) },
      { url: 'https://ex.com/short', addedAt: at(3), status: 'pending', title: '短文', content: '一段短短的正文。\n\n![沒抓到的圖](https://img.ex.com/missing.png)', extractedAt: at(3, 9) },
    ]
  }
  inputs.log = { reviewShown: {} }
  // 回顧卡從「今天以前送過」的釘選抽（舊、回顧一 → 2 張）；這兩則的全文也都在附錄
  if (inputs.pins.status === 'ok') {
    inputs.pins.data.push(pinSnap('回顧一.md', 2, { firstSentAt: at(3), lastSentAt: at(4) }, '# 回顧一\n\n第一張回顧卡的段落。'))
  }
  return assembleBriefing(DAY, inputs, TEXTS)
}

export function tinyImages(urls: string[]): Map<string, EpubImageAsset> {
  return new Map(urls.map((url, i) => [url, { href: `images/img-${String(i + 1).padStart(3, '0')}.jpg`, bytes: TINY_JPEG, mediaType: 'image/jpeg' }]))
}

export const IMAGE_URLS = ['https://img.ex.com/a.png', 'https://img.ex.com/b.png']

/** 不可壓縮的「圖」（隨機位元組，固定種子），用來做出超過 1 MB 的簡報。 */
export function noise(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size)
  let x = seed
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    bytes[i] = x >> 16
  }
  return bytes
}

/**
 * 大小約 size 的合法 JPEG：TINY_JPEG 的 SOI 後面塞滿 COM（註解）區段的隨機位元組。
 * 壓縮不了、閱讀器與 epubcheck 也認得是 JPEG，用來做出超過 1 MB 的簡報。
 */
export function heavyJpeg(size: number, seed: number): Uint8Array {
  const payload = noise(size, seed)
  const chunks: Uint8Array[] = [TINY_JPEG.slice(0, 2)]
  for (let offset = 0; offset < payload.length; offset += 65000) {
    const part = payload.slice(offset, offset + 65000)
    const length = part.length + 2
    chunks.push(Uint8Array.from([0xFF, 0xFE, length >> 8, length & 0xFF]), part)
  }
  chunks.push(TINY_JPEG.slice(2))
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
  let at = 0
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length }
  return out
}

/** 每篇文章的附錄部分都有一張大圖：最早的 600 KB、第二篇 500 KB。 */
export function heavyBriefing(): { briefing: Briefing, images: Map<string, EpubImageAsset> } {
  const briefing = sampleBriefing()
  for (const chapter of briefing.chapters) {
    if (chapter.kind !== 'articles') continue
    chapter.items = chapter.items.map((item, i) => (i < 2 ? { ...item, content: `${item.content}\n\n![大圖](https://img.ex.com/big-${i}.jpg)` } : item))
  }
  const images = tinyImages(IMAGE_URLS)
  images.set('https://img.ex.com/big-0.jpg', { href: 'images/big-0.jpg', bytes: heavyJpeg(600_000, 1), mediaType: 'image/jpeg' })
  images.set('https://img.ex.com/big-1.jpg', { href: 'images/big-1.jpg', bytes: heavyJpeg(500_000, 2), mediaType: 'image/jpeg' })
  return { briefing, images }
}


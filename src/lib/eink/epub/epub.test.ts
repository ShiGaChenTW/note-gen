// almanac ALMNC-48：今日簡報 EPUB 產生器。
//   AC #1 epubcheck 沒有錯誤      → epubcheck.test.ts（RUN_EPUBCHECK=1）；這裡另驗結構：XML 合法、連結與 manifest 對得上
//   AC #2 不超過 1 MB＋精簡順序   → 「大小上限」
//   AC #3 超過 5 頁截在段落邊界    → 「精選文章截斷」
import { strFromU8, unzipSync } from 'fflate'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { DAY_PARTS, EPUB_TEXTS, GENERATED_AT, IMAGE_URLS, TINY_JPEG, heavyBriefing, longArticle, paragraph, sampleBriefing, tinyImages } from './__fixtures__/briefing'
import { EMPTY_TRIM, renderBook } from './document'
import { epubFileName, fitBriefingEpub, prepareImages, trimSteps } from './index'
import { markdownBlocks, markdownImageUrls, markdownToXhtml, type MarkdownContext } from './markdown'
import { packageEpub } from './package'
import { markdownUnits, textUnits, truncateMarkdown } from './pages'
import { CHARS_PER_PAGE, EPUB_MAX_BYTES } from './params'

const options = { texts: EPUB_TEXTS, locale: 'zh-TW', dayParts: DAY_PARTS, generatedAt: GENERATED_AT }

function ctx(links: Record<string, string> = {}, images: Record<string, string> = {}): MarkdownContext {
  return {
    resolveWikilink: target => links[target] ?? null,
    resolveImage: src => images[src] ?? null,
    imageFallback: alt => `［${alt || '圖片'}］`,
  }
}

// jsdom 沒有型別宣告（專案沒裝 @types/jsdom），只用到這一個建構子
type JsdomCtor = new (xml: string, options: { contentType: string }) => { window: { document: Document } }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: JsdomCtor }

function parseXml(xml: string): Document {
  // jsdom 用 XML 模式解析，不合法會丟錯
  return new JSDOM(xml, { contentType: 'application/xhtml+xml' }).window.document
}

function unzip(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes)
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, name.endsWith('.jpg') ? `<${data.length} bytes>` : strFromU8(data)]))
}

describe('Markdown → XHTML', () => {
  it('wikilink 指到簡報內的章節，找不到就顯示純文字', () => {
    const html = markdownToXhtml('看 [[電子紙]]、[[電子紙|別名]] 與 [[不存在]]，嵌入 ![[圖.png]]', ctx({ 電子紙: 'ch02.xhtml#pin-1' }))
    expect(html).toContain('<a href="ch02.xhtml#pin-1">電子紙</a>')
    expect(html).toContain('<a href="ch02.xhtml#pin-1">別名</a>')
    expect(html).toContain('與 不存在，')
    expect(html).not.toContain('[[')
  })

  it('原始 HTML 跳脫、相對連結改純文字、遠端圖片沒有對應檔案就改文字', () => {
    const html = markdownToXhtml('<script>x</script> [筆記](a.md) [網頁](https://ex.com/?a=1&b=2)\n\n![圖說](https://img/x.png) ![](https://img/y.png)', ctx({}, { 'https://img/y.png': 'images/img-001.jpg' }))
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('a.md')
    expect(html).toContain('筆記')
    expect(html).toContain('href="https://ex.com/?a=1&amp;b=2"')
    expect(html).toContain('［圖說］')
    expect(html).toContain('<img src="images/img-001.jpg" alt="" />')
    expect(html).not.toContain('https://img/x.png')
    expect(() => parseXml(`<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`)).not.toThrow()
  })

  it('拿掉 XML 不允許的控制字元', () => {
    expect(markdownToXhtml('a\u0001b\u000Bc', ctx())).toBe('<p>abc</p>\n')
  })

  it('列出圖片網址、切出頂層區塊（程式碼區塊裡的空行不算段落邊界）', () => {
    expect(markdownImageUrls('![a](u1) x ![b](u2) ![c](u1)')).toEqual(['u1', 'u2'])
    expect(markdownBlocks('第一段\n\n```\ncode\n\nmore\n```\n\n- a\n- b')).toEqual(['第一段', '```\ncode\n\nmore\n```', '- a\n- b'])
  })
})

describe('精選文章截斷（AC #3）', () => {
  it('頁的定義：中文 1、其他 0.5、空白不算；一頁 CHARS_PER_PAGE 字', () => {
    expect(textUnits('中文 ab')).toBe(3)
    expect(CHARS_PER_PAGE).toBe(500)
  })

  it('不到 5 頁不截', () => {
    const text = longArticle('短', 3, 300)
    expect(truncateMarkdown(text)).toEqual({ head: text, rest: null })
  })

  it('超過 5 頁截在段落邊界：前面不超過 5 頁、其餘從下一段開始', () => {
    const text = longArticle('長', 12, 300)
    const { head, rest } = truncateMarkdown(text)
    expect(rest).not.toBeNull()
    expect(markdownUnits(head)).toBeLessThanOrEqual(5 * CHARS_PER_PAGE)
    expect(head.endsWith('。')).toBe(true)
    expect(`${head}\n\n${rest}`).toBe(text)
    const kept = head.split('\n\n').length
    expect(rest?.startsWith(`長第${kept + 1}段`)).toBe(true)
  })

  it('單一段落就超過 5 頁時退到句子邊界', () => {
    const text = paragraph('一整段', 4000)
    const { head, rest } = truncateMarkdown(text)
    expect(rest).not.toBeNull()
    expect(head.endsWith('。')).toBe(true)
    expect(markdownUnits(head)).toBeLessThanOrEqual(5 * CHARS_PER_PAGE)
  })

  it('章節結尾附「續讀見附錄」連結，附錄文件接著放其餘段落', () => {
    const book = renderBook(sampleBriefing(), { texts: EPUB_TEXTS, lang: 'zh-Hant-TW', images: tinyImages(IMAGE_URLS), plan: EMPTY_TRIM, generatedAt: GENERATED_AT }, DAY_PARTS)
    const articles = book.docs.find(doc => doc.title === '每日精選文章')
    expect(articles).toBeDefined()
    const links = [...(articles?.xhtml ?? '').matchAll(/<p class="continue"><a href="([^"]+)">續讀見附錄<\/a><\/p>/g)].map(m => m[1])
    expect(links).toHaveLength(2)
    for (const href of links) {
      const target = book.docs.find(doc => doc.href === href)
      expect(target?.xhtml).toContain('第9段')
    }
    expect(articles?.xhtml).not.toContain('第9段')
  })
})

describe('組書與打包', () => {
  const briefing = sampleBriefing()
  const images = tinyImages(IMAGE_URLS)
  const epub = fitBriefingEpub(briefing, images, options)
  const files = unzip(epub.bytes)

  it('檔名 almanac-YYYY-MM-DD.epub；mimetype 是第一個檔案而且不壓縮', () => {
    expect(epub.fileName).toBe('almanac-2026-11-21.epub')
    expect(epubFileName('2026-01-02')).toBe('almanac-2026-01-02.epub')
    expect(strFromU8(epub.bytes.slice(30, 38))).toBe('mimetype')
    expect(epub.bytes[8] | (epub.bytes[9] << 8)).toBe(0)
    expect(strFromU8(epub.bytes.slice(38, 58))).toBe('application/epub+zip')
  })

  it('每章一份 XHTML，今天行程是第 1 章、開頭是天氣；有 nav.xhtml 與 toc.ncx', () => {
    expect(Object.keys(files).sort()).toMatchInlineSnapshot(`
      [
        "META-INF/container.xml",
        "OEBPS/ap01.xhtml",
        "OEBPS/ap02.xhtml",
        "OEBPS/ap03.xhtml",
        "OEBPS/ap04.xhtml",
        "OEBPS/ch01.xhtml",
        "OEBPS/ch02.xhtml",
        "OEBPS/ch03.xhtml",
        "OEBPS/ch04.xhtml",
        "OEBPS/ch05.xhtml",
        "OEBPS/ch06.xhtml",
        "OEBPS/content.opf",
        "OEBPS/images/img-001.jpg",
        "OEBPS/images/img-002.jpg",
        "OEBPS/nav.xhtml",
        "OEBPS/style.css",
        "OEBPS/toc.ncx",
        "mimetype",
      ]
    `)
    const ch01 = files['OEBPS/ch01.xhtml']
    expect(ch01).toContain('§01</span> 今天行程')
    expect(ch01.indexOf('class="weather"')).toBeLessThan(ch01.indexOf('class="schedule"'))
    expect(ch01).toContain('臺北市 · 最高 22° · 最低 10° · 降雨 80%')
    // 今日簡報照樣完整顯示私人行程
    expect(ch01).toContain('看牙醫')
    expect(files['OEBPS/toc.ncx']).toContain('<text>今天行程</text>')
    expect(files['OEBPS/toc.ncx']).toContain('<text>最早存的長文</text>')
    expect(files['OEBPS/nav.xhtml']).toContain('epub:type="toc"')
  })

  it('所有 XHTML／OPF／NCX 都是合法 XML，內部連結都指到 manifest 裡的檔案與存在的 id', () => {
    expect(() => parseXml('<a><b></a>')).toThrow()
    const manifest = files['OEBPS/content.opf']
    for (const [name, text] of Object.entries(files)) {
      if (!/\.(xhtml|opf|ncx|xml)$/.test(name)) continue
      expect(() => parseXml(text), name).not.toThrow()
    }
    for (const [name, text] of Object.entries(files)) {
      if (!name.endsWith('.xhtml')) continue
      for (const [, href] of text.matchAll(/(?:href|src)="([^"]+)"/g)) {
        if (/^(https?:|mailto:)/.test(href)) continue
        const [file, fragment] = href.split('#')
        expect(manifest, `${name} → ${href}`).toContain(`href="${file}"`)
        if (fragment) expect(files[`OEBPS/${file}`], `${name} → ${href}`).toContain(`id="${fragment}"`)
      }
    }
  })

  it('wikilink 指到釘選資料：今天全文的指到章節錨點、舊的指到附錄；找不到的是純文字', () => {
    const pinned = files['OEBPS/ch02.xhtml']
    expect(pinned).toContain('<a href="ap01.xhtml">舊</a>')
    expect(pinned).toContain('<a href="ap01.xhtml">上次的筆記</a>')
    expect(pinned).toContain('與 不存在的筆記、')
    expect(files['OEBPS/ap01.xhtml']).toContain('<a href="ch02.xhtml#pin-1">電子紙</a>')
  })

  it('同樣的內容與產生時間 ⇒ 位元組相同', () => {
    expect(fitBriefingEpub(briefing, images, options).bytes).toEqual(epub.bytes)
  })

  it('估計頁數（給休眠畫面提示）', () => {
    expect(epub.pages).toBeGreaterThan(10)
    expect(epub.pages).toBeLessThan(40)
  })
})

describe('大小上限（AC #2）', () => {
  it('上限是 1,000,000 bytes（ALMNC-44 驗證前取較保守的解讀）', () => {
    expect(EPUB_MAX_BYTES).toBe(1_000_000)
  })

  it('精簡步驟的順序：最早的文章全文 → 第二篇 → 回顧卡 1 張 → 知識報告一句話 → 舊釘選附錄 → 圖片', () => {
    const { briefing, images } = heavyBriefing()
    let plan = EMPTY_TRIM
    const trace = trimSteps(briefing, images).map(step => {
      plan = step(plan)
      return JSON.stringify(plan)
    })
    expect(trace).toEqual([
      '{"droppedArticleRest":["https://ex.com/old"],"reviewOne":false,"reportOneLine":false,"droppedPinAppendix":[],"dropImages":false}',
      '{"droppedArticleRest":["https://ex.com/old","https://ex.com/new"],"reviewOne":false,"reportOneLine":false,"droppedPinAppendix":[],"dropImages":false}',
      '{"droppedArticleRest":["https://ex.com/old","https://ex.com/new"],"reviewOne":true,"reportOneLine":false,"droppedPinAppendix":[],"dropImages":false}',
      '{"droppedArticleRest":["https://ex.com/old","https://ex.com/new"],"reviewOne":true,"reportOneLine":true,"droppedPinAppendix":[],"dropImages":false}',
      '{"droppedArticleRest":["https://ex.com/old","https://ex.com/new"],"reviewOne":true,"reportOneLine":true,"droppedPinAppendix":["pin:舊.md"],"dropImages":false}',
      '{"droppedArticleRest":["https://ex.com/old","https://ex.com/new"],"reviewOne":true,"reportOneLine":true,"droppedPinAppendix":["pin:舊.md","pin:回顧一.md"],"dropImages":false}',
      '{"droppedArticleRest":["https://ex.com/old","https://ex.com/new"],"reviewOne":true,"reportOneLine":true,"droppedPinAppendix":["pin:舊.md","pin:回顧一.md"],"dropImages":true}',
    ])
  })

  it('超過 1 MB 時先砍最早那篇的附錄全文，壓到上限以下就停，並在目錄頁註明', () => {
    const { briefing, images } = heavyBriefing()
    const untrimmed = packageEpub(renderBook(briefing, { texts: EPUB_TEXTS, lang: 'zh-Hant-TW', images, plan: EMPTY_TRIM, generatedAt: GENERATED_AT }, DAY_PARTS))
    expect(untrimmed.length).toBeGreaterThan(EPUB_MAX_BYTES)
    const epub = fitBriefingEpub(briefing, images, options)
    expect(epub.bytes.length).toBeLessThanOrEqual(EPUB_MAX_BYTES)
    expect(epub.overLimit).toBe(false)
    expect(epub.trim).toEqual({ ...EMPTY_TRIM, droppedArticleRest: ['https://ex.com/old'] })
    const files = unzip(epub.bytes)
    expect(files['OEBPS/nav.xhtml']).toContain('因檔案大小限制精簡的內容')
    expect(files['OEBPS/nav.xhtml']).toContain('「最早存的長文」的續讀全文已移除，原文：https://ex.com/old')
    expect(Object.keys(files)).not.toContain('OEBPS/images/big-0.jpg')
    expect(Object.keys(files)).toContain('OEBPS/images/big-1.jpg')
    // 「續讀見附錄」仍然指得到：附錄留一頁說明與原文連結
    expect(files['OEBPS/ap03.xhtml']).toContain('因檔案大小限制，這篇的續讀全文沒有收錄。')
  })

  it('上限很小時每一步都做（回顧卡 1 張、知識報告一句話…），行程、天氣、當天釘選、工作台摘要不砍', () => {
    const { briefing, images } = heavyBriefing()
    const epub = fitBriefingEpub(briefing, images, { ...options, maxBytes: 1 })
    expect(epub.trim.droppedArticleRest).toEqual(['https://ex.com/old', 'https://ex.com/new'])
    expect(epub.trim.reviewOne).toBe(true)
    expect(epub.trim.reportOneLine).toBe(true)
    const files = unzip(epub.bytes)
    const all = Object.values(files).join('\n')
    expect(all).toContain('因檔案大小限制，今天只放 1 張回顧卡。')
    expect(all).toContain('因檔案大小限制，知識報告只留一句話。')
    expect(all).toContain('2026-W47：1 則筆記，1 則優化建議還沒處理。')
    for (const kept of ['連假', '寄報價', '看牙醫', '臺北市 · 最高 22°', '今天第一次釘選，放全文。', '第一', '逾期']) expect(all).toContain(kept)
    expect(epub.notices).toEqual([
      '「最早存的長文」的續讀全文已移除，原文：https://ex.com/old',
      '「第二篇長文」的續讀全文已移除，原文：https://ex.com/new',
      '每日回顧卡減成 1 張。',
      '知識報告只留一句話。',
      '「舊」的附錄全文已移除。',
      '「回顧一」的附錄全文已移除。',
      '精選文章的圖片已移除。',
    ])
    // 連必留的內容都放不下時照樣產生（不擋），但標 overLimit 讓呼叫端知道
    expect(epub.overLimit).toBe(true)
  })
})

describe('圖片準備', () => {
  it('只抓精選文章裡的 http(s) 圖片，每篇最多 N 張；抓不到或轉不了的略過', async () => {
    const briefing = sampleBriefing()
    const requested: string[] = []
    const images = await prepareImages(
      briefing,
      async url => { requested.push(url); return url.includes('missing') ? null : { bytes: new Uint8Array([1]), mediaType: 'image/png' } },
      async () => ({ bytes: TINY_JPEG, mediaType: 'image/jpeg' }),
      1,
    )
    expect(requested).toEqual(['https://img.ex.com/a.png', 'https://img.ex.com/b.png', 'https://img.ex.com/missing.png'])
    expect([...images.entries()].map(([url, asset]) => [url, asset.href])).toEqual([
      ['https://img.ex.com/a.png', 'images/img-001.jpg'],
      ['https://img.ex.com/b.png', 'images/img-002.jpg'],
    ])
  })
})

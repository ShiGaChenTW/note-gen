// Fork（almanac ALMNC-48）：把 Book 打包成 EPUB3（zip）。
// 打包方式參考 ptk862010/obsidian-xteink-sync 的 src/epub.ts（MIT License）：
//   用 fflate 的 zipSync；mimetype 必須是第一個檔案而且不壓縮；JPEG 已經壓過就不再壓。
// 跟參考實作不同的地方：多章（每章一份 XHTML）、目錄頁放進書脊、toc.ncx 有巢狀層級（給舊閱讀器）、
// 檔案時間固定用產生時間，同一份內容每次打包出來的位元組相同（大小判斷與測試都穩定）。
import { strToU8, zipSync, type Zippable } from 'fflate'
import type { Book, TocEntry } from './document'
import { escapeXml } from './markdown'

/**
 * 樣式（設計方向暫定 H 版：細膩、精準技術感、資訊密集、靠左對齊）。
 * CrossPoint 只吃一部分 CSS，這裡只用基本屬性；字型交給閱讀器（中文字型由 ALMNC-52 安裝），不內嵌字型以免吃掉 1 MB。
 */
export const EPUB_STYLE = `body { margin: 0 3%; line-height: 1.5; text-align: left; }
h1 { font-size: 1.4em; line-height: 1.25; margin: 0 0 0.6em; padding-bottom: 0.2em; border-bottom: 1px solid #000; page-break-after: avoid; }
h1 .no, .num, .time, .meta { font-family: monospace; }
h2 { font-size: 1.1em; line-height: 1.3; margin: 1.1em 0 0.3em; page-break-after: avoid; }
p { margin: 0.4em 0; }
.meta { font-size: 0.8em; color: #555; }
.note { font-size: 0.9em; color: #555; border-left: 2px solid #555; padding-left: 0.5em; }
.notice { border: 1px solid #000; padding: 0.2em 0.6em; margin: 0.6em 0; font-size: 0.9em; }
.notice h2 { margin-top: 0.3em; }
.continue { margin-top: 0.8em; font-weight: bold; }
ul.schedule { list-style: none; padding: 0; margin: 0.4em 0; }
ul.schedule li { padding: 0.3em 0; border-bottom: 1px solid #aaa; }
.time { display: inline-block; min-width: 6.5em; }
.title { font-weight: bold; }
table { border-collapse: collapse; width: 100%; font-size: 0.9em; margin: 0.4em 0; }
th, td { border-bottom: 1px solid #aaa; padding: 0.15em 0.3em; text-align: left; vertical-align: top; }
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; font-family: monospace; font-size: 0.85em; }
code { font-family: monospace; font-size: 0.9em; }
blockquote { margin: 0.6em 0 0.6em 0.6em; padding-left: 0.6em; border-left: 2px solid #555; }
.card { border-top: 1px solid #000; margin-top: 0.8em; }
.img-missing { color: #555; font-size: 0.9em; }
`

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

export function contentOpf(book: Book): string {
  const items = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '    <item id="style" href="style.css" media-type="text/css"/>',
    ...book.docs.map(doc => `    <item id="${doc.id}" href="${escapeXml(doc.href)}" media-type="application/xhtml+xml"/>`),
    ...book.images.map((image, i) => `    <item id="img${i + 1}" href="${escapeXml(image.href)}" media-type="${image.mediaType}"/>`),
  ]
  const spine = ['    <itemref idref="nav"/>', ...book.docs.map(doc => `    <itemref idref="${doc.id}"/>`)]
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXml(book.lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(book.identifier)}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:language>${escapeXml(book.lang)}</dc:language>
    <dc:creator>Almanac</dc:creator>
    <meta property="dcterms:modified">${book.modified}</meta>
  </metadata>
  <manifest>
${items.join('\n')}
  </manifest>
  <spine toc="ncx">
${spine.join('\n')}
  </spine>
</package>
`
}

function depth(entries: TocEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, 1 + (entry.children ? depth(entry.children) : 0)), 0)
}

export function tocNcx(book: Book): string {
  // 指到同一個位置的 navPoint 要用同一個 playOrder（例如「附錄」與附錄第一則），否則 epubcheck 報 RSC-005
  let count = 0
  const playOrders = new Map<string, number>()
  const points = (entries: TocEntry[], indent: string): string => entries.map(entry => {
    count += 1
    const id = `np${count}`
    if (!playOrders.has(entry.href)) playOrders.set(entry.href, playOrders.size + 1)
    const playOrder = playOrders.get(entry.href)
    const children = entry.children?.length ? `\n${points(entry.children, `${indent}  `)}` : ''
    return `${indent}<navPoint id="${id}" playOrder="${playOrder}">
${indent}  <navLabel><text>${escapeXml(entry.label)}</text></navLabel>
${indent}  <content src="${escapeXml(entry.href)}"/>${children}
${indent}</navPoint>`
  }).join('\n')
  const entries = book.toc.length ? book.toc : [{ label: book.title, href: 'nav.xhtml' }]
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeXml(book.lang)}">
  <head>
    <meta name="dtb:uid" content="${escapeXml(book.identifier)}"/>
    <meta name="dtb:depth" content="${depth(entries)}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>
${points(entries, '    ')}
  </navMap>
</ncx>
`
}

/** 打包成 EPUB（zip 位元組）。 */
export function packageEpub(book: Book): Uint8Array {
  const mtime = new Date(book.modified)
  const files: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0, mtime }],
    'META-INF/container.xml': [strToU8(CONTAINER_XML), { mtime }],
    'OEBPS/content.opf': [strToU8(contentOpf(book)), { mtime }],
    'OEBPS/nav.xhtml': [strToU8(book.nav), { mtime }],
    'OEBPS/toc.ncx': [strToU8(tocNcx(book)), { mtime }],
    'OEBPS/style.css': [strToU8(EPUB_STYLE), { mtime }],
  }
  for (const doc of book.docs) files[`OEBPS/${doc.href}`] = [strToU8(doc.xhtml), { mtime }]
  for (const image of book.images) files[`OEBPS/${image.href}`] = [image.bytes, { level: 0, mtime }]
  return zipSync(files, { level: 9 })
}

// Fork（almanac ALMNC-48）：Markdown → EPUB 用的 XHTML 片段。
// 用專案現有的 markdown-it（xhtmlOut），再補三條規則，確保 epubcheck 不會報錯：
//   1. 原始 HTML 一律跳脫（html: false），不讓擷取來的網頁標籤混進 XHTML
//   2. [[wikilink]] 指到簡報內的章節或附錄；找不到就顯示純文字
//   3. 連結只留 http(s)/mailto；相對路徑（筆記之間的 .md 連結）在 EPUB 裡會變成壞連結，改成純文字
//   4. 圖片只能指向 EPUB 裡的檔案（遠端圖片在 EPUB3 是錯誤）；沒有對應檔案的圖改成文字
// XML 1.0 不允許的控制字元先拿掉（參考 ptk862010/obsidian-xteink-sync 的 escapeXml，MIT）。
import MarkdownIt from 'markdown-it'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'

// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

export function stripInvalidXmlChars(text: string): string {
  return text.replace(INVALID_XML_CHARS, '')
}

export function escapeXml(text: string): string {
  return stripInvalidXmlChars(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export interface MarkdownContext {
  /** wikilink 目標（筆記名、路徑或標題）→ 簡報內的 href；找不到回 null */
  resolveWikilink: (target: string) => string | null
  /** 圖片網址 → EPUB 裡的 href；沒有（沒抓到、被精簡掉）回 null */
  resolveImage: (src: string) => string | null
  /** 圖片沒有對應檔案時顯示的文字 */
  imageFallback: (alt: string) => string
}

const SAFE_LINK = /^(?:https?:|mailto:)/i

/** wikilink 的 inline 規則：[[目標]]、[[目標|顯示文字]]、[[目標#標題]]；![[嵌入]] 只顯示名字。 */
function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state
  const embed = src.charCodeAt(pos) === 0x21 /* ! */
  const start = embed ? pos + 1 : pos
  if (src.charCodeAt(start) !== 0x5B || src.charCodeAt(start + 1) !== 0x5B) return false
  const end = src.indexOf(']]', start + 2)
  if (end < 0) return false
  const inner = src.slice(start + 2, end)
  if (!inner.trim() || inner.includes('\n') || inner.includes('[[')) return false
  if (!silent) {
    const [target, alias] = inner.split('|', 2)
    const token = state.push('wikilink', '', 0)
    token.meta = { target: target.trim(), alias: alias?.trim() || null, embed }
  }
  state.pos = end + 2
  return true
}

/** 一個 markdown-it 實體、規則不變；ctx 每次 render 時透過 env 傳入（不在模組層保留狀態）。 */
function createRenderer(): MarkdownIt {
  const md = new MarkdownIt({ html: false, xhtmlOut: true, linkify: false, breaks: false, typographer: false })
  md.inline.ruler.before('link', 'wikilink', wikilinkRule)

  md.renderer.rules.wikilink = (tokens, idx, _options, env: { ctx: MarkdownContext }) => {
    const { target, alias, embed } = tokens[idx].meta as { target: string, alias: string | null, embed: boolean }
    const name = target.split('#')[0].trim()
    const href = embed ? null : env.ctx.resolveWikilink(name)
    const text = escapeXml(embed ? name : (alias ?? name))
    return href ? `<a href="${escapeXml(href)}">${text}</a>` : text
  }

  md.renderer.rules.image = (tokens, idx, _options, env: { ctx: MarkdownContext }) => {
    const token = tokens[idx]
    const src = token.attrGet('src') ?? ''
    const alt = token.children ? token.children.map(child => child.content).join('') : token.content
    const href = env.ctx.resolveImage(src)
    if (!href) return `<span class="img-missing">${escapeXml(env.ctx.imageFallback(alt))}</span>`
    return `<img src="${escapeXml(href)}" alt="${escapeXml(alt)}" />`
  }

  // 不安全或相對的連結：開頭與結尾都不輸出，只留文字。用 token.meta 記住，結尾才對得上。
  const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  const defaultLinkClose = md.renderer.rules.link_close ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet('href') ?? ''
    if (!SAFE_LINK.test(href)) {
      const close = tokens.slice(idx + 1).find(token => token.type === 'link_close' && token.level === tokens[idx].level)
      if (close) close.meta = { ...(close.meta ?? {}), dropped: true }
      return ''
    }
    return defaultLinkOpen(tokens, idx, options, env, self)
  }
  md.renderer.rules.link_close = (tokens, idx, options, env, self) => (
    (tokens[idx].meta as { dropped?: boolean } | null)?.dropped ? '' : defaultLinkClose(tokens, idx, options, env, self)
  )
  return md
}

let renderer: MarkdownIt | null = null
function getRenderer(): MarkdownIt {
  renderer ??= createRenderer()
  return renderer
}

/** Markdown → XHTML 片段（可直接放進 <body>）。 */
export function markdownToXhtml(markdown: string, ctx: MarkdownContext): string {
  return getRenderer().render(stripInvalidXmlChars(markdown), { ctx })
}

/** 列出 Markdown 裡所有圖片的網址（照出現順序、去重）。 */
export function markdownImageUrls(markdown: string): string[] {
  const urls: string[] = []
  const walk = (tokens: ReturnType<MarkdownIt['parse']>) => {
    for (const token of tokens) {
      if (token.type === 'image') {
        const src = token.attrGet('src')
        if (src && !urls.includes(src)) urls.push(src)
      }
      if (token.children) walk(token.children)
    }
  }
  walk(getRenderer().parse(stripInvalidXmlChars(markdown), {}))
  return urls
}

/**
 * 把 Markdown 切成頂層區塊（段落、清單、程式碼區塊、表格…），每塊是原文的一段連續行。
 * 用 markdown-it 的 token.map 切，程式碼區塊裡的空行不會被當成段落邊界。
 */
export function markdownBlocks(markdown: string): string[] {
  const source = stripInvalidXmlChars(markdown)
  const lines = source.split('\n')
  const blocks: string[] = []
  let cursor = 0
  for (const token of getRenderer().parse(source, {})) {
    if (token.level !== 0 || !token.map || token.nesting === -1) continue
    const [from, to] = token.map
    if (from < cursor) continue
    const text = lines.slice(from, to).join('\n').trim()
    if (text) blocks.push(text)
    cursor = to
  }
  return blocks
}

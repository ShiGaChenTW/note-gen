// Fork（almanac ALMNC-57）：資料入口（Email、RSS、會議逐字稿）共用的文字工具——位元組轉字串（字元集）、HTML 實體、HTML 轉純文字。
// 全是純函式，不碰 DOM（App 與測試環境都能跑）。

/** 位元組 → 「一個位元組一個字元」的字串（latin1），MIME 解析用；之後再依字元集解碼。 */
export function bytesToBinary(bytes: Uint8Array): string {
  let out = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return out
}

export function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index) & 0xff
  return bytes
}

/** TextDecoder 不認得、但郵件常見的字元集別名。 */
const CHARSET_ALIASES: Record<string, string> = {
  utf8: 'utf-8',
  'x-big5': 'big5',
  'big-5': 'big5',
  'x-gbk': 'gbk',
  'cp936': 'gbk',
  'ms950': 'big5',
  'cp950': 'big5',
  'x-sjis': 'shift_jis',
  'ks_c_5601': 'euc-kr',
  ascii: 'us-ascii',
  '7bit': 'us-ascii',
}

function decoderFor(charset: string | undefined, fatal = false): TextDecoder | undefined {
  const label = (charset ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase()
  if (!label) return undefined
  try {
    return new TextDecoder(CHARSET_ALIASES[label] ?? label, { fatal })
  } catch {
    return undefined
  }
}

/**
 * 依字元集解碼；沒給或不認得的字元集先試 UTF-8，不是合法 UTF-8 再退回 windows-1252（不會丟錯）。
 * 繁中常見的 Big5、簡中的 GB2312／GBK、日文 Shift_JIS 都靠 TextDecoder。
 */
export function decodeCharset(bytes: Uint8Array, charset?: string): string {
  const declared = decoderFor(charset)
  if (declared) return declared.decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/**
 * 讀進來的文字檔（逐字稿 .txt／.vtt／.srt）：看 BOM；沒有就試 UTF-8，不合法再試 Big5，最後 windows-1252。
 */
export function decodeTextFile(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3))
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  for (const label of ['utf-8', 'big5']) {
    try {
      return new TextDecoder(label, { fatal: true }).decode(bytes)
    } catch {
      // 試下一個
    }
  }
  return new TextDecoder('windows-1252').decode(bytes)
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', times: '×', divide: '÷', euro: '€', pound: '£', yen: '¥',
  zwnj: '', zwj: '', shy: '',
}

/** 解 HTML／XML 實體（具名的常見幾個、十進位、十六進位）；不認得的原樣保留。 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named ?? match
  })
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'tr', 'table', 'tbody', 'thead', 'tfoot', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'address', 'center', 'form', 'fieldset', 'figure',
  'figcaption', 'pre', 'blockquote', 'caption',
])
const PARAGRAPH_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol', 'blockquote', 'pre', 'hr'])

/**
 * HTML → 純文字。區塊元素換行、清單項目加「- 」、<br> 換行；<blockquote> 裡的每一行加「> 」
 * （引用的舊信之後由 stripQuotedReply 判斷要不要去掉）。script／style／head 整段丟掉。
 */
export function htmlToText(html: string): string {
  const source = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style|head|title|template|noscript|xml)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')

  const lines: string[] = []
  let line = ''
  let lineDepth = 0
  let depth = 0
  let pre = 0

  const pushLine = (text: string, lineQuote: number) => {
    lines.push(text ? `${'> '.repeat(lineQuote)}${text}` : (lineQuote ? '>'.repeat(lineQuote) : ''))
  }
  const endLine = () => {
    const text = pre ? line.replace(/\s+$/, '') : line.replace(/[ \t ]+/g, ' ').trim()
    if (text) pushLine(text, lineDepth)
    line = ''
  }
  const gap = () => {
    endLine()
    if (lines.length && lines[lines.length - 1].replace(/>/g, '').trim() !== '') pushLine('', depth)
  }
  const addText = (raw: string) => {
    const text = decodeEntities(raw)
    if (pre) {
      const parts = text.split(/\r?\n/)
      parts.forEach((part, index) => {
        if (index > 0) {
          if (line) endLine()
          else pushLine('', depth)
        }
        if (!line) lineDepth = depth
        line += part
      })
      return
    }
    const collapsed = text.replace(/[\s ]+/g, ' ')
    if (!line.trim()) {
      if (!collapsed.trim()) return
      lineDepth = depth
      line = collapsed.replace(/^ /, '')
      return
    }
    line += collapsed
  }

  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>/g
  let last = 0
  for (let match = tagRe.exec(source); match; match = tagRe.exec(source)) {
    if (match.index > last) addText(source.slice(last, match.index))
    last = tagRe.lastIndex
    const closing = match[0][1] === '/'
    const name = match[1].toLowerCase()
    if (name === 'br') {
      if (line.trim()) endLine()
      else pushLine('', depth)
      continue
    }
    if (name === 'td' || name === 'th') {
      if (closing && line.trim()) line += ' '
      continue
    }
    if (!BLOCK_TAGS.has(name)) continue
    if (name === 'blockquote') {
      gap()
      depth = closing ? Math.max(0, depth - 1) : depth + 1
      continue
    }
    if (name === 'pre') pre = closing ? Math.max(0, pre - 1) : pre + 1
    if (PARAGRAPH_TAGS.has(name)) gap()
    else endLine()
    if (name === 'li' && !closing) {
      lineDepth = depth
      line = '- '
    }
  }
  if (last < source.length) addText(source.slice(last))
  endLine()
  return tidyLines(lines)
}

/** 去掉行尾空白、連續空行只留一行、頭尾空行去掉。 */
export function tidyLines(lines: readonly string[]): string {
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.replace(/[ \t ]+$/g, '')
    const blank = line.replace(/^>+/, '').trim() === ''
    if (blank && (!out.length || out[out.length - 1].replace(/^>+/, '').trim() === '')) continue
    out.push(blank ? line.replace(/[^>]/g, '') : line)
  }
  while (out.length && out[out.length - 1].replace(/^>+/, '').trim() === '') out.pop()
  return out.join('\n')
}

/** 簡單、穩定的雜湊（FNV-1a 32 位元，十六進位），給沒有原始識別的項目當去重鍵。 */
export function stableHash(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const ZONES: Record<string, number> = { UT: 0, UTC: 0, GMT: 0, Z: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 }

/**
 * 解析 RFC 2822／RFC 822 日期（Email 的 Date、RSS 的 pubDate），也接受 ISO 8601（Atom）。解析不出來回傳 undefined。
 * 不依賴 Date.parse 對 RFC 2822 的支援程度（各引擎不一）。
 */
export function parseDate(value: string | undefined): number | undefined {
  const text = value?.trim()
  if (!text) return undefined
  const rfc = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2}|[A-Za-z]{1,5})?/.exec(text)
  if (rfc) {
    const month = MONTHS[rfc[2].toLowerCase()]
    if (month !== undefined) {
      let year = Number(rfc[3])
      if (year < 100) year += year < 50 ? 2000 : 1900
      const zone = rfc[7]
      let offset = 0
      if (zone && /^[+-]/.test(zone)) {
        const digits = zone.replace(':', '')
        offset = (digits[0] === '-' ? -1 : 1) * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)))
      } else if (zone) {
        offset = ZONES[zone.toUpperCase()] ?? 0
      }
      const utc = Date.UTC(year, month, Number(rfc[1]), Number(rfc[4]), Number(rfc[5]), Number(rfc[6] ?? 0))
      const result = utc - offset * 60_000
      return Number.isFinite(result) ? result : undefined
    }
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 毫秒 → 「YYYY-MM-DD HH:mm」。offsetMinutes 預設用本機時區（測試時傳固定值）。 */
export function formatDateTime(ms: number, offsetMinutes = -new Date(ms).getTimezoneOffset()): string {
  const date = new Date(ms + offsetMinutes * 60_000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

export function clipText(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max).join('').trimEnd()}…`
}

// Fork（almanac ALMNC-57.1）：最小的 MIME 解析——標頭（折行、RFC 2047 編碼字）、Content-Type 參數（含 RFC 2231）、
// quoted-printable／base64 解碼、multipart 拆段。只做 Email 匯入需要的部分；全是純函式。
// 字串一律是「一個位元組一個字元」的 binary 字串（text.ts bytesToBinary），解碼時才轉成真正的文字。
import { binaryToBytes, decodeCharset } from './text'

export interface Headers {
  get: (name: string) => string | undefined
  all: (name: string) => string[]
}

/** 把整封信（或一段 MIME part）拆成標頭與內文：第一個空行之前是標頭。 */
export function splitHeaderBody(raw: string): { header: string, body: string } {
  const match = /\r?\n\r?\n/.exec(raw)
  if (!match) return /^[\w-]+:/.test(raw) ? { header: raw, body: '' } : { header: '', body: raw }
  return { header: raw.slice(0, match.index), body: raw.slice(match.index + match[0].length) }
}

/** 解析標頭區：折行（下一行以空白開頭）接回上一行；名稱不分大小寫。 */
export function parseHeaders(block: string): Headers {
  const map = new Map<string, string[]>()
  let current: { name: string, value: string } | undefined
  const commit = () => {
    if (!current) return
    const list = map.get(current.name) ?? []
    list.push(current.value.trim())
    map.set(current.name, list)
  }
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) {
      current.value += ` ${line.trim()}`
      continue
    }
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    commit()
    current = { name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1) }
  }
  commit()
  return {
    get: name => map.get(name.toLowerCase())?.[0],
    all: name => map.get(name.toLowerCase()) ?? [],
  }
}

export function decodeQuotedPrintable(binary: string): Uint8Array {
  const text = binary.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) {
      bytes.push(parseInt(text.slice(index + 1, index + 3), 16))
      index += 2
    } else {
      bytes.push(text.charCodeAt(index) & 0xff)
    }
  }
  return Uint8Array.from(bytes)
}

export function decodeBase64(binary: string): Uint8Array {
  const clean = binary.replace(/[^A-Za-z0-9+/]/g, '')
  const usable = clean.slice(0, clean.length - (clean.length % 4 === 1 ? 1 : 0))
  const padded = usable + '='.repeat((4 - (usable.length % 4)) % 4)
  try {
    return binaryToBytes(atob(padded))
  } catch {
    return new Uint8Array()
  }
}

/** 沒有編碼、直接放 8 位元的標頭（常見是 UTF-8）：把連續的高位元組當 UTF-8 解。 */
function decodeRawHeader(binary: string): string {
  return binary.replace(/[\x80-\xff]+/g, run => decodeCharset(binaryToBytes(run)))
}

/**
 * RFC 2047 編碼字（=?charset?B|Q?…?=）。相鄰的編碼字之間的空白要去掉；
 * 同一字元集的相鄰編碼字先把位元組接起來再解碼（多位元組字元常被切在兩個編碼字中間）。
 */
export function decodeEncodedWords(value: string | undefined): string {
  if (!value) return ''
  const re = /=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g
  type Segment = { kind: 'text', text: string } | { kind: 'word', charset: string, bytes: Uint8Array }
  const segments: Segment[] = []
  let last = 0
  for (let match = re.exec(value); match; match = re.exec(value)) {
    if (match.index > last) segments.push({ kind: 'text', text: value.slice(last, match.index) })
    last = re.lastIndex
    const charset = match[1].split('*')[0].toLowerCase()
    const bytes = match[2].toUpperCase() === 'B'
      ? decodeBase64(match[3])
      : decodeQuotedPrintable(match[3].replace(/_/g, ' '))
    segments.push({ kind: 'word', charset, bytes })
  }
  if (last < value.length) segments.push({ kind: 'text', text: value.slice(last) })

  let out = ''
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment.kind === 'text') {
      const between = /^\s+$/.test(segment.text) && segments[index - 1]?.kind === 'word' && segments[index + 1]?.kind === 'word'
      if (!between) out += decodeRawHeader(segment.text)
      continue
    }
    let bytes = segment.bytes
    while (true) {
      const next = segments[index + 1]
      const afterGap = next?.kind === 'text' && /^\s+$/.test(next.text) ? segments[index + 2] : next
      if (afterGap?.kind !== 'word' || afterGap.charset !== segment.charset) break
      const merged = new Uint8Array(bytes.length + afterGap.bytes.length)
      merged.set(bytes)
      merged.set(afterGap.bytes, bytes.length)
      bytes = merged
      index += afterGap === next ? 1 : 2
    }
    out += decodeCharset(bytes, segment.charset)
  }
  return out.replace(/\s+/g, ' ').trim()
}

export interface ContentType {
  type: string
  params: Record<string, string>
}

/** RFC 2231：name*=charset'lang'%XX… 與 name*0*=…; name*1*=… 分段。 */
function decodeRfc2231(value: string, charsetHint?: string): string {
  const match = /^([^']*)'[^']*'(.*)$/.exec(value)
  const charset = match ? match[1] : charsetHint
  const encoded = match ? match[2] : value
  const bytes: number[] = []
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === '%' && /^[0-9A-Fa-f]{2}$/.test(encoded.slice(index + 1, index + 3))) {
      bytes.push(parseInt(encoded.slice(index + 1, index + 3), 16))
      index += 2
    } else {
      bytes.push(encoded.charCodeAt(index) & 0xff)
    }
  }
  return decodeCharset(Uint8Array.from(bytes), charset || undefined)
}

/** 解析 Content-Type／Content-Disposition 這種「值; 參數=…」的標頭。 */
export function parseParamHeader(value: string | undefined, fallback = ''): ContentType {
  const text = value ?? ''
  const semicolon = text.indexOf(';')
  const type = (semicolon < 0 ? text : text.slice(0, semicolon)).trim().toLowerCase() || fallback
  const params: Record<string, string> = {}
  const extended: Record<string, Array<{ index: number, value: string, encoded: boolean }>> = {}
  const re = /;\s*([^\s=;]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/g
  for (let match = re.exec(text); match; match = re.exec(text)) {
    const key = match[1].toLowerCase()
    let raw = match[2].trim()
    if (raw.startsWith('"')) raw = raw.slice(1, -1).replace(/\\(.)/g, '$1')
    const part = /^(.+?)\*(\d+)?(\*)?$/.exec(key)
    if (part) {
      const list = extended[part[1]] ?? []
      list.push({ index: Number(part[2] ?? 0), value: raw, encoded: Boolean(part[3]) || part[2] === undefined })
      extended[part[1]] = list
    } else {
      params[key] = raw
    }
  }
  for (const [key, list] of Object.entries(extended)) {
    list.sort((a, b) => a.index - b.index)
    const first = list[0]
    const charset = first.encoded ? /^([^']*)'/.exec(first.value)?.[1] : undefined
    params[key] = list.map((entry, index) => {
      if (!entry.encoded) return entry.value
      return index === 0 ? decodeRfc2231(entry.value) : decodeRfc2231(entry.value, charset)
    }).join('')
  }
  return { type, params }
}

export interface MimePart {
  headers: Headers
  type: string
  params: Record<string, string>
  disposition: string
  filename?: string
  /** 還沒解傳輸編碼的內文（binary 字串）。 */
  body: string
  parts: MimePart[]
}

const MAX_DEPTH = 12

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 依 boundary 拆 multipart 內文；前言（preamble）與結語不算。 */
export function splitMultipart(body: string, boundary: string): string[] {
  const delimiter = new RegExp(`^--${escapeRegExp(boundary)}(--)?[ \\t]*$`)
  const parts: string[] = []
  let current: string[] | undefined
  for (const line of body.split(/\r?\n/)) {
    const match = delimiter.exec(line)
    if (match) {
      if (current) parts.push(current.join('\n'))
      current = match[1] ? undefined : []
      if (match[1]) break
      continue
    }
    current?.push(line)
  }
  if (current?.length) parts.push(current.join('\n'))
  return parts
}

export function parsePart(raw: string, depth = 0): MimePart {
  const { header, body } = splitHeaderBody(raw)
  const headers = parseHeaders(header)
  const contentType = parseParamHeader(headers.get('content-type'), 'text/plain')
  const disposition = parseParamHeader(headers.get('content-disposition'))
  const rawName = disposition.params.filename ?? contentType.params.name
  const filename = rawName ? decodeEncodedWords(rawName) : undefined
  const part: MimePart = {
    headers,
    type: contentType.type,
    params: contentType.params,
    disposition: disposition.type,
    ...(filename ? { filename } : {}),
    body,
    parts: [],
  }
  const boundary = contentType.params.boundary
  if (contentType.type.startsWith('multipart/') && boundary && depth < MAX_DEPTH) {
    part.parts = splitMultipart(body, boundary).map(child => parsePart(child, depth + 1))
  }
  return part
}

/** 解傳輸編碼（base64／quoted-printable／7bit／8bit）→ 位元組。 */
export function partBytes(part: MimePart): Uint8Array {
  const encoding = (part.headers.get('content-transfer-encoding') ?? '').trim().toLowerCase()
  if (encoding === 'base64') return decodeBase64(part.body)
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(part.body)
  return binaryToBytes(part.body)
}

/** 文字 part 的內容（依 charset 參數解碼）。 */
export function partText(part: MimePart): string {
  return decodeCharset(partBytes(part), part.params.charset)
}

// Fork（almanac ALMNC-57.1）：Email 匯入（.eml 一封、.mbox 多封）→ 一封信一則外部資料源。
// 規格：almanac/2026-11-22_proposal_data-entry-email-rss-meeting.md §1。
// 存的內容：主旨、寄件者、日期、收件者、純文字內文（HTML 信轉成純文字，去掉引用的舊信），附件只列檔名。
// 去重用 Message-ID（資料源 id 由它決定，重複匯入時 insert … on conflict do nothing）；一次最多收最新的 200 封。
// 全是純函式；讀檔與寫資料庫在 src/lib/source-import/import-files.ts 與 src/lib/workbench/actions.ts。
import { decodeEncodedWords, parseHeaders, parsePart, partText, splitHeaderBody, type MimePart } from './mime'
import { bytesToBinary, formatDateTime, htmlToText, parseDate, stableHash } from './text'

/** .mbox 一次最多匯入幾封（超過只收最新的）。 */
export const MBOX_LIMIT = 200

export interface ParsedEmail {
  /** 去掉角括號的 Message-ID；沒有就是 undefined。 */
  messageId?: string
  subject: string
  from: string
  to: string
  cc: string
  /** 寄件時間（毫秒）；Date 標頭解析不出來就是 undefined。 */
  date?: number
  /** 純文字內文（已去掉引用的舊信）。 */
  text: string
  attachments: string[]
  /** 從哪個檔案匯入的（.eml／.mbox 檔名）；parseEmailFiles 才會填。 */
  fileName?: string
}

/** 字串輸入通常已是 binary 字串（一個位元組一個字元）；含有超過 0xFF 的字元就是一般文字，先轉成 UTF-8 位元組。 */
function toBinary(input: Uint8Array | string): string {
  if (typeof input !== 'string') return bytesToBinary(input)
  return /[^\x00-\xff]/.test(input) ? bytesToBinary(new TextEncoder().encode(input)) : input
}

/** 地址清單：解 RFC 2047、把顯示名稱外面的引號去掉、空白收整齊。 */
export function formatAddresses(value: string | undefined): string {
  return decodeEncodedWords(value).replace(/"([^"]*)"/g, '$1').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
}

function cleanMessageId(value: string | undefined): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  const bracketed = /<([^>]+)>/.exec(text)
  const id = (bracketed ? bracketed[1] : text).trim()
  return id || undefined
}

interface Collected {
  plain: string[]
  html: string[]
  attachments: string[]
}

function isAttachment(part: MimePart, insideRelated: boolean): boolean {
  if (part.disposition === 'attachment') return true
  if (part.type === 'message/rfc822') return true
  if (part.type.startsWith('text/') && !part.filename) return false
  // multipart/related 裡有 Content-ID 的圖片是內嵌在 HTML 裡的，不算附件。
  if (insideRelated && part.headers.get('content-id') && part.disposition !== 'attachment') return false
  return Boolean(part.filename) || !part.type.startsWith('text/')
}

function attachmentName(part: MimePart): string | undefined {
  if (part.filename) return part.filename
  if (part.type === 'message/rfc822') {
    const subject = decodeEncodedWords(parseHeaders(splitHeaderBody(part.body).header).get('subject'))
    return `${subject || 'message'}.eml`
  }
  return part.disposition === 'attachment' ? part.type : undefined
}

/** 走訪 MIME 樹：multipart/alternative 只取一種（純文字優先），其他 multipart 依序收集內文與附件。 */
function collect(part: MimePart, out: Collected, insideRelated = false): void {
  if (part.type.startsWith('multipart/')) {
    if (part.type === 'multipart/alternative') {
      const plain = part.parts.find(child => child.type === 'text/plain' && !isAttachment(child, false))
      const plainText = plain ? partText(plain).trim() : ''
      if (plainText) {
        out.plain.push(plainText)
        // 其他選項裡的附件（例如 related 裡的檔案）仍然要列出來。
        for (const child of part.parts) if (child !== plain && child.type.startsWith('multipart/')) collectAttachmentsOnly(child, out)
        return
      }
      const rich = [...part.parts].reverse().find(child => child.type === 'text/html' || child.type.startsWith('multipart/'))
      if (rich) collect(rich, out, insideRelated)
      return
    }
    const related = part.type === 'multipart/related'
    for (const child of part.parts) collect(child, out, insideRelated || related)
    return
  }
  if (isAttachment(part, insideRelated)) {
    const name = attachmentName(part)
    if (name) out.attachments.push(name)
    return
  }
  if (part.type === 'text/html') out.html.push(partText(part))
  else if (part.type === 'text/plain' || part.type === 'text/enriched' || part.type === '') out.plain.push(partText(part))
}

function collectAttachmentsOnly(part: MimePart, out: Collected): void {
  const scratch: Collected = { plain: [], html: [], attachments: [] }
  collect(part, scratch, part.type === 'multipart/related')
  out.attachments.push(...scratch.attachments)
}

const ATTRIBUTION_RE = [
  /^On\s.+\swrote:?$/i,
  /^.+\swrote:$/i,
  /^在\s?.+写道[:：]?$/,
  /^於\s?.+寫道[:：]?$/,
  /^.+(寫道|写道)[:：]$/,
  /^Le\s.+a écrit\s?:$/i,
  /^Am\s.+schrieb.*:$/i,
]
/** 署名折成兩行時，第一行的開頭。 */
const ATTRIBUTION_START_RE = /^(On\s|在\s?|於\s?|Le\s|Am\s)/i
const FORWARD_RE = /(Forwarded message|Begin forwarded message|轉寄的郵件|轉寄郵件|转发的邮件|轉寄的訊息)/i
const FORWARD_SUBJECT_RE = /^\*?(Subject|主旨|主题)\s*[:：]\*?\s*(FW|Fwd|轉寄|转发)\s*[:：]/i
const ORIGINAL_SEPARATOR_RE = /^-{2,}\s*(Original Message|原始郵件|原始邮件|原始訊息|Ursprüngliche Nachricht|Message d'origine)\s*-{2,}\s*$/i
const OUTLOOK_FROM_RE = /^\*?(From|寄件者|发件人|寄件人)\s*[:：]\*?\s*\S/i
const OUTLOOK_META_RE = /^\*?(Sent|Date|寄件日期|发送时间|日期|傳送時間|To|收件者|收件人)\s*[:：]/i

function isQuoted(line: string): boolean {
  return /^\s*>/.test(line)
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

/**
 * 保守地去掉引用的舊信，只在很確定的地方切：
 * 1. 「-----Original Message-----」這種分隔線、或 Outlook 的「From:／Sent:」標頭區塊開始的地方，之後全部去掉；
 * 2. 結尾連續的「>」引用行，以及它上面的「On … wrote:」「於 … 寫道：」署名行。
 * 中間穿插回覆的引用不動；切完沒有內容就保留原文。轉寄（Forwarded message）的內容是信的本體，不去掉。
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let end = lines.length

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (ORIGINAL_SEPARATOR_RE.test(line)) {
      end = index
      break
    }
    if (/^_{8,}$/.test(line) || OUTLOOK_FROM_RE.test(line)) {
      const start = /^_{8,}$/.test(line) ? index + 1 : index
      const block = lines.slice(start + 1, start + 6).map(next => next.trim())
      if (OUTLOOK_FROM_RE.test(lines[start]?.trim() ?? '') && block.some(next => OUTLOOK_META_RE.test(next))) {
        const before = lines.slice(0, index).filter(entry => !isBlank(entry))
        // 轉寄（上面是轉寄分隔線、或主旨是 FW:）的內容是信的本體，不切。
        const forwarded = before.slice(-2).some(entry => FORWARD_RE.test(entry)) || block.some(next => FORWARD_SUBJECT_RE.test(next))
        if (before.length && !forwarded) {
          end = index
          break
        }
      }
    }
  }

  let cut = end
  // 結尾的引用區塊（中間可以有空行）。
  let cursor = cut - 1
  while (cursor >= 0 && isBlank(lines[cursor])) cursor--
  if (cursor >= 0 && isQuoted(lines[cursor])) {
    let start = cursor
    while (start - 1 >= 0 && (isQuoted(lines[start - 1]) || isBlank(lines[start - 1]))) start--
    while (start < cursor && isBlank(lines[start])) start++
    cut = start
    // 署名行可能折成兩行（「On Mon, … Scott Chen <」＋「scott@x.com> wrote:」）。
    let above = cut - 1
    while (above >= 0 && isBlank(lines[above])) above--
    if (above >= 0) {
      const one = lines[above].trim()
      const first = above >= 1 ? lines[above - 1].trim() : ''
      const two = first ? `${first} ${one}` : ''
      const wrapped = two && ATTRIBUTION_START_RE.test(first) && !ATTRIBUTION_START_RE.test(one) && !/[。.!?！？:：]$/.test(first) && two.length <= 200
      if (wrapped && ATTRIBUTION_RE.some(re => re.test(two))) cut = above - 1
      else if (ATTRIBUTION_RE.some(re => re.test(one))) cut = above
    }
  }

  const kept = lines.slice(0, cut).join('\n').trim()
  return kept || text.trim()
}

function normalizeBody(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t ]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 解析一封信（.eml 的內容，或 .mbox 裡的一段）。 */
export function parseEml(input: Uint8Array | string): ParsedEmail {
  const root = parsePart(toBinary(input))
  const headers = root.headers
  const collected: Collected = { plain: [], html: [], attachments: [] }
  collect(root, collected)
  const rawText = collected.plain.length
    ? collected.plain.join('\n\n')
    : collected.html.map(htmlToText).join('\n\n')
  const messageId = cleanMessageId(headers.get('message-id'))
  const date = parseDate(headers.get('date'))
  return {
    ...(messageId ? { messageId } : {}),
    subject: decodeEncodedWords(headers.get('subject')),
    from: formatAddresses(headers.get('from')),
    to: formatAddresses(headers.all('to').join(', ')),
    cc: formatAddresses(headers.all('cc').join(', ')),
    ...(date !== undefined ? { date } : {}),
    text: normalizeBody(stripQuotedReply(normalizeBody(rawText))),
    attachments: Array.from(new Set(collected.attachments)),
  }
}

/** 至少要有寄件者、主旨、Message-ID 或日期其中之一，才算一封信（避免把隨便一個檔案當成信）。 */
export function looksLikeEmail(email: ParsedEmail): boolean {
  return Boolean(email.messageId || email.from || email.subject || email.date !== undefined)
}

/**
 * 拆 .mbox：每封信從行首的「From 」開始（mboxo／mboxrd）；內文裡被跳脫的「>From 」還原一個「>」。
 */
export function splitMbox(input: Uint8Array | string): string[] {
  const binary = toBinary(input)
  const messages: string[] = []
  const starts: number[] = []
  const re = /(^|\n)From [^\n]*/g
  for (let match = re.exec(binary); match; match = re.exec(binary)) {
    starts.push(match.index + match[1].length)
  }
  if (!starts.length) return binary.trim() ? [binary] : []
  for (let index = 0; index < starts.length; index++) {
    const chunk = binary.slice(starts[index], starts[index + 1] ?? binary.length)
    const firstBreak = chunk.indexOf('\n')
    const body = firstBreak < 0 ? '' : chunk.slice(firstBreak + 1)
    const unescaped = body.replace(/^>(>*From )/gm, '$1')
    if (unescaped.trim()) messages.push(unescaped)
  }
  return messages
}

export interface EmailBatch {
  /** 由新到舊，已去重、最多 limit 封。 */
  emails: ParsedEmail[]
  /** 檔案裡認得出來的信件總數（去重前）。 */
  total: number
  /** 同一批裡重複的封數（同一個 Message-ID）。 */
  duplicates: number
  /** 超過上限沒收的封數。 */
  dropped: number
}

export function emailKey(email: ParsedEmail): string {
  return email.messageId ?? `sha:${stableHash([email.from, email.subject, email.date ?? '', email.text.slice(0, 200)].join('\n'))}`
}

/** 去重（Message-ID）並只留最新的 limit 封；沒有日期的信依檔案裡的順序（越後面越新）。 */
export function selectEmails(emails: readonly ParsedEmail[], limit = MBOX_LIMIT): EmailBatch {
  const seen = new Set<string>()
  const unique: Array<{ email: ParsedEmail, index: number }> = []
  emails.forEach((email, index) => {
    const key = emailKey(email)
    if (seen.has(key)) return
    seen.add(key)
    unique.push({ email, index })
  })
  unique.sort((a, b) => (b.email.date ?? -Infinity) - (a.email.date ?? -Infinity) || b.index - a.index)
  const kept = unique.slice(0, limit)
  return { emails: kept.map(entry => entry.email), total: emails.length, duplicates: emails.length - unique.length, dropped: unique.length - kept.length }
}

/** 解析 .mbox 裡的每一封信（認不出是信的段落略過）。 */
export function parseMbox(input: Uint8Array | string): ParsedEmail[] {
  return splitMbox(input).map(raw => parseEml(raw)).filter(looksLikeEmail)
}

/** 檔案是不是 .mbox：副檔名 .mbox、Mail.app 匯出的資料夾裡那個沒有副檔名的「mbox」檔，或內容以「From 」開頭。 */
export function isMboxFile(name: string, head: string): boolean {
  const base = name.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (base.endsWith('.mbox') || base === 'mbox') return true
  if (base.endsWith('.eml')) return false
  return /^From \S/.test(head)
}

/** 一批檔案（.eml／.mbox 混著也可以）→ 由新到舊、去重、最多 limit 封。 */
export function parseEmailFiles(files: ReadonlyArray<{ name: string, bytes: Uint8Array }>, limit = MBOX_LIMIT): EmailBatch {
  const emails: ParsedEmail[] = []
  for (const file of files) {
    const binary = bytesToBinary(file.bytes)
    const fileName = file.name.split(/[\\/]/).pop() || file.name
    if (isMboxFile(file.name, binary.slice(0, 64))) emails.push(...parseMbox(binary).map(email => ({ ...email, fileName })))
    else {
      const email = parseEml(binary)
      if (looksLikeEmail(email)) emails.push({ ...email, fileName })
    }
  }
  return selectEmails(emails, limit)
}

/** 資料源 id：由 Message-ID 決定，同一封信再匯入會撞到同一個 id（不會重複）。 */
export function emailSourceId(email: ParsedEmail): string {
  return `src_email:${emailKey(email)}`
}

/**
 * 資料源內容：第一行是主旨（工作台拿第一行當標題），接著寄件者、收件者、副本、日期、附件，空一行後是內文。
 * offsetMinutes 給測試固定時區用。
 */
export function emailSourceContent(email: ParsedEmail, offsetMinutes?: number): string {
  const meta = [
    email.from && `寄件者：${email.from}`,
    email.to && `收件者：${email.to}`,
    email.cc && `副本：${email.cc}`,
    email.date !== undefined && `日期：${formatDateTime(email.date, offsetMinutes)}`,
    email.attachments.length > 0 && `附件：${email.attachments.join('、')}`,
  ].filter(Boolean)
  return [email.subject || '（沒有主旨）', '', ...meta, ...(email.text ? ['', email.text] : [])].join('\n')
}

/** 一批信 → 要寫進資料源表的內容（由新到舊）；來處是匯入的檔名。 */
export function emailSourceInputs(batch: Pick<EmailBatch, 'emails'>, offsetMinutes?: number): Array<{ id: string, kind: 'email', content: string, origin?: string }> {
  return batch.emails.map(email => ({
    id: emailSourceId(email),
    kind: 'email' as const,
    content: emailSourceContent(email, offsetMinutes),
    ...(email.fileName ? { origin: email.fileName } : {}),
  }))
}

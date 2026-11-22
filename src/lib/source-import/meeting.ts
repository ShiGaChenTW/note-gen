// Fork（almanac ALMNC-57.3）：會議逐字稿匯入（.vtt、.srt、.txt、.docx）→ 一場會議一則外部資料源。
// 規格：almanac/2026-11-22_proposal_data-entry-email-rss-meeting.md §3。
// 存的內容：標題（檔名或第一行）、日期、與會者（從講者名稱整理）、整理過的逐字稿——去掉時間碼，同一位講者連續的句子合併成段落，保留講者名。
// 支援 Zoom（「名字: 內容」）、Teams（<v 名字>）、Google Meet（「名字: 內容」＋時間行）、Otter／Teams .docx（「名字  0:03」標頭行）與沒有講者的檔案。
// 全是純函式；.docx 先由 document-parser 轉成文字（import-files.ts）。
import { decodeEntities, formatDateTime, stableHash } from './text'

export interface MeetingParagraph {
  speaker?: string
  text: string
}

export interface MeetingTranscript {
  title: string
  /** YYYY-MM-DD；檔名或開頭幾行找不到就用檔案修改時間，都沒有就是 undefined。 */
  date?: string
  /** 與會者（講者名，依第一次發言的順序）。 */
  participants: string[]
  paragraphs: MeetingParagraph[]
  /** 逐字稿的長度（只有 .vtt／.srt 有時間碼時才知道）。 */
  durationMs?: number
  fileName: string
}

export interface MeetingParseOptions {
  /** 找不到日期時用的時間（檔案修改時間，毫秒）。 */
  fallbackDate?: number
  /** 文字是從 .docx 轉出來的 Markdown（去掉粗體、跳脫字元這些標記）。 */
  markdown?: boolean
  /** 時區（分鐘），給測試固定用；預設本機。 */
  offsetMinutes?: number
}

/** 沒有講者時，一段最多大約這麼多字就換段（太長的段落不好讀）。 */
const PARAGRAPH_SOFT_LIMIT = 400
const MAX_SPEAKER_CHARS = 40

/** 看起來像「名字：」但其實是筆記欄位的標籤，不當講者。 */
const NOT_SPEAKERS = new Set([
  '決議', '決定', '待辦', '待辦事項', '結論', '議程', '備註', '注意', '時間', '地點', '日期', '與會者', '與會人員', '出席', '出席者', '主持', '主持人',
  '紀錄', '記錄', '主題', '會議主題', '会议主题', '决议', '待办', '议程', '备注', '与会者', '记录',
  'note', 'notes', 'agenda', 'action', 'action item', 'action items', 'decision', 'decisions', 'summary', 'date', 'time', 'location',
  'attendees', 'participants', 'todo', 'to do', 'subject', 'topic', 'http', 'https',
])

const CJK = /[⺀-〿㐀-鿿豈-﫿＀-￯]/

function fileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  return base.replace(/\.[^.]+$/, '').replace(/[.\s_-]+transcript$/i, '').trim() || base
}

/** 「00:01:02.345」「01:02.345」「00:01:02,345」→ 毫秒。 */
export function parseTimestamp(value: string): number | undefined {
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(value.trim())
  if (!match) return undefined
  const [, hours, minutes, seconds, fraction] = match
  return ((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number((fraction ?? '0').padEnd(3, '0'))
}

function validDate(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** 從檔名或文字裡找日期：2026-11-20、2026/11/20、2026年11月20日、20261120（Zoom 檔名）、November 20, 2026（Teams）。 */
export function findDate(text: string): string | undefined {
  const separated = /(20\d{2})\s*[-_/.年]\s*(\d{1,2})\s*[-_/.月]\s*(\d{1,2})/.exec(text)
  if (separated) {
    const date = validDate(Number(separated[1]), Number(separated[2]), Number(separated[3]))
    if (date) return date
  }
  const compact = /(?:^|\D)(20\d{2})(\d{2})(\d{2})(?!\d)/.exec(text)
  if (compact) {
    const date = validDate(Number(compact[1]), Number(compact[2]), Number(compact[3]))
    if (date) return date
  }
  const english = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i.exec(text)
  if (english) return validDate(Number(english[3]), MONTHS.indexOf(english[1].toLowerCase().slice(0, 3)) + 1, Number(english[2]))
  return undefined
}

function cleanCueText(text: string): string {
  return decodeEntities(text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<\/?(?:c|i|b|u|ruby|rt|lang|font)\b[^>]*>/gi, '')
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, '')
    .replace(/<[^>]+>/g, ''))
    .replace(/[‎‏]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 講者名是否合理：長度、不是時間或數字、沒有句子標點、不是筆記欄位。 */
export function isSpeakerName(raw: string): boolean {
  const name = raw.trim()
  if (!name || Array.from(name).length > MAX_SPEAKER_CHARS) return false
  if (/^\d+$/.test(name) || /\d{1,2}:\d{2}/.test(name) || /https?$|\/\//i.test(name)) return false
  if (/[。，,!?！？;；"“”「」]/.test(name)) return false
  if (!CJK.test(name) && name.split(/\s+/).length > 6) return false
  return !NOT_SPEAKERS.has(name.toLowerCase())
}

interface Labeled {
  label?: string
  text: string
}

interface Entry extends Labeled {
  /** 這一行自己帶著講者標記（不是沿用上一行的講者）。 */
  explicit?: boolean
  /** <v> 標記、Zoom 聊天這種一定是講者的標記。 */
  strong?: boolean
  /** 「名字  0:03」標頭行（本身沒有內容）。 */
  header?: boolean
  /** 原本的那一行（標記沒被接受時還原用）。 */
  raw: string
  breakBefore?: boolean
}

/** 一行裡的講者標記：<v 名字>、「名字: 內容」、「[名字] 內容」、「>> 名字: 內容」。 */
function splitLabel(line: string): Labeled {
  const voice = /^<v(?:\.[\w.-]+)?\s+([^>]+)>([\s\S]*?)(?:<\/v>)?$/i.exec(line.trim())
  if (voice) return { label: voice[1].trim(), text: cleanCueText(voice[2]) }
  const text = cleanCueText(line).replace(/^>>\s*/, '').replace(/^-\s+/, '')
  const bracket = /^\[([^\]]{1,40})\]\s*(.+)$/.exec(text)
  if (bracket && isSpeakerName(bracket[1])) return { label: bracket[1].trim(), text: bracket[2].trim() }
  const colon = /^([^:：]{1,40}?)\s*[:：]\s*(.*)$/.exec(text)
  if (colon && isSpeakerName(colon[1]) && colon[2].trim()) return { label: colon[1].trim(), text: colon[2].trim() }
  return { text }
}

/**
 * 決定哪些標記真的是講者：出現兩次以上的，或檔案裡大部分的行都自己帶著標記時全部都算；<v> 標記一定算。
 * 只出現一次、又是少數的「注意：…」「我們約明天 10:30」這種留在內文裡。沿用上一行講者的行不算數。
 */
function acceptedLabels(entries: readonly Entry[]): Set<string> {
  const counts = new Map<string, number>()
  let explicit = 0
  for (const entry of entries) {
    if (!entry.label || !entry.explicit) continue
    explicit++
    counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1)
  }
  const content = entries.filter(entry => entry.explicit || entry.text).length
  const majority = content > 0 && explicit / content >= 0.5
  const accepted = new Set<string>()
  for (const entry of entries) {
    if (entry.label && entry.explicit && (entry.strong || majority || (counts.get(entry.label) ?? 0) >= 2)) accepted.add(entry.label)
  }
  return accepted
}

/** 標記被接受就是講者的一句；沒被接受時，自己帶標記的行還原成原文，沿用的行就是沒有講者的文字。 */
function toSegment(entry: Entry, accepted: ReadonlySet<string>): Segment {
  if (entry.label && accepted.has(entry.label)) return { speaker: entry.label, text: entry.text }
  return { text: entry.explicit ? entry.raw : entry.text, ...(entry.breakBefore ? { breakBefore: true } : {}) }
}

function joinText(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  const last = a.slice(-1)
  const first = b[0]
  return CJK.test(last) && CJK.test(first) ? `${a}${b}` : `${a} ${b}`
}

interface Segment {
  speaker?: string
  text: string
  /** 這一句之前有空行（沒有講者時當成換段）。 */
  breakBefore?: boolean
}

/** 同一位講者連續的句子合併成段落；沒有講者時在空行或段落太長時換段。 */
export function mergeSegments(segments: readonly Segment[]): MeetingParagraph[] {
  const paragraphs: MeetingParagraph[] = []
  for (const segment of segments) {
    const text = segment.text.trim()
    if (!text) continue
    const last = paragraphs[paragraphs.length - 1]
    const sameSpeaker = last && last.speaker === segment.speaker
    const continues = sameSpeaker && (segment.speaker !== undefined || (!segment.breakBefore && Array.from(last.text).length < PARAGRAPH_SOFT_LIMIT))
    if (continues) last.text = joinText(last.text, text)
    else paragraphs.push({ ...(segment.speaker ? { speaker: segment.speaker } : {}), text })
  }
  return paragraphs
}

function participantsOf(paragraphs: readonly MeetingParagraph[]): string[] {
  return Array.from(new Set(paragraphs.map(paragraph => paragraph.speaker).filter((name): name is string => Boolean(name))))
}

function resolveDate(sources: readonly string[], options: MeetingParseOptions): string | undefined {
  for (const source of sources) {
    const date = findDate(source)
    if (date) return date
  }
  if (options.fallbackDate === undefined) return undefined
  return formatDateTime(options.fallbackDate, options.offsetMinutes).slice(0, 10)
}

interface Cue {
  start?: number
  end?: number
  lines: string[]
}

const TIMING_RE = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/

function parseCues(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const timingIndex = lines.findIndex(line => TIMING_RE.test(line))
    if (timingIndex < 0) continue
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0].trim())) continue
    const timing = TIMING_RE.exec(lines[timingIndex])!
    cues.push({ start: parseTimestamp(timing[1]), end: parseTimestamp(timing[2]), lines: lines.slice(timingIndex + 1).filter(line => line.trim()) })
  }
  return cues
}

/** .vtt 與 .srt 共用：時間碼去掉，捲動字幕重複的行只留一次。 */
function parseCueTranscript(text: string, fileName: string, options: MeetingParseOptions): MeetingTranscript {
  const cues = parseCues(text)
  const entries: Entry[] = []
  let previous: string[] = []
  for (const cue of cues) {
    const fresh = cue.lines.filter(line => !previous.includes(line.trim()))
    previous = cue.lines.map(line => line.trim())
    // 一個 cue 有好幾行時，第一行的講者延續到後面沒有標記的行。
    let speaker: string | undefined
    for (const line of fresh) {
      const labeled = splitLabel(line)
      if (labeled.label) {
        speaker = labeled.label
        entries.push({ ...labeled, explicit: true, strong: /^<v[\s.]/i.test(line.trim()), raw: cleanCueText(line) })
      } else {
        entries.push({ label: speaker, text: labeled.text, raw: labeled.text })
      }
    }
  }
  const accepted = acceptedLabels(entries)
  const paragraphs = mergeSegments(entries.map(entry => toSegment(entry, accepted)))
  const ends = cues.map(cue => cue.end).filter((value): value is number => value !== undefined)
  const starts = cues.map(cue => cue.start).filter((value): value is number => value !== undefined)
  const durationMs = ends.length && starts.length ? Math.max(...ends) - Math.min(...starts) : undefined
  return {
    title: fileStem(fileName),
    ...(optionalDate(resolveDate([fileName, text.slice(0, 300)], options))),
    participants: participantsOf(paragraphs),
    paragraphs,
    ...(durationMs && durationMs > 0 ? { durationMs } : {}),
    fileName,
  }
}

function optionalDate(date: string | undefined): { date?: string } {
  return date ? { date } : {}
}

export function parseVtt(text: string, fileName: string, options: MeetingParseOptions = {}): MeetingTranscript {
  return parseCueTranscript(text, fileName, options)
}

export function parseSrt(text: string, fileName: string, options: MeetingParseOptions = {}): MeetingTranscript {
  return parseCueTranscript(text, fileName, options)
}

function stripMarkdown(line: string): string {
  // 先把跳脫的字元換成暫存記號，去掉粗體／斜體後再換回來（「\\*進度\\*」不是斜體）。
  return line
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, (_, char: string) => `\uE000${char.charCodeAt(0)}\uE001`)
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/\uE000(\d+)\uE001/g, (_, code: string) => String.fromCharCode(Number(code)))
}

const TIME_ONLY_RE = /^[[(]?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?[\])]?$/
/** 「名字  0:03」「名字 (00:01:02)」：Otter、Teams .docx 的講者標頭行。 */
const HEADER_RE = /^(.{1,40}?)\s+[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d{1,3})?[\])]?$/
/** 開頭的時間碼：「[00:01:02] 名字: 內容」「00:01:02 內容」。 */
const LEADING_TIME_RE = /^[[(]?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?[\])]?\s+(.+)$/
/** Zoom 聊天紀錄：「10:00:15 From Scott Chen to Everyone: 內容」。 */
const ZOOM_CHAT_RE = /^(?:\d{1,2}:\d{2}:\d{2}\s+)?From\s+(.+?)\s+to\s+.+?:\s*(.*)$/i

/** 開頭的中繼資料行（日期、長度），不放進逐字稿：Teams .docx 的「November 20, 2026, 2:00AM」「42m 5s」。 */
function isMetaLine(line: string): boolean {
  if (/^(日期|時間|时间|Date|Time)\s*[:：]/i.test(line)) return true
  if (/^\d+\s*(h|hr|小時|小时)?\s*\d*\s*(m|min|分鐘|分钟|分)\s*\d*\s*(s|秒)?$/i.test(line)) return true
  if (findDate(line) === undefined) return false
  // 只有日期、時間、星期的行才算（「2026/11/20 的會議我們決定…」是內容，不能丟）。
  const rest = line
    .replace(/20\d{2}\s*[-_/.年]\s*\d{1,2}\s*[-_/.月]\s*\d{1,2}\s*日?/g, '')
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+20\d{2}/gi, '')
    .replace(/\b20\d{6}\b/g, '')
    .replace(/\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?/gi, '')
    .replace(/(上午|下午|早上|晚上|中午)/g, '')
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?/gi, '')
    .replace(/(週|周|星期)[一二三四五六日天]/g, '')
    .replace(/[\s,，、()（）\-–—|/:：]/g, '')
  return Array.from(rest).length <= 2
}

/** 一般文字逐字稿（.txt，或 .docx 轉出來的文字）。 */
export function parseTranscriptText(text: string, fileName: string, options: MeetingParseOptions = {}): MeetingTranscript {
  const rawLines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const lines = rawLines.map(line => (options.markdown ? stripMarkdown(line) : line).replace(/\u00a0/g, ' ').trim())

  const entries: Entry[] = []
  let blockSpeaker: string | undefined
  let blank = false
  for (const line of lines) {
    if (!line) {
      blank = true
      continue
    }
    if (TIME_ONLY_RE.test(line)) continue
    const header = HEADER_RE.exec(line)
    if (header && isSpeakerName(header[1])) {
      blockSpeaker = header[1].trim()
      entries.push({ label: blockSpeaker, text: '', explicit: true, header: true, raw: line, breakBefore: blank })
      blank = false
      continue
    }
    const chat = ZOOM_CHAT_RE.exec(line)
    const body = chat ? `${chat[1]}: ${chat[2]}` : (LEADING_TIME_RE.exec(line)?.[1] ?? line)
    const labeled = splitLabel(body)
    if (labeled.label) entries.push({ ...labeled, explicit: true, strong: Boolean(chat), raw: body })
    else entries.push({ label: blockSpeaker, text: labeled.text, raw: labeled.text, breakBefore: blank })
    blank = false
  }

  // 「名字  0:03」標頭行有兩行以上，就是 Otter／Teams 這種格式：標頭裡的名字都是講者（只有一行時可能只是「我們約明天 10:30」）。
  if (entries.filter(entry => entry.header).length >= 2) {
    for (const entry of entries) if (entry.header) entry.strong = true
  }
  const accepted = acceptedLabels(entries)
  // 第一行是沒有講者的短句就當標題（Google Meet 的「週會 - Transcript」、Teams .docx 的會議名稱），不再放進逐字稿。
  const first = entries[0]
  const titleFromText = first && !first.explicit && !first.label && Array.from(first.text).length <= 100
    ? first.text.replace(/\s*[-–—]\s*(Transcript|轉錄稿|逐字稿|转录稿)$/i, '').trim()
    : ''
  const firstSpeaker = entries.findIndex(entry => entry.label && accepted.has(entry.label))
  const segments: Segment[] = []
  entries.forEach((entry, index) => {
    if (titleFromText && index === 0) return
    // 標頭行被接受時本身沒有內容；沒被接受（例如「我們約明天 10:30」）就是一般文字。
    if (entry.header && entry.label && accepted.has(entry.label)) return
    const leading = firstSpeaker < 0 ? index < 6 : index < firstSpeaker
    if (leading && !entry.explicit && isMetaLine(entry.text)) return
    segments.push(toSegment(entry, accepted))
  })
  const paragraphs = mergeSegments(segments)
  return {
    title: titleFromText || fileStem(fileName),
    ...optionalDate(resolveDate([fileName, lines.slice(0, 8).join('\n')], options)),
    participants: participantsOf(paragraphs),
    paragraphs,
    fileName,
  }
}

/** 依副檔名分流；.txt 裡其實是字幕（有「-->」時間碼）時也當字幕解析。 */
export function parseMeetingFile(fileName: string, text: string, options: MeetingParseOptions = {}): MeetingTranscript {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if (ext === 'vtt' || ext === 'srt' || TIMING_RE.test(text.split('\n').find(line => line.includes('-->')) ?? '')) {
    return parseCueTranscript(text, fileName, options)
  }
  return parseTranscriptText(text, fileName, { ...options, markdown: options.markdown ?? ext === 'docx' })
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分鐘` : `${minutes} 分鐘`
}

/** 資料源內容：第一行標題，接著日期、與會者、長度、檔案，空一行後是逐字稿（「講者：內容」一段一段）。 */
export function meetingSourceContent(meeting: MeetingTranscript): string {
  const meta = [
    meeting.date && `日期：${meeting.date}`,
    meeting.participants.length > 0 && `與會者：${meeting.participants.join('、')}`,
    meeting.durationMs !== undefined && `長度：${formatDuration(meeting.durationMs)}`,
    `檔案：${meeting.fileName}`,
  ].filter(Boolean)
  const body = meeting.paragraphs.map(paragraph => (paragraph.speaker ? `${paragraph.speaker}：${paragraph.text}` : paragraph.text)).join('\n\n')
  return [meeting.title, '', ...meta, ...(body ? ['', body] : [])].join('\n')
}

/** 寫進資料源表的內容。id 由檔名＋逐字稿內容決定：同一個檔案再匯入會跳過，同名但內容不同的照樣收。 */
export function meetingSourceInput(meeting: MeetingTranscript): { id: string, kind: 'meeting', content: string, origin: string } {
  const content = meetingSourceContent(meeting)
  const body = meeting.paragraphs.map(paragraph => `${paragraph.speaker ?? ''}\u0000${paragraph.text}`).join('\n')
  return { id: `src_meeting:${meeting.fileName}#${stableHash(body)}`, kind: 'meeting', content, origin: meeting.fileName }
}

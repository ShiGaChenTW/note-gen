// Daily Note 解析與早晨 / 復盤標記，純函式、無 I/O。
// 移植自 personal/plugin-skeleton/notegen-today/entry.js，該檔再移植自 command-center_v2；來源以註解標示。
import { TASK_CHECKBOX_RE } from './tasks'

export interface DailyBullet {
  text: string
  lineNo: number
  raw: string
  isTask: boolean
  done: boolean
}

export interface DailyMit extends DailyBullet {
  // 0 = 未標，1 = 🟢，2 = 🟡，3 = 🔴
  priority: number
}

export interface DailyAnchor extends DailyBullet {
  // HH:mm；該行沒有時間時為空字串
  time: string
}

export interface DailyNote {
  tone: string | null
  oneThing: DailyBullet | null
  mits: DailyMit[]
  anchors: DailyAnchor[]
  capture: { total: number, flash: number, read: number, task: number }
  reflection: { filled: boolean, done: string | null }
  morning: boolean
  reviewed: boolean
}

export type StampKind = 'morning' | 'review'

// cockpit/dailyNote.ts:33-166
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu
export function cleanText(s: string): string {
  return s.replace(EMOJI_RE, '')
    .replace(/[\[（(]\s*\w+::[^\]）)]*[\]）)]/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ').trim()
}

const BULLET_RE = /^\s*[-*+](?:\s+(.*))?$/
function parseBullet(raw: string, lineNo: number): DailyBullet | null {
  const t = raw.match(TASK_CHECKBOX_RE)
  if (t) return { text: cleanText(t[3].replace(/^\]\s*/, '')), lineNo, raw, isTask: true, done: t[2].toLowerCase() === 'x' }
  const b = raw.match(BULLET_RE)
  if (!b) return null
  return { text: cleanText(b[1] ?? ''), lineNo, raw, isTask: false, done: false }
}

function bulletsAfter(lines: string[], headIdx: number): DailyBullet[] {
  const out: DailyBullet[] = []
  for (let i = headIdx + 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) { if (out.length) break; continue }
    const b = parseBullet(raw, i)
    if (!b) break
    out.push(b)
  }
  return out
}

function findLine(lines: string[], re: RegExp, from = 0, to = lines.length): number {
  for (let i = from; i < to; i++) if (re.test(lines[i])) return i
  return -1
}

function sectionRange(lines: string[], headRe: RegExp): [number, number] | null {
  const start = findLine(lines, headRe)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) { end = i; break }
  return [start, end]
}

function priorityOf(raw: string): number {
  if (raw.includes('\u{1F534}')) return 3
  if (raw.includes('\u{1F7E1}')) return 2
  if (raw.includes('\u{1F7E2}')) return 1
  return 0
}

// dailyOps.ts:20 hasMarker：`morning:: done` / `reviewed:: done`
const hasMarker = (md: string, key: string) => new RegExp(`^${key}::\\s*done\\s*$`, 'm').test(md)

export function parseDailyNote(md: string): DailyNote {
  const lines = md.split('\n').map(l => l.replace(/\r$/, ''))

  let tone: string | null = null
  const toneIdx = findLine(lines, /一句話定調/)
  if (toneIdx >= 0) {
    const after = lines[toneIdx].split(/→|->/).slice(1).join('→')
    const t = cleanText(after.replace(/^>\s*/, ''))
    tone = t || null
  }

  let oneThing: DailyBullet | null = null
  const oneIdx = findLine(lines, /唯一要務|The ONE Thing/i)
  if (oneIdx >= 0) oneThing = bulletsAfter(lines, oneIdx).find(b => b.text) ?? null

  const mitIdx = findLine(lines, /三件\s*MIT/i)
  const mits: DailyMit[] = mitIdx >= 0
    ? bulletsAfter(lines, mitIdx).filter(b => b.text).map(b => ({ ...b, priority: priorityOf(b.raw) }))
    : []

  const anchorIdx = findLine(lines, /錨點時段/)
  const anchors: DailyAnchor[] = anchorIdx >= 0
    ? bulletsAfter(lines, anchorIdx).filter(b => b.text).map(b => {
      const m = b.text.match(/^(\d{1,2}):(\d{2})\s*(?:[-–~]\s*\d{1,2}:\d{2})?\s*(.*)$/)
      if (!m) return { ...b, time: '' }
      return { ...b, time: `${m[1].padStart(2, '0')}:${m[2]}`, text: m[3].trim() || b.text }
    })
    : []

  const capture = { total: 0, flash: 0, read: 0, task: 0 }
  const cap = sectionRange(lines, /^##\s.*捕捉軌/)
  if (cap) for (let i = cap[0] + 1; i < cap[1]; i++) {
    const raw = lines[i]
    if (/^\s*>/.test(raw)) continue
    const b = parseBullet(raw, i)
    if (!b || !b.text) continue
    capture.total++
    if (b.isTask) capture.task++
    if (/#閃/.test(raw)) capture.flash++
    if (/#讀/.test(raw)) capture.read++
  }

  const reflection: DailyNote['reflection'] = { filled: false, done: null }
  const ref = sectionRange(lines, /^##\s.*沉澱/)
  if (ref) for (let i = ref[0] + 1; i < ref[1]; i++) {
    const m = lines[i].match(/^\s*[-*]\s*\*\*(.+?)\*\*.*?[：:]\s*(.*)$/)
    if (!m) continue
    const val = cleanText(m[2])
    if (!val) continue
    reflection.filled = true
    if (/今天真正完成/.test(m[1])) reflection.done = val
  }

  return { tone, oneThing, mits, anchors, capture, reflection, morning: hasMarker(md, 'morning'), reviewed: hasMarker(md, 'reviewed') }
}

/**
 * dailyOps.ts:53-77 markDailyDone：在筆記結尾寫入 `morning:: done` / `reviewed:: done`。
 * 已有標記時回傳 `changed: false` 與原內容。今日筆記不存在要拒絕、不自建空檔，由呼叫端（I/O 層）負責。
 */
export function stamp(content: string, kind: StampKind): { changed: boolean, key: string, content: string } {
  const key = kind === 'morning' ? 'morning' : 'reviewed'
  if (hasMarker(content, key)) return { changed: false, key, content }
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  return { changed: true, key, content: `${content.replace(/\s*$/, '')}${eol}${key}:: done${eol}` }
}

// Fork（almanac ALMNC-54.6）：分析第二到四步——拆開、判斷每個片段（行程／任務／筆記／不採用，參考 GTD「釐清」）、補上下文。
// 模型回傳的 JSON 照收集頁（src/lib/collect/split.ts）的方式嚴格驗證；輸出壞掉時退回一個保底片段，
// 整則原文放進去，絕不把內容丟掉。
import { extractJson, isValidYmd, normalizeTime } from '@/lib/collect/split'
import { NOTE_TYPES, type NoteType } from '@/lib/v3-model/note'
import type { AskModel, Fragment, FragmentKind } from './types'

export const MAX_FRAGMENTS = 12
const MAX_TITLE = 120
const MAX_PEOPLE = 10
const MAX_HINT = 40
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const KINDS: readonly FragmentKind[] = ['event', 'task', 'note', 'reject']

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clip(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('')
}

function stringList(value: unknown, max: number): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、]/) : []
  return Array.from(new Set(list.map(asString).filter(Boolean).map(item => clip(item, MAX_HINT)))).slice(0, max)
}

function firstLine(text: string): string {
  return clip(text.trim().split('\n')[0]?.replace(/^#+\s*/, '').trim() ?? '', 48)
}

export interface SplitContext {
  today: Date
  /** 資料源的形式與來處，給模型一點背景。 */
  sourceKind?: string
  origin?: string
  /** 上一版的內容：有的話只分析新增或改動的部分（規格：只分析新舊版本的差異）。 */
  previousText?: string
  /** Fork（almanac ALMNC-54.10）：Scott 選了「照建議處理」時的初步判斷（「類型｜建議」）。 */
  hint?: string
}

export function buildFragmentPrompt(text: string, context: SplitContext): string {
  const today = `${ymd(context.today)}（週${WEEKDAYS[context.today.getDay()]}）`
  const lines = [
    '你是指揮官，負責清洗、分類 Scott 的資料源。把下面這則資料源拆成片段：一則資料源裡有好幾件事時，拆成好幾個片段。',
    `今天是 ${today}。${context.sourceKind ? `資料源形式：${context.sourceKind}。` : ''}${context.origin ? `來處：${context.origin}。` : ''}`,
    '每個片段判斷成一種 kind（參考 GTD 的「釐清」）：',
    '- event：有明確時間的行程。一定要有 date（YYYY-MM-DD）與 time（HH:mm，24 小時制）。',
    '- task：要做的事。title 用動詞開頭；有期限才填 date。',
    '- note：值得留下的筆記，再判斷 noteType：',
    '  - knowledge：跟時間無關、過一年仍然成立的一個想法（概念、主張或方法），title 寫得成一句話；domainHint 寫它屬於哪個領域（例如「工業工程」）。',
    '  - record：跟時間綁在一起的一個事件（包含行為、習慣、心得反思），填 date。',
    '  - project：跟一件進行中、有目標有結束點的事綁在一起，填 project。',
    '- reject：不值得留下（廣告、重複、雜訊），reason 寫一句理由。',
    '每個片段都補上下文：date（日期）、people（相關的人）、project（所屬專案）；沒有就省略，不要編造。',
    'body 放這個片段對應的原文內容（可以稍微整理，但不要漏掉事實）。',
    `最多 ${MAX_FRAGMENTS} 個片段。`,
    '只輸出 JSON，不要任何說明或程式碼框：',
    '{"fragments":[{"kind":"event|task|note|reject","noteType":"knowledge|record|project","title":"","body":"","date":"","time":"","people":[],"project":"","domainHint":"","tags":[],"reason":""}]}',
  ]
  if (context.hint?.trim()) {
    lines.push(`Scott 看過初步判斷「${context.hint.trim()}」，選了照建議處理：拆片段時以這個建議為準，除非內容明顯不符。`)
  }
  if (context.previousText?.trim()) {
    lines.push('這則資料源是改過的新版本。只拆出新增或改動的部分；和上一版相同的內容不要再拆。', '--- 上一版 ---', context.previousText.trim())
  }
  lines.push('--- 資料源 ---', text.trim())
  return lines.join('\n')
}

/** note 沒說類型時：有專案 → 專案筆記；有日期 → 紀錄筆記；否則知識筆記。 */
function inferNoteType(record: Record<string, unknown>, date: string, project: string): NoteType {
  const raw = asString(record.noteType).toLowerCase()
  if ((NOTE_TYPES as readonly string[]).includes(raw)) return raw as NoteType
  if (project) return 'project'
  if (date) return 'record'
  return 'knowledge'
}

/**
 * 解析模型回傳的片段。寬鬆接受 {fragments:[…]} 或直接陣列、程式碼框、<think>；嚴格驗證每一個：
 * kind 要認得、標題與內文不能都空、日期時間格式要對；event 缺日期或時間就降成 task。
 * 解析不出任何片段時回傳空陣列（呼叫端退回保底片段）。
 */
export function parseFragments(raw: string): Fragment[] {
  const parsed = extractJson(raw)
  const list: unknown = Array.isArray(parsed) ? parsed : (parsed as { fragments?: unknown } | null)?.fragments
  if (!Array.isArray(list)) return []
  const fragments: Fragment[] = []
  for (const item of list) {
    if (fragments.length >= MAX_FRAGMENTS) break
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    let kind = asString(record.kind).toLowerCase() as FragmentKind
    if (!KINDS.includes(kind)) continue
    const body = asString(record.body)
    const title = clip(asString(record.title) || firstLine(body), MAX_TITLE)
    if (!title) continue

    const rawDate = asString(record.date) || asString(record.due)
    const date = isValidYmd(rawDate) ? rawDate : ''
    const time = normalizeTime(asString(record.time))
    if (kind === 'event' && !(date && time)) kind = 'task'
    const project = clip(asString(record.project), MAX_HINT)
    const domainHint = clip(asString(record.domainHint), MAX_HINT)
    const tags = stringList(record.tags, 5).map(tag => tag.replace(/^#/, '')).filter(tag => /^[\p{L}\p{N}_/-]+$/u.test(tag))
    const reason = asString(record.reason)
    fragments.push({
      index: fragments.length,
      kind,
      ...(kind === 'note' ? { noteType: inferNoteType(record, date, project) } : {}),
      title,
      body,
      ...(date ? { date } : {}),
      ...(kind === 'event' ? { time } : {}),
      people: stringList(record.people, MAX_PEOPLE),
      ...(project ? { project } : {}),
      ...(domainHint && kind === 'note' ? { domainHint } : {}),
      tags,
      ...(kind === 'reject' && reason ? { reason } : {}),
    })
  }
  return fragments
}

/** 保底片段：整則原文當成一則紀錄筆記交給指揮官撰寫，Scott 在工作台看得到它沒被拆過。 */
export function fallbackFragment(text: string, title?: string): Fragment {
  return {
    index: 0,
    kind: 'note',
    noteType: 'record',
    title: clip(title?.trim() || firstLine(text) || 'Untitled', MAX_TITLE),
    body: text.trim(),
    people: [],
    tags: [],
    fallback: true,
  }
}

/** 主入口：問模型拆開並判斷；模型失敗、輸出壞掉或一個片段都沒有時退回保底片段。 */
export async function splitAndClassify(text: string, ask: AskModel, context: SplitContext): Promise<Fragment[]> {
  if (!text.trim()) return [fallbackFragment(text, context.origin)]
  try {
    const fragments = parseFragments(await ask(buildFragmentPrompt(text, context)))
    if (fragments.length) return fragments
  } catch (error) {
    console.warn('[commander] split failed, using fallback fragment:', error)
  }
  return [fallbackFragment(text, context.origin)]
}

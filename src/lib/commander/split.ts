// Fork（almanac ALMNC-54.6）：分析第二到四步——拆開、判斷每個片段（行程／任務／筆記／不採用，參考 GTD「釐清」）、補上下文。
// 模型回傳的 JSON 照收集頁（src/lib/collect/split.ts）的方式嚴格驗證；輸出壞掉時退回一個保底片段，
// 整則原文放進去，絕不把內容丟掉。
import { extractJson, isValidYmd, normalizeTime } from '@/lib/collect/split'
import { NOTE_TYPES, type NoteType } from '@/lib/v3-model/note'
import type { AskModel, Confidence, Fragment, FragmentKind, JournalVerdict } from './types'

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
  /** Fork（almanac ALMNC-69.3）：這則資料源已經帶日誌標籤（Scott 貼的）：不產日誌筆記，只找知識片段。 */
  journalTagged?: boolean
  /**
   * Fork（almanac ALMNC-90）：紀錄筆記按「送給指揮官萃取」送來的：原文是日誌筆記、留在原處，
   * 只萃取知識片段（不拆日誌、任務、行程、專案，不判斷整則是不是日誌）。模型失敗時不退回保底片段，丟錯讓分析退回待分析。
   */
  extractKnowledge?: boolean
}

/** Fork（almanac ALMNC-69.3）：拆片段的結果，加上對整則資料源「是不是日誌」的判斷（已帶標籤或模型沒說就沒有）。 */
export interface SplitResult {
  fragments: Fragment[]
  journal?: JournalVerdict
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
    '  - log（日誌筆記）：跟時間綁在一起的一個事件（包含行為、習慣、心得反思），拿掉日期就失去意義，填 date。',
    '  - project：跟一件進行中、有目標有結束點的事綁在一起，填 project。',
    '- reject：不值得留下（廣告、重複、雜訊），reason 寫一句理由。',
    '每個片段都補上下文：date（日期）、people（相關的人）、project（所屬專案）；沒有就省略，不要編造。',
    'body 放這個片段對應的原文內容（可以稍微整理，但不要漏掉事實）。',
    '每個片段都附 reason（一行字的判斷理由，例如「綁定 11/10 週會，拿掉日期就失去意義 → 日誌筆記」）與 confidence（high 或 low；類型介於兩者之間、或同時符合兩種條件時用 low）。',
    `最多 ${MAX_FRAGMENTS} 個片段。`,
  ]
  // Fork（almanac ALMNC-69.3）：日誌標籤。Scott 貼了標籤就照辦；沒貼時指揮官判斷整則是不是 Scott 親手寫的事件記錄，只能提議。
  if (context.extractKnowledge) {
    lines.push('這則資料源是一篇紀錄筆記（會議紀錄或日誌），Scott 請你從裡面萃取知識筆記：原文留在原處，不要拆成日誌筆記，也不要輸出要做的事、行程或專案。只找出裡面一年後仍成立的知識片段（kind 一律 note、noteType 一律 knowledge），title 寫成一句主張。沒有就輸出空的 fragments。')
  } else if (context.journalTagged) {
    lines.push('這則資料源帶「日誌」標籤（Scott 親手寫的事件記錄）：原文就是日誌，不要拆成日誌筆記（不要輸出 noteType log）；只找出裡面一年後仍成立的知識片段，和要做的事。沒有就輸出空的 fragments。')
  } else {
    lines.push('另外判斷整則資料源是不是日誌：Scott 自己寫的整篇事件記錄（做了什麼、發生什麼、當時的感受和反思），原文不拆不搬。是的話 journal.verdict 填 true，這時不要再把它拆成日誌筆記，只找知識片段；附 confidence（high／low）與一行 reason。')
  }
  lines.push(
    '只輸出 JSON，不要任何說明或程式碼框：',
    context.extractKnowledge
      ? '{"fragments":[{"kind":"note","noteType":"knowledge","title":"","body":"","people":[],"domainHint":"","tags":[],"reason":"","confidence":"high|low"}]}'
      : context.journalTagged
      ? '{"fragments":[{"kind":"event|task|note|reject","noteType":"knowledge|project","title":"","body":"","date":"","time":"","people":[],"project":"","domainHint":"","tags":[],"reason":"","confidence":"high|low"}]}'
      : '{"journal":{"verdict":false,"confidence":"high|low","reason":""},"fragments":[{"kind":"event|task|note|reject","noteType":"knowledge|log|project","title":"","body":"","date":"","time":"","people":[],"project":"","domainHint":"","tags":[],"reason":"","confidence":"high|low"}]}',
  )
  // Fork（almanac ALMNC-57.3）：會議逐字稿要抽出決議、待辦與負責人。
  if (context.sourceKind === 'meeting' && !context.extractKnowledge) {
    lines.push(
      '這則資料源是一場會議的逐字稿（每段開頭是「講者：」）。不要逐句摘要，請抽出：',
      '- 決議：會議裡決定的事，每一項拆成一個 note（noteType 用 log，date 填會議日期，people 填參與決定的人）。',
      '- 待辦：要做的事，每一項拆成一個 task；title 用動詞開頭並寫出負責人（例如「Amy：週五前寄報價單給客戶」），people 填負責人，有期限才填 date；沒有說誰負責就在 title 寫「（未指定負責人）」。',
      '- 寒暄、閒聊、重複的討論過程用 reject，或省略。',
    )
  }
  if (context.hint?.trim()) {
    lines.push(`Scott 看過初步判斷「${context.hint.trim()}」，選了照建議處理：拆片段時以這個建議為準，除非內容明顯不符。`)
  }
  if (context.previousText?.trim()) {
    lines.push('這則資料源是改過的新版本。只拆出新增或改動的部分；和上一版相同的內容不要再拆。', '--- 上一版 ---', context.previousText.trim())
  }
  lines.push('--- 資料源 ---', text.trim())
  return lines.join('\n')
}

/**
 * note 沒說類型時：有專案 → 專案筆記；有日期 → 日誌筆記；否則知識筆記。
 * Fork（almanac ALMNC-69.3）：模型寫 log（日誌筆記的新類型值）或舊的 record 都收；內部仍存 record，改值與遷移在 ALMNC-69.4。
 */
function inferNoteType(record: Record<string, unknown>, date: string, project: string): NoteType {
  const raw = asString(record.noteType).toLowerCase()
  if (raw === 'log') return 'record'
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
    const reason = clip(asString(record.reason), MAX_TITLE)
    const confidence = parseConfidence(record.confidence)
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
      ...(reason ? { reason } : {}),
      ...(confidence ? { confidence } : {}),
    })
  }
  return fragments
}

function parseConfidence(value: unknown): Confidence | undefined {
  const raw = asString(value).toLowerCase()
  if (raw === 'high' || raw === '高') return 'high'
  if (raw === 'low' || raw === '低') return 'low'
  return undefined
}

/** Fork（almanac ALMNC-69.3）：解析整則資料源的「判斷為日誌」。只有 verdict 是 true 才回傳（false 不必出現在卡片上）；信心沒給當成低。 */
export function parseJournalVerdict(raw: string): JournalVerdict | undefined {
  const parsed = extractJson(raw)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return undefined
  const journal = (parsed as { journal?: unknown }).journal
  if (!journal || typeof journal !== 'object') return undefined
  const record = journal as Record<string, unknown>
  const verdict = record.verdict === true || asString(record.verdict).toLowerCase() === 'true'
  if (!verdict) return undefined
  const reason = clip(asString(record.reason), MAX_TITLE)
  return { verdict: true, confidence: parseConfidence(record.confidence) ?? 'low', ...(reason ? { reason } : {}) }
}

/**
 * Fork（almanac ALMNC-69.3）：原文本身就是日誌（Scott 貼了標籤，或指揮官判斷為日誌）時，不再拆出日誌筆記，只留其他片段。
 * 保底片段（模型失敗）不動，避免把整則內容丟掉。
 */
export function dropLogFragments(fragments: readonly Fragment[]): Fragment[] {
  return fragments
    .filter(fragment => fragment.fallback || !(fragment.kind === 'note' && fragment.noteType === 'record'))
    .map((fragment, index) => ({ ...fragment, index }))
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

/**
 * Fork（almanac ALMNC-69.3）：拆開、判斷，並帶回「判斷為日誌」。
 * 原文是日誌（帶標籤或判斷為日誌）時去掉日誌筆記片段；帶標籤時一個片段都沒剩是正常的（讀過沒有可提煉的內容），不退回保底片段。
 * 其他情況照舊：模型失敗、輸出壞掉或一個片段都沒有時退回保底片段。
 */
export async function splitSource(text: string, ask: AskModel, context: SplitContext): Promise<SplitResult> {
  if (context.extractKnowledge) return extractKnowledge(text, ask, context)
  if (!text.trim()) return { fragments: context.journalTagged ? [] : [fallbackFragment(text, context.origin)] }
  try {
    const raw = await ask(buildFragmentPrompt(text, context))
    const parsed = parseFragments(raw)
    const journal = context.journalTagged ? undefined : parseJournalVerdict(raw)
    const fragments = context.journalTagged || journal ? dropLogFragments(parsed) : parsed
    const answered = extractJson(raw) !== null
    if (fragments.length || (answered && (context.journalTagged || journal))) return { fragments, ...(journal ? { journal } : {}) }
  } catch (error) {
    console.warn('[commander] split failed, using fallback fragment:', error)
  }
  return { fragments: [fallbackFragment(text, context.origin)] }
}

/** Fork（almanac ALMNC-90）：只留知識筆記片段（萃取模式）。 */
export function keepKnowledgeFragments(fragments: readonly Fragment[]): Fragment[] {
  return fragments
    .filter(fragment => fragment.kind === 'note' && fragment.noteType === 'knowledge')
    .map((fragment, index) => ({ ...fragment, index }))
}

/**
 * Fork（almanac ALMNC-90）：萃取模式。一個知識片段都沒有是正常的（讀過沒有可萃取的）；
 * 模型失敗或輸出壞掉就丟錯，不退回保底片段——保底片段會把整篇紀錄筆記再提案一次。
 */
async function extractKnowledge(text: string, ask: AskModel, context: SplitContext): Promise<SplitResult> {
  if (!text.trim()) return { fragments: [] }
  const raw = await ask(buildFragmentPrompt(text, context))
  if (extractJson(raw) === null) throw new Error('commander: knowledge extraction returned no JSON')
  return { fragments: keepKnowledgeFragments(parseFragments(raw)) }
}

/** 主入口：問模型拆開並判斷；模型失敗、輸出壞掉或一個片段都沒有時退回保底片段。 */
export async function splitAndClassify(text: string, ask: AskModel, context: SplitContext): Promise<Fragment[]> {
  return (await splitSource(text, ask, context)).fragments
}

// Fork（almanac ALMNC-54.10，R2）：自己寫的與系統產生的資料源一進來就自動交給指揮官，不等 Scott。
// 外部擷取的不走這裡（R1：等你決定、附初步判斷，見 judgement.ts 的 ingestSource）。
// 這個檔案只放純邏輯（依賴注入）：哪幾種進來的東西算自己寫的、怎麼組成資料源、加進去後叫佇列一次。
// 接到 App 的部分在 actions.ts（submitAutoSource、registerVoiceMemo、registerDailyEntry、registerRecordText）。
import type { NewSourceInput, Source } from '@/lib/v3-model/source'
import { newSourceType } from './judgement'
import { recordSourceId } from './sources-tab'

/** 自動交給指揮官的資料源；來源類型只有「自己寫的」與「系統產生的」，外部擷取不收。 */
export interface AutoSourceInput extends NewSourceInput {
  sourceType: 'self' | 'system'
}

export interface AutoRouteDeps {
  /** 已經有同一個 id 就跳過、回傳 undefined（重複登錄不會建出第二則）。 */
  addIfAbsent: (input: AutoSourceInput) => Promise<Source | undefined>
  /** 叫指揮官的佇列跑一輪。 */
  kick: () => Promise<void> | void
}

export interface AutoRouteResult {
  /** 這次新增的資料源；已經登錄過、內容是空的則沒有。 */
  source?: Source
  /** 這次有沒有叫佇列。 */
  queued: boolean
}

/**
 * 登錄一則自己寫的／系統產生的資料源並叫指揮官。冪等：同一個 id 第二次進來只回 undefined、不再叫佇列
 * （佇列本身一次只跑一輪，這裡不重複叫是為了不讓同一件事被排兩次）。
 */
export async function routeAutoSource(input: AutoSourceInput, deps: AutoRouteDeps): Promise<AutoRouteResult> {
  if ((input.sourceType as string) === 'external') throw new Error('外部擷取的資料源要等 Scott 決定，不能自動交給指揮官')
  if (!input.content.trim()) return { queued: false }
  const source = await deps.addIfAbsent(input)
  if (!source) return { queued: false }
  // 一進來就是待分析（自己寫的與系統產生的不經過「等你決定」）；萬一不是就不叫，避免替 Scott 做決定。
  if (source.status !== 'pending_analysis') return { source, queued: false }
  await deps.kick()
  return { source, queued: true }
}

/**
 * 語音速記：錄音轉好的逐字稿一則資料源。id 沿用記錄橋接的 rec_<記錄 id>，
 * 所以資料源分頁不會同時列出這則記錄與它的資料源，手動「交給 Mia」也會找到同一則。
 * 還沒有逐字稿（沒設語音辨識、辨識失敗）就不登錄，錄音留在記錄裡等 Scott 處理。
 */
export function voiceMemoSource(memo: { markId: number, transcript: string, audioPath?: string }): AutoSourceInput | undefined {
  const content = memo.transcript.trim()
  if (!content) return undefined
  return {
    id: recordSourceId(memo.markId),
    sourceType: 'self',
    kind: 'transcript',
    content,
    origin: memo.audioPath || undefined,
    collector: 'scott',
  }
}

/** 每日筆記條目：今天頁快速新增寫進每日筆記的一行；來處是那份每日筆記。同一份筆記同一刻只會有一則（id 含寫入時間）。 */
export function dailyEntrySource(entry: { path: string, text: string, at: number }): AutoSourceInput | undefined {
  const content = entry.text.trim()
  if (!content) return undefined
  return {
    id: `src_daily:${entry.path}:${entry.at}`,
    sourceType: 'self',
    kind: 'text',
    content,
    origin: entry.path,
    collector: 'scott',
    collectedAt: entry.at,
  }
}

/**
 * 隨手記／長文草稿（V3 的「記錄」對話框存成記錄時）：自己打的字、待辦、Prompt 素材算自己寫的；
 * 貼上的內容算外部擷取（R1），不在這裡登錄。id 沿用記錄橋接的 rec_<記錄 id>。
 */
export function recordTextSource(record: { markId: number, type: 'text' | 'todo' | 'prompt-draft', content: string, origin?: string, pastedChars?: number }): AutoSourceInput | undefined {
  const content = record.content.trim()
  if (!content) return undefined
  if (newSourceType({ type: record.type, content, pastedChars: record.pastedChars }) !== 'self') return undefined
  return {
    id: recordSourceId(record.markId),
    sourceType: 'self',
    kind: record.type === 'prompt-draft' ? 'prompt' : record.type,
    content,
    origin: record.origin || undefined,
    collector: 'scott',
  }
}

/** 系統產生的資料源（對話結論、指揮官查到的外部資料、任務完成紀錄）；呼叫端自己給穩定的 id，重複登錄不會建出兩則。 */
export function systemSource(input: { id: string, kind: string, content: string, origin?: string }): AutoSourceInput {
  return { ...input, sourceType: 'system', collector: 'system' }
}

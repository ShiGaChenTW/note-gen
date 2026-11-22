// Fork（almanac ALMNC-54.10，R2）：自己寫的與系統產生的資料源一進來就自動交給指揮官，不等 Scott。
// 外部擷取的不走這裡（R1：等你決定、附初步判斷，見 judgement.ts 的 ingestSource）。
// 這個檔案只放純邏輯（依賴注入）：哪幾種進來的東西算自己寫的、怎麼組成資料源、加進去後叫佇列一次。
// 接到 App 的部分在 actions.ts（submitAutoSource、registerVoiceMemo、registerDailyEntry、registerRecordText；
// ALMNC-54.20：submitVersionedSource、sendNoteToCommander、registerConversationConclusion、registerResearchFindings、registerExternalAudio）。
import type { NewSourceInput, Source, SourceEditResult } from '@/lib/v3-model/source'
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

/**
 * Fork（almanac ALMNC-54.20）：從檔案選進來的音訊是外部資料源（R1，等 Scott 決定）。id 一樣沿用記錄橋接的 rec_<記錄 id>。
 * 沒有逐字稿就不登錄（記錄照樣留在資料源分頁，Scott 可以手動處理）。
 */
export function externalAudioSource(memo: { markId: number, transcript: string, audioPath?: string }): NewSourceInput | undefined {
  const content = memo.transcript.trim()
  if (!content) return undefined
  return {
    id: recordSourceId(memo.markId),
    sourceType: 'external',
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

/** 系統產生的資料源（對話結論、指揮官查到的外部資料）；呼叫端自己給穩定的 id，重複登錄不會建出兩則。任務完成紀錄不接（ALMNC-54.20）。 */
export function systemSource(input: { id: string, kind: string, content: string, origin?: string }): AutoSourceInput {
  return { ...input, sourceType: 'system', collector: 'system' }
}

// —— ALMNC-54.20 ——

export interface VersionedRouteDeps extends AutoRouteDeps {
  /** 從第一版的 id 找版本鏈最新一版；還沒登錄過回 undefined。 */
  latest: (rootId: string) => Promise<Source | undefined>
  /** 修改內容：已送出的照資料源版本規則新增一版（舊版不動、新版是待分析）。 */
  edit: (id: string, content: string) => Promise<SourceEditResult>
}

export interface VersionedRouteResult extends AutoRouteResult {
  /** added：第一次送；versioned：內容改了、新增一版；unchanged：內容一樣，沒有重複建立；empty：沒有內容。 */
  outcome: 'added' | 'versioned' | 'unchanged' | 'empty'
}

/**
 * 用固定 id 的資料源（「送給指揮官」的筆記、對話結論）：第一次送就登錄並叫指揮官；
 * 再送一次內容沒變就什麼都不做（不重複建立）；內容改了就照資料源的版本規則接一版新的（舊版保留），再叫指揮官分析差異。
 */
export async function routeVersionedSource(input: AutoSourceInput, deps: VersionedRouteDeps): Promise<VersionedRouteResult> {
  if (!input.content.trim()) return { queued: false, outcome: 'empty' }
  const latest = await deps.latest(input.id)
  if (!latest) {
    const result = await routeAutoSource(input, deps)
    // 同時有人先登錄了同一個 id（addIfAbsent 跳過）就當成沒變。
    return { ...result, outcome: result.source ? 'added' : 'unchanged' }
  }
  if (latest.content.trim() === input.content.trim()) return { queued: false, outcome: 'unchanged' }
  const edited = await deps.edit(latest.id, input.content)
  if (edited.source.status !== 'pending_analysis') return { source: edited.source, queued: false, outcome: 'versioned' }
  await deps.kick()
  return { source: edited.source, queued: true, outcome: 'versioned' }
}

/** 「送給指揮官」的筆記 id：由筆記路徑決定，同一篇再送找得到同一條版本鏈。 */
export function noteSourceId(path: string): string {
  return `src_note:${path}`
}

/** 編輯器右上「送給指揮官」：把目前這篇筆記送成自己寫的資料源（來處是筆記路徑）。 */
export function noteSource(note: { path: string, content: string }): AutoSourceInput | undefined {
  const content = note.content.trim()
  if (!content || !note.path) return undefined
  return { id: noteSourceId(note.path), sourceType: 'self', kind: 'text', content, origin: note.path, collector: 'scott' }
}

/** 對話結論（對話摘要存檔時）：系統產生的資料源；id 由對話決定（有 syncId 用 syncId），同一段對話重存只會接新版。 */
export function conversationConclusionSource(summary: { conversation: string, content: string, path?: string }): AutoSourceInput | undefined {
  const content = summary.content.trim()
  if (!content || !summary.conversation) return undefined
  return systemSource({ id: `src_conversation:${summary.conversation}`, kind: 'text', content, origin: summary.path || undefined })
}

/** 研究員（G1）查到的外部資料。只收真的查到東西的（found）；沒查到、沒辦法查、失敗的不建立。 */
export interface ResearchFindingLike {
  domainId: string
  question: string
  status: 'found' | 'nothing' | 'unavailable' | 'failed'
  summary: string
  sources: ReadonlyArray<{ title: string, url: string }>
}

/** 指揮官查到的外部資料：一個調研題目一則系統產生的資料源；id 含這一期與題目，同一期重跑不會重複建立。 */
export function researchFindingSource(finding: ResearchFindingLike, periodKey: string): AutoSourceInput | undefined {
  if (finding.status !== 'found' || !finding.summary.trim()) return undefined
  const content = [
    finding.question.trim(),
    '',
    finding.summary.trim(),
    ...(finding.sources.length ? ['', ...finding.sources.map(source => `- ${source.title} <${source.url}>`)] : []),
  ].join('\n')
  return systemSource({
    id: `src_research:${periodKey}:${finding.domainId}:${finding.question.trim()}`,
    kind: 'text',
    content,
    origin: finding.sources[0]?.url,
  })
}

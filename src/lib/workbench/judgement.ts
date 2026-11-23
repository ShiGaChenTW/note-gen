// Fork（almanac ALMNC-54.10）：外部擷取資料源的「初步判斷」（R1）——一行「類型｜建議」，只判斷、不撰寫，不產生草稿或提案。
// 規格：almanac/2026-11-19_proposal_role-data-model.md 第四節「路由」；做法照 ALMNC-54.9 實測：
// 本機 qwen3.5:2b 只有「類型」可靠，「建議」當成可有可無——提示詞列出完整選項（存成知識筆記／紀錄筆記／專案筆記、拆出任務、不採用），
// 只要一行；解析不出類型就當沒有判斷。本機模型無法使用時卡片照樣出現，只是沒有初步判斷（AC#4）。
// 連結要先抓網頁內文才能判斷；抓不到就是「擷取失敗」，卡片改成重試／刪除。
// 純函式＋注入的依賴；寫入在 src/db/v3-source-judgements.ts，接 App 在 src/lib/workbench/actions.ts。
import type { Source } from '@/lib/v3-model/source'

export type JudgementStatus =
  /** 有一行判斷（至少有類型）。 */
  | 'ready'
  /** 本機模型無法使用、或回答解析不出來：卡片照樣出現，只是沒有判斷。 */
  | 'unavailable'
  /** 連結抓不到內文：卡片改成重試／刪除。 */
  | 'capture_failed'

export interface SourceJudgement {
  sourceId: string
  status: JudgementStatus
  /** 類型，例如「會議紀錄」「研究報告」。 */
  type?: string
  /** 建議，五個選項之一（或用「＋」組合）；不可靠，可以沒有。 */
  suggestion?: string
  /** 哪個模型判斷的。 */
  model?: string
  /** 擷取失敗或模型錯誤的原因（只記錄，不顯示原文）。 */
  error?: string
  /** Scott 選了「照建議處理」：交給指揮官時附上這個建議。 */
  followSuggestion: boolean
  createdAt: number
  updatedAt: number
}

export const JUDGEMENT_TYPES = ['會議紀錄', '研究報告', '讀書筆記', '日誌', '零碎想法', '專案計畫', '做法說明', '參考資料', '新聞', '其他'] as const
export const JUDGEMENT_SUGGESTIONS = ['存成知識筆記', '存成紀錄筆記', '存成專案筆記', '拆出任務', '不採用'] as const

/** 判斷只看前面這麼多字（實測用 3000 字）。 */
export const JUDGE_INPUT_CHARS = 3000
const MAX_TYPE_CHARS = 10

/** 第三版提示詞再改：列出完整的建議選項，只要一行。 */
export function buildJudgementPrompt(text: string): string {
  return [
    '你是筆記 app 的分流助手。下面是一則剛擷取進來的資料源。只判斷、不撰寫：不要摘要、不要草稿。',
    `類型從這些選一個：${JUDGEMENT_TYPES.join('、')}。`,
    `建議從這些選一個：${JUDGEMENT_SUGGESTIONS.join('、')}。`,
    '研究、讀書、做法類的內容建議存成知識筆記；有明確待辦才建議拆出任務；明顯沒有價值才建議不採用。',
    '只輸出一行：類型｜建議。例如「讀書筆記｜存成知識筆記」。',
    '',
    '資料源：',
    Array.from(text.trim()).slice(0, JUDGE_INPUT_CHARS).join(''),
  ].join('\n')
}

function stripLabel(value: string, label: RegExp): string {
  return value.replace(label, '').replace(/^[「『"'\s]+|[」』"'。．.\s]+$/g, '').trim()
}

/** 從建議裡挑出認得的選項（可以用「＋」組合）；一個都對不到就是沒有建議。 */
function normalizeSuggestion(raw: string): string | undefined {
  const found = JUDGEMENT_SUGGESTIONS.filter(option => raw.includes(option) || raw.includes(option.replace(/^存成/, '')))
  if (!found.length) return undefined
  // 「不採用」跟其他選項同時出現時，以其他選項為準（模型常把研究類誤判成不採用）。
  const kept = found.length > 1 ? found.filter(option => option !== '不採用') : found
  return kept.join('＋')
}

/** 解析模型的一行回答。解析不出類型回傳 null（當成沒有判斷）。 */
export function parseJudgement(raw: string): { type: string, suggestion?: string } | null {
  const line = raw.trim().split('\n').map(entry => entry.trim()).find(Boolean)
  if (!line) return null
  const parts = line.split(/[｜|]/).map(part => part.trim()).filter(Boolean)
  if (!parts.length) return null
  const type = stripLabel(parts[0], /^(類型|类型)\s*[:：]?\s*/)
  const suggestion = parts.length > 1 ? normalizeSuggestion(stripLabel(parts.slice(1).join('｜'), /^(建議|建议)\s*[:：]?\s*/)) : undefined
  // 「類型｜建議採用」這種照抄格式的、太長的（其實是在撰寫）都不算類型。
  if (!type || /^(類型|类型)$/.test(type) || Array.from(type).length > MAX_TYPE_CHARS) return null
  if ((JUDGEMENT_SUGGESTIONS as readonly string[]).includes(type)) return null
  return { type, ...(suggestion ? { suggestion } : {}) }
}

/** 卡片第三行與資料源分頁顯示的那一行：「類型｜建議」或只有類型。沒有判斷回傳空字串。 */
export function judgementLine(judgement: Pick<SourceJudgement, 'status' | 'type' | 'suggestion'> | undefined): string {
  if (!judgement || judgement.status !== 'ready' || !judgement.type) return ''
  return judgement.suggestion ? `${judgement.type}｜${judgement.suggestion}` : judgement.type
}

/** 給指揮官的提示（Scott 選了「照建議處理」）。 */
export function judgementHint(judgement: Pick<SourceJudgement, 'status' | 'type' | 'suggestion' | 'followSuggestion'> | undefined): string | undefined {
  if (!judgement?.followSuggestion) return undefined
  return judgementLine(judgement) || undefined
}

/** 能拿文字判斷的資料源：圖片、錄音、檔案要先轉文字，那是指揮官的事，初步判斷不做。 */
export function isJudgeable(source: Pick<Source, 'kind' | 'content'>): boolean {
  if (/^data:/i.test(source.content.trim())) return false
  // Fork（almanac ALMNC-57）：RSS 文章用存下來的標題與摘要判斷（不另外抓網頁）；會議逐字稿本身就是文字。
  return source.kind === 'text' || source.kind === 'link' || source.kind === 'email' || source.kind === 'transcript' || source.kind === 'prompt'
    || source.kind === 'rss' || source.kind === 'meeting'
}

export interface JudgeModel {
  available: () => Promise<boolean>
  generate: (prompt: string, options?: { maxTokens?: number }) => Promise<string>
  readonly config?: { judgeModel: string }
}

export function attachmentKind(kind: string): 'image' | 'file' | undefined {
  if (kind === 'screenshot' || kind === 'inserted_image') return 'image'
  if (kind === 'file') return 'file'
  return undefined
}

export interface JudgeDeps {
  /** 附件先顯示可確認的類型，等使用者決定後才讀取原檔。 */
  attachmentLabel?: string
  /** 沒有就當本機模型無法使用。 */
  model?: JudgeModel
  /** 抓網頁內文（連結用）；失敗就丟錯。 */
  fetchPage?: (url: string) => Promise<string>
  save: (judgement: SourceJudgement) => Promise<void>
  /** 舊的判斷（重試時保留建立時間、照建議處理的旗標）。 */
  previous?: SourceJudgement
  now?: () => number
}

/**
 * 替一則等你決定的資料源做初步判斷，結果一定會存下來（ready／unavailable／capture_failed）。
 * 不會丟錯：任何失敗都當成沒有判斷，卡片照樣出現。
 */
export async function judgeSource(source: Pick<Source, 'id' | 'kind' | 'content' | 'origin'>, deps: JudgeDeps): Promise<SourceJudgement> {
  const now = deps.now?.() ?? Date.now()
  const base = { sourceId: source.id, followSuggestion: deps.previous?.followSuggestion ?? false, createdAt: deps.previous?.createdAt ?? now, updatedAt: now }
  const finish = async (judgement: SourceJudgement) => {
    try {
      await deps.save(judgement)
    } catch (error) {
      console.warn('[judgement] not saved:', error)
    }
    return judgement
  }

  const attachment = attachmentKind(source.kind)
  if (attachment) return finish({ ...base, status: 'ready', type: deps.attachmentLabel ?? attachment })

  let text = source.content
  if (source.kind === 'link') {
    const url = (source.origin || source.content).trim()
    if (!deps.fetchPage) return finish({ ...base, status: 'unavailable', error: 'no page fetcher' })
    try {
      text = (await deps.fetchPage(url)).trim()
      if (!text) throw new Error('empty page')
    } catch (error) {
      return finish({ ...base, status: 'capture_failed', error: error instanceof Error ? error.message : String(error) })
    }
  } else if (!isJudgeable(source)) {
    return finish({ ...base, status: 'unavailable', error: 'not text' })
  }

  const model = deps.model
  const modelName = model?.config?.judgeModel
  try {
    if (!model || !await model.available()) return finish({ ...base, status: 'unavailable', error: 'local model unavailable' })
    const parsed = parseJudgement(await model.generate(buildJudgementPrompt(text), { maxTokens: 40 }))
    if (!parsed) return finish({ ...base, status: 'unavailable', error: 'unparseable', ...(modelName ? { model: modelName } : {}) })
    return finish({ ...base, status: 'ready', type: parsed.type, ...(parsed.suggestion ? { suggestion: parsed.suggestion } : {}), ...(modelName ? { model: modelName } : {}) })
  } catch (error) {
    return finish({ ...base, status: 'unavailable', error: error instanceof Error ? error.message : String(error) })
  }
}

// —— 新增資料源時的分流（R1／R2） ——

export interface IngestDeps<TInput> {
  add: (input: TInput) => Promise<Source>
  /** 叫指揮官的佇列跑（R2）。 */
  kick: () => Promise<void> | void
  /** 外部擷取的：背景做初步判斷，不等它（R1）。 */
  judge: (source: Source) => Promise<unknown>
}

/**
 * 新增一則資料源並照來源分流：外部擷取的變成等你決定、背景做初步判斷；自己寫的、系統產生的一進來就交給指揮官（R2）。
 * 初步判斷失敗不影響新增（AC#4）。
 */
export async function ingestSource<TInput>(input: TInput, deps: IngestDeps<TInput>): Promise<Source> {
  const source = await deps.add(input)
  if (source.status === 'awaiting_decision') {
    void Promise.resolve().then(() => deps.judge(source)).catch(error => console.warn('[judgement] failed:', error))
  } else if (source.status === 'pending_analysis') {
    await deps.kick()
  }
  return source
}

/**
 * 新增資料源時的來源類型：連結、大部分是貼上的文字算外部擷取（等你決定）；自己打的字、待辦、Prompt 素材算自己寫的（R2）。
 * Fork（almanac ALMNC-69.3）：勾了「這是日誌」的文字一律算自己寫的（日誌就是 Scott 親手寫的事件記錄），直接交給指揮官。
 */
export function newSourceType(input: { type: 'text' | 'link' | 'todo' | 'prompt-draft', content: string, pastedChars?: number, journal?: boolean }): 'external' | 'self' {
  if (input.type === 'link') return 'external'
  if (input.type !== 'text' || input.journal) return 'self'
  const length = Array.from(input.content.trim()).length
  return length > 0 && (input.pastedChars ?? 0) >= length * 0.6 ? 'external' : 'self'
}

// Fork（almanac ALMNC-54.6）：分析第一步「轉成看得懂的內容」——截圖辨識文字、會議轉逐字稿、網頁抓全文。
// 只在資料源進入分析（狀態改成分析中）時呼叫；外部擷取的資料源（A5）進來時保留原檔，不在這裡以外的地方轉。
// 轉換器沒設定或失敗時保留原始內容並標記，不讓分析整個停下來。
import { LEGACY_NOTE_KIND, type Source } from '@/lib/v3-model/source'
import { ConverterUnavailableError, type ConversionResult, type ConverterName, type Converters } from './types'

/** 交給模型的文字上限（字元）；超過就截短並在 note 註明。 */
export const MAX_ANALYSIS_TEXT = 20000

const URL_RE = /^https?:\/\/\S+$/i
const DATA_URL_RE = /^data:[\w.+-]+\/[\w.+-]+;base64,/i

function isUrl(value: string): boolean {
  return URL_RE.test(value.trim())
}

/** 看起來是原檔參照（data URL、網址、檔案路徑），而不是一段文字。 */
export function looksLikeRef(value: string | undefined): boolean {
  const text = value?.trim() ?? ''
  if (!text || text.includes('\n')) return false
  if (DATA_URL_RE.test(text) || isUrl(text)) return true
  const hasExtension = /\.[a-zA-Z0-9]{1,5}$/.test(text)
  // 絕對或相對路徑可以有空白（例如 /Users/me/My File.png）；裸檔名不能有空白。
  if (/^(\/|~\/|[a-zA-Z]:[\\/]|\.{1,2}\/)/.test(text)) return hasExtension
  return hasExtension && !/\s/.test(text)
}

/** 原檔參照：內容本身是參照就用內容，否則用來處。 */
function refOf(source: Source): { ref?: string, caption: string } {
  if (looksLikeRef(source.content)) return { ref: source.content.trim(), caption: '' }
  return { ref: looksLikeRef(source.origin) ? source.origin!.trim() : undefined, caption: source.content.trim() }
}

/** 轉不成時留給模型看的原始內容：data URL 這種二進位不送，只留來處。 */
export function readableOriginal(source: Source): string {
  const content = source.content.trim()
  if (content && !DATA_URL_RE.test(content)) return content
  return source.origin?.trim() ?? ''
}

function cap(result: ConversionResult): ConversionResult {
  const chars = Array.from(result.text)
  if (chars.length <= MAX_ANALYSIS_TEXT) return result
  const note = `truncated ${chars.length} → ${MAX_ANALYSIS_TEXT} chars`
  return { ...result, text: chars.slice(0, MAX_ANALYSIS_TEXT).join(''), note: result.note ? `${result.note}; ${note}` : note }
}

async function run(
  source: Source,
  converter: Exclude<ConverterName, 'none'>,
  fn: ((ref: string) => Promise<string>) | undefined,
  ref: string | undefined,
  caption: string,
): Promise<ConversionResult> {
  const keep = (status: 'unavailable' | 'failed', note: string): ConversionResult =>
    ({ text: readableOriginal(source), converter, status, note })
  if (!ref) return caption ? { text: caption, converter: 'none', status: 'text' } : keep('unavailable', 'no original file reference')
  if (!fn) return keep('unavailable', `${converter} converter not configured`)
  try {
    const converted = (await fn(ref)).trim()
    if (!converted) return keep('failed', `${converter} returned no text`)
    return { text: caption ? `${caption}\n\n${converted}` : converted, converter, status: 'converted' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result = keep(error instanceof ConverterUnavailableError ? 'unavailable' : 'failed', message)
    const reason = (error as { reason?: unknown } | null)?.reason
    return typeof reason === 'string' && reason ? { ...result, reason } : result
  }
}

/**
 * 把資料源轉成文字，記下跑了哪一個轉換器。
 * - text／transcript／email 與未知形式：原本就是文字。
 * - link：抓網頁全文。
 * - image：辨識文字（VLM → OCR）。
 * - voice：轉逐字稿；內容已經是文字（例如錄音時已轉好）就直接用。
 * - file：文字檔直接讀；PDF／Office 由 anydoc 解析；讀不出來時帶著原因（ALMNC-54.19）。
 */
export async function toText(source: Source, converters: Converters): Promise<ConversionResult> {
  const asText = (): ConversionResult => ({ text: source.content.trim(), converter: 'none', status: 'text' })
  switch (source.kind) {
    case 'link': {
      const url = isUrl(source.content) ? source.content.trim() : isUrl(source.origin ?? '') ? source.origin!.trim() : undefined
      if (!url) return cap(asText())
      const caption = isUrl(source.content) ? '' : source.content.trim()
      const result = await run(source, 'web', converters.fetchWeb, url, caption)
      return cap(result.status === 'converted' ? { ...result, text: `${url}\n\n${result.text}` } : result)
    }
    case 'image': {
      const { ref, caption } = refOf(source)
      return cap(await run(source, 'ocr', converters.ocrImage, ref, caption))
    }
    case 'voice': {
      const { ref, caption } = refOf(source)
      if (!ref && caption) return cap(asText())
      return cap(await run(source, 'transcription', converters.transcribe, ref, caption))
    }
    case 'file': {
      const { ref, caption } = refOf(source)
      return cap(await run(source, 'file', converters.readFileText, ref, caption))
    }
    // Fork（almanac ALMNC-54.14）：舊筆記資料源只存路徑，分析時才讀筆記庫裡的檔案（不改檔）。
    case LEGACY_NOTE_KIND:
      return cap(await run(source, 'file', converters.readVaultNote, source.content.trim() || source.origin?.trim(), ''))
    default:
      return cap(asText())
  }
}

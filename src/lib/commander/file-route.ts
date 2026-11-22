// Fork（almanac ALMNC-54.19）：檔案資料源要用哪一個轉換器，以及讀不出文字時給 Scott 看的原因。
// 文字檔直接讀；PDF／Office（anydoc 支援的格式）交給 parseLocalDocument；其他格式不支援。
// 讀檔與解析都從外面注入（default-deps.ts 接 Tauri），這裡不碰 Tauri，方便單元測試。
import {
  getDocumentExtension,
  getDocumentFileName,
  isAnydocDocumentName,
  isTextDocumentName,
  normalizeDocumentParseError,
  type DocumentParseErrorCode,
} from '@/lib/document-parser'
import { ConverterFailedError, ConverterUnavailableError } from './types'

/** text：直接讀文字；document：anydoc 解析；unsupported：沒有轉換器。 */
export type FileRoute = 'text' | 'document' | 'unsupported'

// 原本就當文字讀的格式（csv 也在 anydoc 清單裡，但照舊直接讀文字比較省事）。
const TEXT_FILE = /\.(md|markdown|txt|csv|tsv|json|html?|xml|ya?ml|log)$/i

export function routeFile(ref: string): FileRoute {
  const name = getDocumentFileName(ref)
  if (TEXT_FILE.test(name) || isTextDocumentName(name)) return 'text'
  if (isAnydocDocumentName(name)) return 'document'
  return 'unsupported'
}

/** messages 的 commander.fileReason 底下的鍵。 */
export type FileReasonKey =
  | 'scannedPdf'
  | 'encrypted'
  | 'malformed'
  | 'resourceLimit'
  | 'fileTooLarge'
  | 'readFailed'
  | 'parseFailed'
  | 'unsupported'
  | 'noText'

export function fileReasonKeyForCode(code: DocumentParseErrorCode): FileReasonKey {
  switch (code) {
    case 'SCANNED_PDF': return 'scannedPdf'
    case 'ENCRYPTED': return 'encrypted'
    case 'MALFORMED':
    case 'MISSING_PART': return 'malformed'
    case 'RESOURCE_LIMIT': return 'resourceLimit'
    case 'FILE_TOO_LARGE': return 'fileTooLarge'
    case 'READ_FAILED': return 'readFailed'
    case 'UNSUPPORTED': return 'unsupported'
    default: return 'parseFailed'
  }
}

/** 解析錯誤（DocumentParseError、Rust 端回傳的 { code, message } 或任何錯）對應到原因鍵。 */
export function fileReasonKey(error: unknown): FileReasonKey {
  return fileReasonKeyForCode(normalizeDocumentParseError(error).code)
}

export interface FileTextReaderDeps {
  /** 讀文字檔（Tauri readTextFile）。 */
  readText: (path: string) => Promise<string>
  /** anydoc 解析（document-parser.ts 的 parseLocalDocument）。 */
  parseDocument: (path: string, name: string) => Promise<{ markdown: string }>
  /** 原因鍵翻成給 Scott 看的文字。 */
  reason: (key: FileReasonKey) => string
}

/** 組出 Converters.readFileText：依格式分流，讀不出文字時丟出帶原因的錯誤。 */
export function createFileTextReader(deps: FileTextReaderDeps): (ref: string) => Promise<string> {
  return async ref => {
    const route = routeFile(ref)
    if (route === 'unsupported') {
      throw new ConverterUnavailableError('no text converter for this file type', deps.reason('unsupported'))
    }
    if (route === 'text') {
      try {
        return await deps.readText(ref)
      } catch (error) {
        throw new ConverterFailedError(error instanceof Error ? error.message : String(error), deps.reason('readFailed'))
      }
    }
    let markdown: string
    try {
      markdown = (await deps.parseDocument(ref, getDocumentFileName(ref))).markdown
    } catch (error) {
      const normalized = normalizeDocumentParseError(error)
      throw new ConverterFailedError(`${normalized.code}: ${normalized.message}`, deps.reason(fileReasonKeyForCode(normalized.code)))
    }
    if (!markdown.trim()) {
      const key: FileReasonKey = getDocumentExtension(getDocumentFileName(ref)) === 'pdf' ? 'scannedPdf' : 'noText'
      throw new ConverterFailedError('document has no extractable text', deps.reason(key))
    }
    return markdown
  }
}

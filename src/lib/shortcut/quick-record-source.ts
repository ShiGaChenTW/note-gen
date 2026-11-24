// Fork（almanac ALMNC-83.4）：全域快捷鍵「快速記錄文字」在新介面（V3）存成資料源，走新增資料源同一條路（addNewSource）；
// classic 照舊存成記錄。這裡只放與視窗無關、可測的部分。
import type { NewSourceRequest } from '@/lib/workbench/actions'

export type QuickRecordTarget = 'source' | 'record'

/** V3 存成資料源，classic 存成記錄（舊行為）。 */
export function quickRecordTarget(v3: boolean): QuickRecordTarget {
  return v3 ? 'source' : 'record'
}

export interface QuickSourceSaveRequest {
  /** 快速記錄視窗的請求 id；回應遺失後重送會帶同一個 id。 */
  id: string
  text: string
  /** 貼上與自動讀剪貼簿帶進來的字數；大部分是貼上的文字照新增資料源規則算外部擷取。 */
  pastedChars?: number
}

/**
 * 建一個存資料源的函式：同一個請求 id 只登錄一次（回應遺失後重送不會多一筆），
 * 失敗的請求可以再送。回傳資料源清單列 id。
 */
export function createQuickSourceSaver(add: (request: NewSourceRequest) => Promise<string>) {
  const saved = new Map<string, Promise<string>>()
  return (request: QuickSourceSaveRequest): Promise<string> => {
    const content = request.text.trim()
    if (!content) return Promise.reject(new Error('empty'))
    const existing = saved.get(request.id)
    if (existing) return existing
    const pending = add({ type: 'text', content, pastedChars: Math.max(0, request.pastedChars ?? 0) })
    saved.set(request.id, pending)
    pending.catch(() => saved.delete(request.id))
    return pending
  }
}

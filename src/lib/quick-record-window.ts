import { emitTo } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { CustomThemeColors } from '@/types/theme'
import type { Tag } from '@/db/tags'
import type { QuickRecordTarget } from '@/lib/shortcut/quick-record-source'

export const QUICK_RECORD_WINDOW = 'quick-record'

export async function hideQuickRecordWindow(): Promise<void> {
  await invoke('hide_quick_record_window')
}

export interface QuickRecordContext {
  tags: Tag[]
  selectedTagId: number
  autoReadClipboard: boolean
  uiScale: number
  appFontFamily: string
  customThemeColors: CustomThemeColors
  /** Fork（almanac ALMNC-83.4）：V3 存成資料源（不選記錄標籤），classic 存成記錄。舊主視窗沒給就當 record。 */
  target?: QuickRecordTarget
}

export interface QuickRecordRequest {
  id: string
  action: 'prepare' | 'save' | 'createTag'
  tagName?: string
  text?: string
  tagId?: number
  /** ALMNC-83.4：這次存檔照哪個目標（視窗準備時拿到的 target）。 */
  target?: QuickRecordTarget
  /** ALMNC-83.4：存成資料源時，貼上與自動讀剪貼簿帶進來的字數。 */
  pastedChars?: number
}

export interface QuickRecordResponse {
  id: string
  context?: QuickRecordContext
  saved?: boolean
  createdTag?: Tag
  error?: 'invalid' | 'failed'
}

export async function requestQuickRecord(request: QuickRecordRequest): Promise<QuickRecordResponse> {
  let unlisten: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<QuickRecordResponse>((resolve, reject) => {
      void (async () => {
        unlisten = await getCurrentWindow().listen<QuickRecordResponse>('quick-record-response', event => {
          if (event.payload.id === request.id) resolve(event.payload)
        })
        timer = setTimeout(() => reject(new Error('timeout')), 15000)
        await emitTo('main', 'quick-record-request', request)
      })().catch(reject)
    })
  } finally {
    unlisten?.()
    clearTimeout(timer)
  }
}

/**
 * D8 時間區塊：把任務排到今天的某個時間，寫成 `📅 YYYY-MM-DD ⏰ HH:mm`。純函式、無 I/O。
 */

import { TASK_CHECKBOX_RE } from '@/lib/daily/tasks'

export const SLOT_MINUTES = 15

const DUE_EMOJI_RE = /(📅️?\s*)\d{4}-\d{2}-\d{2}/u
const DUE_FIELD_RE = /((?<![\p{L}\p{N}_-])due::\s*)\d{4}-\d{2}-\d{2}/u
const TIME_RE = /\s*⏰️?\s*\d{1,2}:\d{2}/u
const BLOCK_ID_RE = /(\s+\^[\w-]+)$/

/** 一天中的第幾分鐘 → 對齊到 step 分鐘的 `HH:mm`，限制在 00:00–23:45。 */
export function minutesToSlot(minutes: number, step = SLOT_MINUTES): string {
  const snapped = Math.min(24 * 60 - step, Math.max(0, Math.round(minutes / step) * step))
  return `${String(Math.floor(snapped / 60)).padStart(2, '0')}:${String(snapped % 60).padStart(2, '0')}`
}

export function slotToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function appendBeforeBlockId(text: string, addition: string): string {
  const m = text.match(BLOCK_ID_RE)
  return m ? `${text.slice(0, -m[1].length)} ${addition}${m[1]}` : `${text} ${addition}`
}

/**
 * 設定任務行的到期日與時間：已有的 📅／due:: 與 ⏰ 就地取代，沒有就加在行尾（`^block-id` 之前）。
 * time 為空字串時移除 ⏰。不是任務行時回傳 null；保留行尾 `\r`。
 */
export function setTaskSchedule(line: string, schedule: { due: string, time: string }): string | null {
  const cr = line.endsWith('\r') ? '\r' : ''
  let text = line.replace(/\r$/, '')
  if (!TASK_CHECKBOX_RE.test(text)) return null

  if (DUE_EMOJI_RE.test(text)) text = text.replace(DUE_EMOJI_RE, (_, prefix: string) => `${prefix}${schedule.due}`)
  else if (DUE_FIELD_RE.test(text)) text = text.replace(DUE_FIELD_RE, (_, prefix: string) => `${prefix}${schedule.due}`)
  else text = appendBeforeBlockId(text.trimEnd(), `📅 ${schedule.due}`)

  if (schedule.time) {
    if (TIME_RE.test(text)) text = text.replace(TIME_RE, ` ⏰ ${schedule.time}`)
    else text = appendBeforeBlockId(text.trimEnd(), `⏰ ${schedule.time}`)
  } else {
    text = text.replace(TIME_RE, '')
  }
  return text + cr
}

// Fork（almanac ALMNC-45）：行程的「私人」標記。純函式，存在 store.json 的 einkPrivateItems。
// 休眠畫面之後只顯示「私人行程」和時間（今日簡報照樣完整顯示）；這張票只負責標記與保存。
// 行程（GLOSSARY）＝今天頁上的時段、有時間的任務與行事曆事件，各用穩定的鍵：
//   行事曆事件  cal:<事件 id>            （EventKit 的事件 id；重複事件共用 id，一次標記整個系列）
//   有時間的任務 task:<檔案路徑>#<標題>   （不用行號，避免上面加一行就對不上）
//   每日筆記時段 anchor:<YYYY-MM-DD>#<標題>（時段只屬於那天的日誌）

export const EINK_PRIVATE_KEY = 'einkPrivateItems'
/** 最多保留幾筆；超過時丟掉最舊的（行程一直在增加，避免 store.json 無限長大）。 */
export const MAX_PRIVATE_ITEMS = 1000

export interface PrivacySubject {
  kind: 'calendar' | 'task' | 'anchor'
  /** 時間軸項目的鍵：行事曆事件是 cal:<id> */
  key: string
  title: string
  task?: { path: string }
}

export function privacyKey(entry: PrivacySubject, dayKey: string): string {
  switch (entry.kind) {
    case 'calendar': return entry.key.startsWith('cal:') ? entry.key : `cal:${entry.key}`
    case 'task': return `task:${entry.task?.path ?? ''}#${entry.title.trim()}`
    case 'anchor': return `anchor:${dayKey}#${entry.title.trim()}`
  }
}

export function normalizePrivateItems(saved: unknown): string[] {
  if (!Array.isArray(saved)) return []
  const unique = [...new Set(saved.filter((value): value is string => typeof value === 'string' && value.length > 0))]
  return unique.slice(-MAX_PRIVATE_ITEMS)
}

export function setPrivate(items: readonly string[], key: string, on: boolean): string[] {
  const rest = items.filter(item => item !== key)
  return (on ? [...rest, key] : rest).slice(-MAX_PRIVATE_ITEMS)
}

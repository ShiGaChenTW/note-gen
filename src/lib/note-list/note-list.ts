// Fork（almanac ALMNC-54.17）：V3「我的筆記」三欄的中間欄——筆記清單。
// 純函式（清單組裝、相對時間）＋一個小 store（開著哪個資料夾）。資料來自 vault 索引，不另外讀檔。
// 資料夾一律「遞迴」：點資料夾時列出它底下所有子資料夾裡的筆記，第二行顯示筆記所在的資料夾。
import { create } from 'zustand'
import { isUiV3 } from '@/lib/fork-ui'
import { sortPinnedFirst } from '@/lib/note-toolbar/note-marks'

export interface NoteListSource {
  path: string
  /** 毫秒；取不到時為 0 */
  mtime: number
}

export interface NoteListItem {
  path: string
  /** 檔名去掉 .md */
  title: string
  /** 筆記所在的資料夾（vault 相對路徑）；在 vault 根目錄時為空字串 */
  folder: string
  mtime: number
}

function trimSlashes(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/** 筆記標題：檔名去掉 .md。 */
export function noteTitle(path: string): string {
  const name = trimSlashes(path).split('/').pop() ?? path
  return name.replace(/\.md$/i, '')
}

/** 筆記所在的資料夾；根目錄的筆記回傳空字串。 */
export function noteFolder(path: string): string {
  const parts = trimSlashes(path).split('/')
  return parts.slice(0, -1).join('/')
}

/** 資料夾顯示名稱：路徑最後一段；根目錄（空字串）交給畫面端顯示筆記庫名稱（ALMNC-43.12）。 */
export function folderName(folder: string): string {
  return trimSlashes(folder).split('/').pop() ?? ''
}

/**
 * 某資料夾（含子資料夾）裡的 Markdown 筆記，最近修改的在最上面；修改時間相同時依標題排序。
 * folder 為空字串代表「我的筆記」根目錄（整個 vault）。隱藏資料夾（`.` 開頭）裡的檔案不列。
 * pinned：從編輯區工具列置頂的筆記路徑，排在最上面（置頂的之間同樣最近修改的在上）。
 */
export function buildNoteList(notes: Iterable<NoteListSource>, folder: string, pinned: readonly string[] = []): NoteListItem[] {
  const root = trimSlashes(folder)
  const prefix = root ? `${root}/` : ''
  const items: NoteListItem[] = []
  for (const note of notes) {
    const path = trimSlashes(note.path)
    if (!path.toLowerCase().endsWith('.md')) continue
    if (prefix && !path.startsWith(prefix)) continue
    if (path.split('/').some(part => part.startsWith('.'))) continue
    items.push({ path: note.path, title: noteTitle(path), folder: noteFolder(path), mtime: note.mtime })
  }
  return sortPinnedFirst(items.sort((a, b) => b.mtime - a.mtime || a.title.localeCompare(b.title)), pinned)
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function startOfDay(ms: number) {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * 相對時間：一分鐘內「現在」，一小時內「N 分鐘前」，今天「N 小時前」，之前用日曆天數（昨天、3 天前），
 * 超過一週改用日期。mtime 為 0（取不到）時回傳空字串。
 */
export function relativeTimeLabel(mtime: number, now: number, locale: string): string {
  if (!mtime) return ''
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diff = Math.max(0, now - mtime)
  if (diff < MINUTE) return rtf.format(0, 'second')
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute')
  const days = Math.round((startOfDay(now) - startOfDay(mtime)) / DAY)
  if (days <= 0) return rtf.format(-Math.floor(diff / HOUR), 'hour')
  if (days < 7) return rtf.format(-days, 'day')
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', ...(new Date(mtime).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) }).format(mtime)
}

/** Fork（almanac ALMNC-56.7，A07）：中間面板窄於這個寬度時自動收起筆記清單（清單 280 px，編輯器留不到約 360 px）。 */
export const NOTE_LIST_COLLAPSE_PX = 640

/**
 * 中間面板從夠寬變成窄於門檻的那一刻才收起（右側欄打開、視窗縮小）。
 * 本來就窄時使用者自己打開的清單不收（previous 為 null 代表剛開始量）。
 */
export function crossedBelow(previous: number | null, width: number, threshold = NOTE_LIST_COLLAPSE_PX): boolean {
  return previous !== null && previous >= threshold && width < threshold
}

interface NoteListState {
  visible: boolean
  /** 開著的資料夾；空字串代表「我的筆記」根目錄 */
  folder: string
  show: (folder?: string) => void
  hide: () => void
}

/** 中間欄開關。只在 V3 開得起來；與全頁畫面互斥由 home-service 的 linkExclusiveOverlays 處理。 */
export const useNoteListStore = create<NoteListState>((set) => ({
  visible: false,
  folder: '',
  show: (folder = '') => { if (isUiV3()) set({ visible: true, folder: trimSlashes(folder) }) },
  hide: () => set({ visible: false }),
}))

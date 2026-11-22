// Fork（almanac ALMNC-54.17）：V3「我的筆記」三欄的中間欄——筆記清單。
// 純函式（清單組裝、相對時間）＋一個小 store（開著哪個資料夾）。資料來自 vault 索引，不另外讀檔。
// 資料夾一律「遞迴」：點資料夾時列出它底下所有子資料夾裡的筆記，第二行顯示筆記所在的資料夾。
import { create } from 'zustand'
import { isUiV3 } from '@/lib/fork-ui'
import { normalizeNotePath, sortPinnedFirst } from '@/lib/note-toolbar/note-marks'

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

/** 這則筆記該不該列在 folder（含子資料夾）裡；不該列時回傳 null。folderPrefix 是 `資料夾/`，根目錄為空字串。 */
function toNoteListItem(note: NoteListSource, folderPrefix: string): NoteListItem | null {
  const path = trimSlashes(note.path)
  if (!path.toLowerCase().endsWith('.md')) return null
  if (folderPrefix && !path.startsWith(folderPrefix)) return null
  if (path.split('/').some(part => part.startsWith('.'))) return null
  return { path: note.path, title: noteTitle(path), folder: noteFolder(path), mtime: note.mtime }
}

function folderPrefixOf(folder: string) {
  const root = trimSlashes(folder)
  return root ? `${root}/` : ''
}

/** 清單順序：最近修改的在上；修改時間相同時依標題。 */
function compareNoteListItems(a: NoteListItem, b: NoteListItem) {
  return b.mtime - a.mtime || a.title.localeCompare(b.title)
}

/**
 * 某資料夾（含子資料夾）裡的 Markdown 筆記，最近修改的在最上面；修改時間相同時依標題排序。
 * folder 為空字串代表「我的筆記」根目錄（整個 vault）。隱藏資料夾（`.` 開頭）裡的檔案不列。
 * pinned：從編輯區工具列置頂的筆記路徑，排在最上面（置頂的之間同樣最近修改的在上）。
 */
export function buildNoteList(notes: Iterable<NoteListSource>, folder: string, pinned: readonly string[] = []): NoteListItem[] {
  const prefix = folderPrefixOf(folder)
  const items: NoteListItem[] = []
  for (const note of notes) {
    const item = toNoteListItem(note, prefix)
    if (item) items.push(item)
  }
  return sortPinnedFirst(items.sort(compareNoteListItems), pinned)
}

/** vault 索引一次變動：重新索引的筆記與刪掉的路徑（stores/vault-index 的 changeLog）。 */
export interface NoteListChange {
  upserted: readonly NoteListSource[]
  removed: readonly string[]
}

/**
 * Fork（almanac ALMNC-56.3 P03）：只把變動的筆記搬到該在的位置，不重排整份清單。
 * 自動存檔時 vault 索引只重新索引存檔的那一則；這裡把它從原位置拿掉、用二分搜尋插回
 * （置頂區或其餘區，維持 sortPinnedFirst 的「置頂在前」），其他列的物件原封不動，畫面只重繪變動的那一列。
 * 結果與 buildNoteList 重建一份相同；沒有任何變動落在這份清單時回傳原陣列。
 */
export function applyNoteListChange(
  items: readonly NoteListItem[],
  change: NoteListChange,
  folder: string,
  pinned: readonly string[] = [],
): readonly NoteListItem[] {
  const prefix = folderPrefixOf(folder)
  const pinnedSet = new Set(pinned.map(normalizeNotePath))
  const isPinned = (item: NoteListItem) => pinnedSet.has(normalizeNotePath(item.path))
  let next: NoteListItem[] | null = null
  const writable = () => (next ??= items.slice())
  const current = () => next ?? items
  const indexOf = (path: string) => {
    const target = trimSlashes(path)
    return current().findIndex(item => trimSlashes(item.path) === target)
  }

  for (const path of change.removed) {
    const index = indexOf(path)
    if (index >= 0) writable().splice(index, 1)
  }

  for (const note of change.upserted) {
    const item = toNoteListItem(note, prefix)
    const index = indexOf(note.path)
    const existing = index >= 0 ? current()[index] : null
    if (existing && item && existing.mtime === item.mtime && existing.title === item.title && existing.folder === item.folder) continue
    if (!existing && !item) continue
    const list = writable()
    if (index >= 0) list.splice(index, 1)
    if (!item) continue
    // 置頂區是清單開頭連續的一段；新的這則插在它所屬那一區裡依時間排序的位置。
    let pinnedEnd = 0
    while (pinnedEnd < list.length && isPinned(list[pinnedEnd])) pinnedEnd++
    let low = isPinned(item) ? 0 : pinnedEnd
    let high = isPinned(item) ? pinnedEnd : list.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (compareNoteListItems(list[mid], item) <= 0) low = mid + 1
      else high = mid
    }
    list.splice(low, 0, item)
  }

  return next ?? items
}

/** 筆記清單上一次算出的結果，給下一次增量更新用。 */
export interface NoteListSnapshot {
  items: readonly NoteListItem[]
  revision: number
  folder: string
  pinned: readonly string[]
}

export interface NoteListInput {
  notes: Pick<ReadonlyMap<string, NoteListSource>, 'get' | 'values'>
  revision: number
  /** vault 索引最近幾次變動（revision 由小到大；stores/vault-index 的 changeLog） */
  changeLog: readonly { revision: number, upserted: readonly string[], removed: readonly string[] }[]
  folder: string
  pinned: readonly string[]
}

function sameList(a: readonly string[], b: readonly string[]) {
  return a === b || (a.length === b.length && a.every((value, index) => value === b[index]))
}

/**
 * 依上一次結果決定這次怎麼算：資料夾、置頂都沒變，且上一次之後的每次 vault 變動都在 changeLog 裡，
 * 就逐筆套用（applyNoteListChange）；否則（開別的資料夾、置頂改了、整個重新掃描）整份重建。
 */
export function nextNoteList(previous: NoteListSnapshot | null, input: NoteListInput): NoteListSnapshot {
  const { notes, revision, changeLog, folder, pinned } = input
  const rebuild = (): NoteListSnapshot => ({ items: buildNoteList(notes.values(), folder, pinned), revision, folder, pinned })
  if (!previous || previous.folder !== folder || !sameList(previous.pinned, pinned)) return rebuild()
  if (previous.revision === revision) return previous
  const pending = changeLog.filter(entry => entry.revision > previous.revision && entry.revision <= revision)
  if (pending.length !== revision - previous.revision) return rebuild()
  let items = previous.items
  for (const entry of pending) {
    const upserted: NoteListSource[] = []
    const removed = [...entry.removed]
    for (const path of entry.upserted) {
      const note = notes.get(path)
      if (note) upserted.push(note)
      else removed.push(path)
    }
    items = applyNoteListChange(items, { upserted, removed }, folder, pinned)
  }
  return { items, revision, folder, pinned }
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
// Fork（almanac ALMNC-56.3 P03）：Intl 格式物件建立很貴，清單每列都 new 會拖慢重繪；依語系只建一次。
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>()
const dateFormats = new Map<string, Intl.DateTimeFormat>()

/** 某語系的相對時間格式物件；同一個語系只建一次。 */
export function relativeTimeFormat(locale: string): Intl.RelativeTimeFormat {
  let format = relativeFormats.get(locale)
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    relativeFormats.set(locale, format)
  }
  return format
}

function dateFormat(locale: string, withYear: boolean): Intl.DateTimeFormat {
  const key = `${locale}|${withYear ? 'y' : ''}`
  let format = dateFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
    dateFormats.set(key, format)
  }
  return format
}

export function relativeTimeLabel(mtime: number, now: number, locale: string): string {
  if (!mtime) return ''
  const rtf = relativeTimeFormat(locale)
  const diff = Math.max(0, now - mtime)
  if (diff < MINUTE) return rtf.format(0, 'second')
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute')
  const days = Math.round((startOfDay(now) - startOfDay(mtime)) / DAY)
  if (days <= 0) return rtf.format(-Math.floor(diff / HOUR), 'hour')
  if (days < 7) return rtf.format(-days, 'day')
  return dateFormat(locale, new Date(mtime).getFullYear() !== new Date(now).getFullYear()).format(mtime)
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

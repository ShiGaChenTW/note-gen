// Fork（almanac ALMNC-69.11）：判斷一個改動有沒有碰到「Scott 指定」的位置。純函式、不碰 I/O。
// GLOSSARY「Scott 指定」：有標記時夥伴在一般整理中不主動提議改動，有新理由要改時提案上必須標出；90 天後失效。
// 用的地方：
// - 每週整理卡與清理提案（lib/cleanup/weekly-moc.ts）：碰到標記的建議不提（略過）。
// - 自動接受（lib/workbench/auto-accept）：碰到標記的不自動接受，照一般提案送審。
// - 提案卡（decide/proposal-risk.tsx）：夥伴的提案仍要改到標記的位置時，卡上標出「這是 Scott 指定的位置」。
//
// 「碰到」的意思（比對 MOC 改動前後）：
// - 收錄（M＋N）：那則筆記在這個 MOC 的收錄被移除、搬到別章，或關係說明改了。收錄還在「尚未分章」時只保護歸屬：
//   排進正式章節（附關係說明）不算碰到，拿掉才算。
// - 區塊（M＋區塊名）：那個區塊的內容改了（含整個區塊被拿掉）。
// - 章節（C）：那一章被改名或拿掉（例如併章）。
// - MOC 整個被刪掉：這個 MOC 上的標記全部算碰到。
import { formalEntries, parseMoc, targetKey, type MocBlockKey, type ParsedMoc } from './parse'
import { isPinActive, type ScottPin } from './scott-pins'

/** 連結目標 → 筆記（路徑與 N 編號，知道多少給多少）。解析不到回傳 null。 */
export type PinNoteResolver = (target: string, mocPath: string | undefined) => { path?: string, id?: string } | null

export interface PinTouch {
  location: 'entry' | 'block' | 'chapter'
  mocPath: string
  mocName: string
  /** 畫面用的名稱：筆記標題（收錄）、區塊鍵（區塊）、章節名稱（章節）。 */
  label: string
  block?: MocBlockKey
}

/** 一份檔案的改動（同 lib/workbench/risk ContentChange 的形狀；只看 note 的）。 */
export interface PinChange {
  target?: string
  path: string
  before: string | null
  after: string | null
}

const stem = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '').trim().toLowerCase()

/** 標記是不是這個 MOC 的（編號相同，或路徑相同）。 */
function sameMoc(pin: ScottPin, moc: { id?: string, path: string }): boolean {
  return Boolean((pin.mocId && moc.id && pin.mocId === moc.id) || pin.mocPath === moc.path)
}

interface EntryState { chapterId: string | null, relation: string, path?: string, id?: string, target: string }

function entriesOf(moc: ParsedMoc, path: string, resolve?: PinNoteResolver): EntryState[] {
  return formalEntries(moc).filter(({ entry }) => !entry.duplicate).map(({ entry, chapter }) => {
    const note = resolve?.(entry.target, path) ?? null
    return { chapterId: chapter.unsorted ? null : chapter.id, relation: entry.relation, target: entry.target, ...(note?.path ? { path: note.path } : {}), ...(note?.id ? { id: note.id } : {}) }
  })
}

function entryMatches(pin: ScottPin, entry: EntryState): boolean {
  if (pin.noteId && entry.id) return pin.noteId === entry.id
  if (pin.notePath && entry.path) return pin.notePath === entry.path
  // 解析不到路徑時，用檔名比對連結文字。
  return Boolean(pin.notePath && stem(pin.notePath) === targetKey(entry.target).split('/').pop())
}

const noteLabel = (pin: ScottPin) => pin.notePath ? (pin.notePath.split('/').pop() ?? pin.notePath).replace(/\.md$/i, '') : pin.noteId ?? ''

/**
 * 一份 MOC 從 before 改成 after，碰到哪些有效標記。before 是 null（新檔）時沒有原本的位置，什麼都沒碰到；
 * after 是 null（刪檔）時這個 MOC 上的有效標記全部算碰到。不是 MOC 的檔案回傳空陣列。
 */
export function mocPinTouches(
  change: Pick<PinChange, 'path' | 'before' | 'after'>,
  pins: readonly ScottPin[],
  options: { now: number, resolve?: PinNoteResolver },
): PinTouch[] {
  if (change.before === null || change.before === change.after || !pins.length) return []
  const old = parseMoc(change.before, change.path)
  if (!old.isMoc) return []
  const ref = { id: old.id, path: change.path }
  const relevant = pins.filter(pin => isPinActive(pin, options.now) && sameMoc(pin, ref))
  if (!relevant.length) return []
  const mocName = old.name
  const touch = (pin: ScottPin, label: string, extra: Partial<PinTouch> = {}): PinTouch => ({
    location: pin.kind === 'block' ? 'block' : pin.kind === 'chapter-title' ? 'chapter' : 'entry', mocPath: change.path, mocName, label, ...extra,
  })
  if (change.after === null) {
    return relevant.map(pin => touch(pin, pin.kind === 'block' ? pin.block ?? '' : pin.kind === 'chapter-title' ? old.chapters.find(item => item.id === pin.chapterId)?.title ?? '' : noteLabel(pin), pin.block ? { block: pin.block } : {}))
  }
  const next = parseMoc(change.after, change.path)
  const touches: PinTouch[] = []
  const seen = new Set<string>()
  const add = (key: string, value: PinTouch) => {
    if (seen.has(key)) return
    seen.add(key)
    touches.push(value)
  }
  const beforeEntries = entriesOf(old, change.path, options.resolve)
  const afterEntries = entriesOf(next, change.path, options.resolve)
  for (const pin of relevant) {
    if (pin.kind === 'block') {
      if (!pin.block) continue
      if ((old.blocks[pin.block]?.text ?? '') !== (next.blocks[pin.block]?.text ?? '')) add(`block|${pin.block}`, touch(pin, pin.block, { block: pin.block }))
    } else if (pin.kind === 'chapter-title') {
      const chapter = old.chapters.find(item => item.id && item.id === pin.chapterId)
      if (!chapter) continue
      const now = next.chapters.find(item => item.id === chapter.id)
      if (!now || now.title !== chapter.title) add(`chapter|${chapter.id}`, touch(pin, chapter.title))
    } else {
      const entry = beforeEntries.find(item => entryMatches(pin, item))
      if (!entry) continue
      const now = afterEntries.find(item => entryMatches(pin, item))
      // 收錄在「尚未分章」時，標記保護的是歸屬（Scott 選了這個領域，例如檯面歸入領域），不是位置：
      // 從尚未分章排進正式章節（每週整理的排章建議）不算碰到；拿掉或改到別處才算。
      const placedFromUnsorted = entry.chapterId === null && now?.chapterId !== null
      if (!now || (now.chapterId !== entry.chapterId && !placedFromUnsorted) || (now.relation !== entry.relation && !placedFromUnsorted)) {
        add(`entry|${pin.noteId ?? pin.notePath}`, touch(pin, (entry.target.split('/').pop() ?? entry.target).split('|')[0]))
      }
    }
  }
  return touches
}

/** 好幾份改動（提案卡、自動接受）碰到的標記，合在一起。 */
export function changesPinTouches(changes: readonly PinChange[], pins: readonly ScottPin[], options: { now: number, resolve?: PinNoteResolver }): PinTouch[] {
  return changes.flatMap(change => change.target && change.target !== 'note' ? [] : mocPinTouches(change, pins, options))
}

/**
 * 合併、取代時的領域承接（from 的收錄由 to 承接）：from 在任何 MOC 有有效的收錄標記，就算碰到
 * （它原本的位置會被換掉）。回傳碰到的那些標記。
 */
export function transferPinTouches(transfers: ReadonlyArray<{ from: string, to: string }>, pins: readonly ScottPin[], options: { now: number, idOf?: (path: string) => string | undefined }): ScottPin[] {
  if (!transfers.length) return []
  return pins.filter(pin => (pin.kind === 'relation' || pin.kind === 'position') && isPinActive(pin, options.now) && transfers.some(({ from }) => {
    const id = options.idOf?.(from)
    return (id && pin.noteId === id) || pin.notePath === from
  }))
}

/**
 * Fork（almanac ALMNC-69.14 × 69.11）：分家／併回要動的位置（MOC＋章節，或章節裡的一則收錄）是否有有效的 Scott 指定。
 * 有 note：同一個 MOC 裡那則收錄的標記（關係說明或位置；標記帶章節時要同章）。沒有 note：那個章節的章節名標記。
 */
export function branchPositionPinned(
  position: { mocId: string, chapterId: string, note?: string },
  pins: readonly ScottPin[],
  now: number,
): boolean {
  return pins.some(pin => {
    if (!isPinActive(pin, now) || pin.mocId !== position.mocId) return false
    if (!position.note) return pin.kind === 'chapter-title' && pin.chapterId === position.chapterId
    if (pin.kind !== 'relation' && pin.kind !== 'position') return false
    if (pin.chapterId && pin.chapterId !== position.chapterId) return false
    return pin.noteId === position.note || pin.notePath === position.note
  })
}

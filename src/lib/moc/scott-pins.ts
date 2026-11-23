// Fork（almanac ALMNC-69.10）：「Scott 指定」標記的交接介面。GLOSSARY：Scott 親手改過的歸屬或位置上的標記；有標記時夥伴在一般整理中
// 不主動提議改動，90 天後失效。判斷規則提案〈在 Obsidian 直接改 MOC 時〉：改了關係說明 → 標 Scott 指定。
//
// 這張票（69.10）只負責「產生」標記：Scott 在 Obsidian 直接生效的收錄修改（改說明＝relation；加入、搬動＝position；章節改名＝chapter-title）
// 都呼叫 recordScottPins。標記怎麼存（系統索引、90 天失效、清理與重整略過）由 ALMNC-69.11 實作：它在 App 啟動時
// registerScottPinRecorder(存的函式)。還沒有註冊時這裡不存（只記 debug）；需要補的話，ops 表 7 天內 actor＝scott 的
// moc.entry.relation／moc.entry.add／moc.entry.move／moc.chapter.rename 紀錄就是同一份資料（每筆 pin 也帶 opId）。
//
// Fork（almanac ALMNC-69.11）：儲存與使用。標記存在 note.db 的 scott_pins（src/db/scott-pins.ts，不寫進檔案），每個位置一筆 pinned_at：
// 收錄（M＋N；改說明與加入／搬動都算同一個位置）、區塊（M＋區塊名）、章節（C）。90 天後失效（讀取時判斷並順手清掉）。
// 產生的來源：這裡的 pinsFromDiffs（Obsidian 收錄修改）、blockPinsFromEdit（Obsidian 改了區塊內容）、pinsFromOps（App 內 actor＝scott
// 的結構操作，ops 記錄後呼叫）。怎麼判斷提案碰到標記在 scott-pin-check.ts。
import type { OpRecord } from '@/lib/ops/types'
import { parseMoc, type MocBlockKey } from './parse'
import type { EffectiveDiff } from './reconcile'

export type ScottPinKind = 'relation' | 'position' | 'chapter-title' | 'block'

/** 90 天後失效（GLOSSARY「Scott 指定」）。 */
export const SCOTT_PIN_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** 標記會擋的區塊（章節區由收錄與章節標記負責）。 */
export const PINNABLE_BLOCKS: readonly MocBlockKey[] = ['position', 'start', 'conclusions', 'open']

export interface ScottPin {
  kind: ScottPinKind
  mocPath: string
  mocId?: string
  mocName: string
  /** 收錄的筆記（章節改名沒有）。 */
  notePath?: string
  noteId?: string
  chapterId?: string
  /** 區塊標記（kind＝block）的區塊。 */
  block?: MocBlockKey
  /** 對應的操作（ops 表）編號。 */
  opId?: string
  /** 標記時間（UTC 毫秒；90 天失效從這裡算）。 */
  at: number
}

export type ScottPinRecorder = (pins: readonly ScottPin[]) => Promise<void>

let recorder: ScottPinRecorder | null = null

/** ALMNC-69.11 註冊標記的儲存；傳 null 取消。 */
export function registerScottPinRecorder(next: ScottPinRecorder | null): void {
  recorder = next
}

/** 直接生效的差異 → 標記（移除不標：收錄已經不在了）。opIds 與 diffs 依序對應（沒有就不帶）。 */
export function pinsFromDiffs(diffs: readonly EffectiveDiff[], at: number, refs: { opIds?: ReadonlyArray<string | undefined>, noteIdOf?: (notePath: string) => string | undefined } = {}): ScottPin[] {
  const pins: ScottPin[] = []
  diffs.forEach((diff, index) => {
    if (diff.kind === 'remove') return
    const opId = refs.opIds?.[index]
    const base = { mocPath: diff.mocPath, ...(diff.mocId ? { mocId: diff.mocId } : {}), mocName: diff.mocName, ...(opId ? { opId } : {}), at }
    if (diff.kind === 'chapter-rename') {
      pins.push({ ...base, kind: 'chapter-title', chapterId: diff.chapterId })
      return
    }
    const noteId = refs.noteIdOf?.(diff.notePath)
    const chapterId = diff.kind === 'move' ? diff.toChapterId : diff.chapterId
    pins.push({ ...base, kind: diff.kind === 'relation' ? 'relation' : 'position', notePath: diff.notePath, ...(noteId ? { noteId } : {}), ...(chapterId ? { chapterId } : {}) })
  })
  return pins
}

/** 還有效（標記後未滿 90 天）。 */
export function isPinActive(pin: Pick<ScottPin, 'at'>, now: number): boolean {
  return now - pin.at < SCOTT_PIN_TTL_MS
}

/** 儲存用的位置：收錄（M＋N）、區塊（M＋區塊名）、章節（C）。改說明與加入／搬動是同一個收錄位置。 */
export type ScottPinLocation = 'entry' | 'block' | 'chapter'

export function locationOf(kind: ScottPinKind): ScottPinLocation {
  return kind === 'chapter-title' ? 'chapter' : kind === 'block' ? 'block' : 'entry'
}

/** 同一個位置的鍵（有編號用編號，沒有才用路徑）；同一個位置再標一次只更新時間。 */
export function pinKey(pin: ScottPin): string {
  const moc = pin.mocId || `path:${pin.mocPath}`
  const location = locationOf(pin.kind)
  const target = location === 'block' ? pin.block ?? '' : location === 'chapter' ? pin.chapterId || `title:${pin.mocPath}` : pin.noteId || `path:${pin.notePath ?? ''}`
  return `${location}|${moc}|${target}`
}

/**
 * Scott 在 App 內親手做的結構操作（ops actor＝scott）→ 標記：加入、搬動收錄、改說明 → 收錄；章節改名 → 章節。
 * 移除不標（收錄已經不在了）；夥伴或系統的操作不標。
 */
export function pinsFromOps(records: readonly OpRecord[]): ScottPin[] {
  const pins: ScottPin[] = []
  for (const record of records) {
    if (record.actor !== 'scott' || record.undoneAt) continue
    const op = record.payload
    const base = { mocPath: '', mocName: '', opId: record.id, at: record.at }
    if (op.kind === 'moc.chapter.rename') {
      if (!op.chapterId) continue
      pins.push({ ...base, kind: 'chapter-title', mocPath: op.mocPath, mocName: op.mocName, ...(op.mocId ? { mocId: op.mocId } : {}), chapterId: op.chapterId })
    } else if (op.kind === 'moc.entry.add' || op.kind === 'moc.entry.move' || op.kind === 'moc.entry.relation') {
      const chapterId = op.kind === 'moc.entry.move' ? op.toChapterId : op.chapterId
      pins.push({
        ...base,
        kind: op.kind === 'moc.entry.relation' ? 'relation' : 'position',
        mocPath: op.mocPath,
        mocName: op.mocName,
        ...(op.mocId ? { mocId: op.mocId } : {}),
        notePath: op.notePath,
        ...(op.noteId ? { noteId: op.noteId } : {}),
        ...(chapterId ? { chapterId } : {}),
      })
    }
  }
  return pins
}

/**
 * Scott 直接改了 MOC 的區塊（定位問題、從這裡開始、重點結論、待釐清）→ 每個改過的區塊一個標記。
 * before 是上次已知狀態（App 自己寫的已經套進去）；沒看過（null）或不是 MOC 就不標。
 */
export function blockPinsFromEdit(before: string | null, after: string, meta: { mocPath: string, at: number }): ScottPin[] {
  if (before === null || before === after) return []
  const old = parseMoc(before, meta.mocPath)
  const next = parseMoc(after, meta.mocPath)
  if (!next.isMoc) return []
  const mocId = next.id ?? old.id
  return PINNABLE_BLOCKS.filter(block => (old.blocks[block]?.text ?? '') !== (next.blocks[block]?.text ?? ''))
    .map(block => ({ kind: 'block' as const, block, mocPath: meta.mocPath, ...(mocId ? { mocId } : {}), mocName: next.name, at: meta.at }))
}

/** 記下標記；69.11 還沒註冊儲存時略過。失敗不影響修改本身。 */
export async function recordScottPins(pins: readonly ScottPin[]): Promise<void> {
  if (!pins.length) return
  if (!recorder) {
    console.debug('[moc] Scott 指定標記尚無儲存（ALMNC-69.11），略過：', pins.length)
    return
  }
  await recorder(pins).catch(error => console.warn('[moc] Scott 指定標記沒記成：', error))
}

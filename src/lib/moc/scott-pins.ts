// Fork（almanac ALMNC-69.10）：「Scott 指定」標記的交接介面。GLOSSARY：Scott 親手改過的歸屬或位置上的標記；有標記時夥伴在一般整理中
// 不主動提議改動，90 天後失效。判斷規則提案〈在 Obsidian 直接改 MOC 時〉：改了關係說明 → 標 Scott 指定。
//
// 這張票（69.10）只負責「產生」標記：Scott 在 Obsidian 直接生效的收錄修改（改說明＝relation；加入、搬動＝position；章節改名＝chapter-title）
// 都呼叫 recordScottPins。標記怎麼存（系統索引、90 天失效、清理與重整略過）由 ALMNC-69.11 實作：它在 App 啟動時
// registerScottPinRecorder(存的函式)。還沒有註冊時這裡不存（只記 debug）；需要補的話，ops 表 7 天內 actor＝scott 的
// moc.entry.relation／moc.entry.add／moc.entry.move／moc.chapter.rename 紀錄就是同一份資料（每筆 pin 也帶 opId）。
import type { EffectiveDiff } from './reconcile'

export type ScottPinKind = 'relation' | 'position' | 'chapter-title'

export interface ScottPin {
  kind: ScottPinKind
  mocPath: string
  mocId?: string
  mocName: string
  /** 收錄的筆記（章節改名沒有）。 */
  notePath?: string
  noteId?: string
  chapterId?: string
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

/** 記下標記；69.11 還沒註冊儲存時略過。失敗不影響修改本身。 */
export async function recordScottPins(pins: readonly ScottPin[]): Promise<void> {
  if (!pins.length) return
  if (!recorder) {
    console.debug('[moc] Scott 指定標記尚無儲存（ALMNC-69.11），略過：', pins.length)
    return
  }
  await recorder(pins).catch(error => console.warn('[moc] Scott 指定標記沒記成：', error))
}

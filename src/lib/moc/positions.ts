import type { ResolveTarget } from './membership'
import { formalEntries, type ParsedMoc } from './parse'

export const FOUR_WEEKS = 28 * 24 * 60 * 60 * 1000

export interface MocPositions {
  [chapterId: string]: { changedAt: number, entries: Record<string, number> }
}

/** 使用 M／C 編號與解析後的筆記身分記錄位置。首次看到的收錄從當下起算。 */
export function observeMocPositions(moc: ParsedMoc, previous: MocPositions | null, identify: ResolveTarget, now: number): MocPositions {
  const positions: MocPositions = {}
  for (const { id } of [...moc.chapters, ...(moc.unsorted ? [moc.unsorted] : [])]) {
    if (id) positions[id] = { changedAt: now, entries: Object.create(null) }
  }
  for (const { chapter, entry } of formalEntries(moc)) {
    const key = identify(entry.target, moc.path)
    if (!chapter.id || !key) continue
    positions[chapter.id].entries[key] = previous?.[chapter.id]?.entries[key] ?? now
  }
  for (const [id, position] of Object.entries(positions)) {
    const old = previous?.[id]
    const keys = Object.keys(position.entries)
    if (old && keys.length === Object.keys(old.entries).length && keys.every(key => Object.hasOwn(old.entries, key))) {
      position.changedAt = old.changedAt
    }
  }
  return positions
}

export interface MocPinPosition {
  mocId: string
  chapterId: string
  /** N 編號或筆記路徑；缺少時檢查章節本身。 */
  note?: string
}

/** 69.11 可注入以檢查章節標題、收錄位置及關係說明上的 Scott 指定。 */
export type IsMocPinned = (position: MocPinPosition) => boolean | Promise<boolean>

export function splitCandidates(moc: ParsedMoc, baseline: MocPositions | null, identify: ResolveTarget, now: number) {
  if (!moc.id || !baseline) return []
  const current = observeMocPositions(moc, baseline, identify, now)
  return moc.chapters.flatMap(chapter => {
    if (!chapter.id || chapter.grownInto) return []
    const chapterId = chapter.id
    const { changedAt, entries } = current[chapterId]
    const keys = Object.keys(entries)
    if (keys.length < 12 || now - changedAt < FOUR_WEEKS || keys.some(key => now - entries[key] < FOUR_WEEKS)) return []
    return [{ chapterId, title: chapter.title, count: keys.length }]
  })
}

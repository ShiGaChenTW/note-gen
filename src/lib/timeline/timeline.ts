// Fork（#47）：時間軸——筆記（最後修改日）與記錄（建立日）依日期由新到舊、按天分組。
// 每日筆記與知識報告本來就按日期存放，不放進來。
import { parseDailyNotePath, toDateKey } from '@/lib/daily/format'

export interface TimelineNote {
  path: string
  mtime: number
}

export interface TimelineRecord {
  id: number
  createdAt: number
  title: string
  type: string
}

export type TimelineItem =
  | { kind: 'note', key: string, time: number, path: string, title: string }
  | { kind: 'record', key: string, time: number, id: number, title: string, type: string, processed: boolean }

export interface TimelineDay {
  /** YYYY-MM-DD */
  day: string
  items: TimelineItem[]
}

export interface TimelineInput {
  notes: Iterable<TimelineNote>
  records: Iterable<TimelineRecord>
  processedIds: ReadonlySet<number>
  dailyFolder: string
  dailyPattern: string
  excludeFolders: string[]
  /** 只收這個時間點（含）之後的項目。 */
  since: number
}

function noteTitle(path: string) {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

function inFolder(path: string, folder: string) {
  const clean = folder.replace(/^\/+|\/+$/g, '')
  return clean !== '' && path.startsWith(`${clean}/`)
}

export function buildTimeline(input: TimelineInput): TimelineDay[] {
  const items: TimelineItem[] = []
  for (const note of input.notes) {
    if (note.mtime <= 0 || note.mtime < input.since) continue
    if (input.excludeFolders.some(folder => inFolder(note.path, folder))) continue
    if (parseDailyNotePath(note.path, input.dailyFolder, input.dailyPattern)) continue
    items.push({ kind: 'note', key: `note:${note.path}`, time: note.mtime, path: note.path, title: noteTitle(note.path) })
  }
  for (const record of input.records) {
    if (record.createdAt <= 0 || record.createdAt < input.since) continue
    items.push({
      kind: 'record',
      key: `record:${record.id}`,
      time: record.createdAt,
      id: record.id,
      title: record.title,
      type: record.type,
      processed: input.processedIds.has(record.id),
    })
  }
  items.sort((a, b) => b.time - a.time)

  const days: TimelineDay[] = []
  for (const item of items) {
    const day = toDateKey(new Date(item.time))
    const last = days[days.length - 1]
    if (last?.day === day) last.items.push(item)
    else days.push({ day, items: [item] })
  }
  return days
}

/** 比 since 更早的項目還有沒有（決定捲到底要不要再往前載）。 */
export function hasOlderThan(input: Pick<TimelineInput, 'notes' | 'records'>, since: number): boolean {
  for (const note of input.notes) if (note.mtime > 0 && note.mtime < since) return true
  for (const record of input.records) if (record.createdAt > 0 && record.createdAt < since) return true
  return false
}

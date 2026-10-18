/**
 * D2 今日頁的寫回動作。每個動作都回傳 WriteRecord，讓畫面能「復原」。
 * 寫回前一律確認目標行還是索引裡看到的那一行，避免檔案在別處改過時寫錯行。
 */

import { parseNaturalTask, type NaturalTask } from '@/lib/daily/nl-task'
import { completeTaskInContent } from '@/lib/daily/recurrence'
import { toggleTaskInContent } from '@/lib/daily/tasks'
import { stamp, type StampKind } from '@/lib/daily/daily-note'
import { dailyNotePath } from '@/lib/daily/format'
import { ensureDailyNote } from '@/lib/daily/open-daily-note'
import { readNote, writeNote } from '@/lib/daily/note-io'
import type { TaskRef } from '@/lib/vault-index/index-core'
import useDailySettingsStore from '@/stores/daily-settings'
import { carryTasks, dateKey, insertLinesInSection, openTaskLines } from './today-model'
import { setTaskSchedule } from './schedule'

export interface WriteRecord {
  writes: Array<{ path: string, before: string, after: string }>
  /** D5：完成 🔁 任務後，下一次的到期日（沒有日期時為空字串） */
  nextDue?: string
}

/** D4 快速新增寫入今日筆記的這個區塊；找不到時附在檔尾。 */
export const QUICK_ADD_SECTION = '捕捉軌'

const DUE_IN_LINE_RE = /(?:📅️?\s*|due::\s*)(\d{4}-\d{2}-\d{2})/u

export class StaleTaskError extends Error {
  constructor(public path: string) {
    super(`Task line changed on disk: ${path}`)
  }
}

async function applyWrites<T extends WriteRecord>(record: T): Promise<T> {
  for (const write of record.writes) await writeNote(write.path, write.after)
  return record
}

/** 讀出任務所在的檔案，確認那一行還是索引裡看到的樣子。 */
async function readTaskSource(task: TaskRef): Promise<{ before: string, lines: string[] }> {
  const before = await readNote(task.path)
  if (before === null) throw new StaleTaskError(task.path)
  const lines = before.split('\n')
  if (lines[task.line]?.replace(/\r$/, '') !== task.raw) throw new StaleTaskError(task.path)
  return { before, lines }
}

/** 勾選或取消勾選。未完成且帶 🔁 的任務完成時，下一行會產生下一次。 */
export async function setTaskChecked(task: TaskRef, checked: boolean, now: Date = new Date()): Promise<WriteRecord> {
  const { before } = await readTaskSource(task)
  const after = checked && !task.done
    ? completeTaskInContent(before, task.line, now)
    : checked === task.done
      ? before
      : toggleTaskInContent(before, task.line, { today: now })
  if (after === null) throw new StaleTaskError(task.path)
  if (after === before) return { writes: [] }
  const record: WriteRecord = { writes: [{ path: task.path, before, after }] }
  if (checked && !task.done && task.recurrence) {
    const nextLine = after.split('\n')[task.line + 1] ?? ''
    record.nextDue = nextLine.match(DUE_IN_LINE_RE)?.[1] ?? ''
  }
  return applyWrites(record)
}

/** D8：把任務排到今天的某個時間，到期日一併改成今天；time 為空字串時只取消時間。 */
export async function scheduleTask(task: TaskRef, time: string, now: Date = new Date()): Promise<WriteRecord> {
  const { before, lines } = await readTaskSource(task)
  // 取消時間時不動到期日；排上時間代表排在今天
  const updated = setTaskSchedule(lines[task.line], { due: time ? dateKey(now) : task.due || dateKey(now), time })
  if (updated === null) throw new StaleTaskError(task.path)
  lines[task.line] = updated
  const after = lines.join('\n')
  if (after === before) return { writes: [] }
  return applyWrites({ writes: [{ path: task.path, before, after }] })
}

/** D4：把一行自然語言轉成 Obsidian Tasks 任務，寫進今日筆記的捕捉區塊。 */
export async function quickAddTask(input: string, now: Date = new Date()): Promise<WriteRecord & { task: NaturalTask }> {
  const task = parseNaturalTask(input, now)
  if (!task.title) return { writes: [], task }
  const { path } = await ensureDailyNote(now)
  const before = await readNote(path) ?? ''
  const after = insertLinesInSection(before, [task.line], QUICK_ADD_SECTION)
  return applyWrites({ writes: [{ path, before, after }], task })
}

/** 復原：只有在檔案仍是我們寫入的內容時才還原，避免蓋掉之後的編輯。 */
export async function undoWrites(record: WriteRecord): Promise<boolean> {
  for (const write of record.writes) {
    if (await readNote(write.path) !== write.after) return false
  }
  for (const write of [...record.writes].reverse()) await writeNote(write.path, write.before)
  return true
}

/** 早晨啟動／整日復盤：在今日筆記寫入 `morning:: done`／`reviewed:: done`。 */
export async function stampToday(kind: StampKind, now: Date = new Date()): Promise<WriteRecord> {
  const { path } = await ensureDailyNote(now)
  const before = await readNote(path) ?? ''
  const result = stamp(before, kind)
  if (!result.changed) return { writes: [] }
  return applyWrites({ writes: [{ path, before, after: result.content }] })
}

function yesterdayOf(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
}

/** 昨天的日記裡還沒完成的任務數；沒有昨天的日記時為 0。 */
export async function countCarryable(now: Date = new Date()): Promise<number> {
  await useDailySettingsStore.getState().initSettings()
  const { dailyFolder, dailyPattern } = useDailySettingsStore.getState()
  const content = await readNote(dailyNotePath(yesterdayOf(now), dailyFolder, dailyPattern))
  return content === null ? 0 : openTaskLines(content).length
}

/** D6：把昨天日記的未完成任務移到今日筆記，原處留下 `→ [[今天]]`。 */
export async function carryYesterdayTasks(now: Date = new Date()): Promise<WriteRecord & { moved: number }> {
  await useDailySettingsStore.getState().initSettings()
  const { dailyFolder, dailyPattern } = useDailySettingsStore.getState()
  const sourcePath = dailyNotePath(yesterdayOf(now), dailyFolder, dailyPattern)
  const source = await readNote(sourcePath)
  if (source === null) return { writes: [], moved: 0 }

  const { path: targetPath } = await ensureDailyNote(now)
  const target = await readNote(targetPath) ?? ''
  const targetNoteName = targetPath.split('/').pop()!.replace(/\.md$/i, '')
  const result = carryTasks({ source, target, lines: openTaskLines(source), targetNoteName })
  if (result.moved === 0) return { writes: [], moved: 0 }

  // 先寫今天再改昨天：中途失敗時任務最多重複，不會遺失
  const record = await applyWrites({
    writes: [
      { path: targetPath, before: target, after: result.target },
      { path: sourcePath, before: source, after: result.source },
    ],
  })
  return { ...record, moved: result.moved }
}

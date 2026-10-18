/**
 * D2 今日頁的寫回動作。每個動作都回傳 WriteRecord，讓畫面能「復原」。
 * 寫回前一律確認目標行還是索引裡看到的那一行，避免檔案在別處改過時寫錯行。
 */

import { completeTaskInContent } from '@/lib/daily/recurrence'
import { toggleTaskInContent } from '@/lib/daily/tasks'
import { stamp, type StampKind } from '@/lib/daily/daily-note'
import { dailyNotePath } from '@/lib/daily/format'
import { ensureDailyNote } from '@/lib/daily/open-daily-note'
import { readNote, writeNote } from '@/lib/daily/note-io'
import type { TaskRef } from '@/lib/vault-index/index-core'
import useDailySettingsStore from '@/stores/daily-settings'
import { carryTasks, openTaskLines } from './today-model'

export interface WriteRecord {
  writes: Array<{ path: string, before: string, after: string }>
}

export class StaleTaskError extends Error {
  constructor(public path: string) {
    super(`Task line changed on disk: ${path}`)
  }
}

async function applyWrites(record: WriteRecord): Promise<WriteRecord> {
  for (const write of record.writes) await writeNote(write.path, write.after)
  return record
}

/** 勾選或取消勾選。未完成且帶 🔁 的任務完成時，下一行會產生下一次。 */
export async function setTaskChecked(task: TaskRef, checked: boolean, now: Date = new Date()): Promise<WriteRecord> {
  const before = await readNote(task.path)
  if (before === null) throw new StaleTaskError(task.path)
  const line = before.split('\n')[task.line]?.replace(/\r$/, '')
  if (line !== task.raw) throw new StaleTaskError(task.path)

  const after = checked && !task.done
    ? completeTaskInContent(before, task.line, now)
    : checked === task.done
      ? before
      : toggleTaskInContent(before, task.line, { today: now })
  if (after === null) throw new StaleTaskError(task.path)
  if (after === before) return { writes: [] }
  return applyWrites({ writes: [{ path: task.path, before, after }] })
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

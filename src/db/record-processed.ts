// Fork（#46）：記錄的「已整理」狀態。整理成筆記或轉成筆記之後標記，Inbox 預設不顯示。
// 只存在本機（record_processed 表），不動記錄的同步格式。
import { getDb } from './index'

export interface RecordProcessed {
  markId: number
  processedAt: number
  notePath: string | null
}

export async function getProcessedRecords(): Promise<Map<number, RecordProcessed>> {
  const db = await getDb()
  const rows = await db.select<RecordProcessed[]>('select markId, processedAt, notePath from record_processed')
  return new Map(rows.map(row => [row.markId, row]))
}

export async function markRecordsProcessed(markIds: number[], notePath: string | null, now = Date.now()) {
  if (markIds.length === 0) return
  const db = await getDb()
  for (const markId of markIds) {
    await db.execute(
      'insert or replace into record_processed (markId, processedAt, notePath) values ($1, $2, $3)',
      [markId, now, notePath],
    )
  }
}

export async function unmarkRecordsProcessed(markIds: number[]) {
  if (markIds.length === 0) return
  const db = await getDb()
  for (const markId of markIds) {
    await db.execute('delete from record_processed where markId = $1', [markId])
  }
}

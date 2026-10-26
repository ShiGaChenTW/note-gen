// Fork（#53）：提示詞的使用次數／最後使用時間。只存本機（prompt_usage 表），不寫進筆記。
// 以筆記路徑為鍵；筆記被改名或搬移到資料夾外會跟著失去使用紀錄（已知限制，見 PR 說明）。
import { getDb } from './index'

export interface PromptUsage {
  path: string
  useCount: number
  lastUsedAt: number
}

export async function getPromptUsageMap(): Promise<Map<string, PromptUsage>> {
  const db = await getDb()
  const rows = await db.select<PromptUsage[]>('select path, useCount, lastUsedAt from prompt_usage')
  return new Map(rows.map(row => [row.path, row]))
}

export async function recordPromptUsage(path: string, now = Date.now()): Promise<void> {
  const db = await getDb()
  await db.execute(
    `insert into prompt_usage (path, useCount, lastUsedAt) values ($1, 1, $2)
     on conflict(path) do update set useCount = useCount + 1, lastUsedAt = $2`,
    [path, now],
  )
}

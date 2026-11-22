// Fork（almanac ALMNC-54.14）：舊筆記批次裡指揮官判斷不出來的筆記（note.db 的 legacy_undecided）。
// 同一批（batch_id）判斷不出來的合成「一包」，工作台一次只出現一包（lib/migration/legacy.ts 的 currentPack）。
// Scott 按「整理好了」只記 resolved_at，不刪列，也不動筆記檔。
import { getDb } from './index'
import type { LegacyPack } from '@/lib/migration/legacy'

let initialized: Promise<void> | null = null

export function initLegacyPackDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists legacy_undecided (
          source_id text primary key,
          path text not null,
          batch_id text not null,
          created_at integer not null,
          resolved_at integer
        )
      `)
      await db.execute('create index if not exists idx_legacy_undecided_batch on legacy_undecided(batch_id, resolved_at)')
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

/** 記下一包；同一則資料源已經在別包裡就不重複記。 */
export async function addLegacyPack(batchId: string, items: ReadonlyArray<{ sourceId: string, path: string }>, now = Date.now()): Promise<void> {
  if (!items.length) return
  await initLegacyPackDb()
  const db = await getDb()
  for (const item of items) {
    await db.execute(
      `insert into legacy_undecided (source_id, path, batch_id, created_at) values ($1, $2, $3, $4)
       on conflict(source_id) do nothing`,
      [item.sourceId, item.path, batchId, now]
    )
  }
}

/** 還沒整理好的包，舊的在前。 */
export async function listOpenLegacyPacks(): Promise<LegacyPack[]> {
  await initLegacyPackDb()
  const db = await getDb()
  const rows = await db.select<Array<{ sourceId: string, path: string, batchId: string, createdAt: number }>>(
    `select source_id as sourceId, path, batch_id as batchId, created_at as createdAt
     from legacy_undecided where resolved_at is null order by created_at asc, path asc`
  )
  const packs = new Map<string, LegacyPack>()
  for (const row of rows) {
    const pack = packs.get(row.batchId) ?? { id: row.batchId, createdAt: Number(row.createdAt), items: [] }
    pack.items.push({ sourceId: row.sourceId, path: row.path })
    packs.set(row.batchId, pack)
  }
  return Array.from(packs.values())
}

export async function setLegacyPackResolved(batchId: string, resolved: boolean, now = Date.now()): Promise<void> {
  await initLegacyPackDb()
  const db = await getDb()
  await db.execute('update legacy_undecided set resolved_at = $2 where batch_id = $1', [batchId, resolved ? now : null])
}

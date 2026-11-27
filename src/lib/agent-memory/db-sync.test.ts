// Fork（almanac ALMNC-85.3）：V3 同步開過之後的活動紀錄讀取——標出寫這筆的裝置、更正晚到時用 corrects_uid 接回、
// 另一台的單例夥伴 id 查別名表換成這台那位（actor_id 只能新增、不能改）。
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { migrateActivitySyncColumns, type ActivityMigrationStatement } from './schema'
import { appendActivity, listActivity } from '@/db/agent-memory'

type Bindings = Record<string, string | number | null>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): { all(bindings: Bindings): unknown[], run(bindings: Bindings): { changes: number, lastInsertRowid: number | bigint } }
  close(): void
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const sqlite = new DatabaseSync(':memory:')
const bind = (values: Array<string | number | null>) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))
const db = {
  execute: async (sql: string, values: Array<string | number | null> = []) => {
    const result = sqlite.prepare(sql).run(bind(values))
    return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
  },
  select: async (sql: string, values: Array<string | number | null> = []) => sqlite.prepare(sql).all(bind(values)),
}

vi.mock('@/db/index', () => ({
  executeRecordTransaction: async () => { throw new Error('not used') },
  getDb: async () => db,
}))

afterAll(() => sqlite.close())

async function runTransaction(statements: ActivityMigrationStatement[]) {
  sqlite.exec('begin')
  try {
    for (const statement of statements) sqlite.prepare(statement.sql).run(bind(statement.values))
    sqlite.exec('commit')
  } catch (error) {
    sqlite.exec('rollback')
    throw error
  }
}

describe('listActivity 在 V3 同步開過之後（ALMNC-85.3）', () => {
  it('標出裝置、更正晚到也接得回、發起者別名換成這台的夥伴', async () => {
    const now = Date.now()
    await appendActivity('system', { actorId: 'mia-a', actorRole: 'commander', action: 'created', targetLink: 'note:a.md', source: { kind: 'proposal', ref: 'p1' } }, now - 3000)
    await migrateActivitySyncColumns(db as never, runTransaction, 'dev-a')
    // 另一台的更正先到：corrects_id 留空、corrects_uid 有值；被更正的那筆之後才到。
    sqlite.prepare(`insert into activity_log (at, actor_id, actor_role, action, target_link, source_kind, source_ref, note, corrects_id, uid, corrects_uid, origin_device)
      values ($1, 'mia-b', 'commander', 'corrected', 'note:b.md', 'proposal', 'p2', '更正', null, 'dev-b:2', 'dev-b:1', 'dev-b')`).run(bind([now - 1000]))
    sqlite.prepare(`insert into activity_log (at, actor_id, actor_role, action, target_link, source_kind, source_ref, note, corrects_id, uid, corrects_uid, origin_device)
      values ($1, 'mia-b', 'commander', 'created', 'note:b.md', 'proposal', 'p2', '記錯的', null, 'dev-b:1', null, 'dev-b')`).run(bind([now - 2000]))
    sqlite.exec(`create table if not exists almanac_sync_aliases (table_name text not null, alias_id text not null, canonical_id text not null,
      created_at integer not null, primary key (table_name, alias_id))`)
    sqlite.prepare("insert into almanac_sync_aliases values ('agents', 'mia-b', 'mia-a', 1)").run({})

    const [correction, wrong, own] = await listActivity({ now })
    expect(own).toMatchObject({ actorId: 'mia-a', originDevice: 'dev-a' })
    expect(wrong).toMatchObject({ note: '記錯的', actorId: 'mia-a', originDevice: 'dev-b' })
    expect(correction).toMatchObject({ note: '更正', correctsId: wrong.id, originDevice: 'dev-b' })
  })
})

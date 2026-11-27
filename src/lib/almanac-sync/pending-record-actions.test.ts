// Fork（almanac ALMNC-85.2，設計第 3 節）：別台刪的 RSS 訂閱——確認＝寫進最近刪除再移除；保留＝記下時間（下一輪推回去）。
import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlmanacSqlDb, SqlValue } from './sql'

type Bindings = Record<string, SqlValue>
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => { prepare(sql: string): { all(b: Bindings): unknown[]; run(b: Bindings): unknown } }
}
const bind = (values: SqlValue[] = []) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

const fake = vi.hoisted(() => ({
  db: null as unknown,
  feeds: [] as Array<{ id: string; url: string; name: string; keptAt?: number }>,
  dropped: [] as string[],
  kept: [] as string[],
  recordDbTrash: vi.fn(async () => ({})),
}))

vi.mock('@/db/index', () => ({ getDb: async () => fake.db }))
vi.mock('@/lib/trash/runtime', () => ({ recordDbTrash: fake.recordDbTrash }))
vi.mock('@/lib/source-import/rss-store', () => ({
  default: {
    getState: () => ({
      load: async () => undefined,
      get feeds() { return fake.feeds },
      remove: async (id: string) => {
        fake.dropped.push(id)
        fake.feeds = fake.feeds.filter(feed => feed.id !== id)
      },
      keep: async (id: string) => { fake.kept.push(id) },
    }),
  },
}))

const { upsertPendingRecordDeletion, listPendingRecordDeletions } = await import('./tables/pending-records')
const { confirmPendingRecordDeletion, rejectPendingRecordDeletion, listPendingRecordDeletionsForUi } = await import('./pending-record-actions')

function memoryDb(): AlmanacSqlDb {
  const sqlite = new DatabaseSync(':memory:')
  return {
    async execute(sql, values) { return sqlite.prepare(sql).run(bind(values)) },
    async select<T>(sql: string, values?: SqlValue[]) { return sqlite.prepare(sql).all(bind(values)) as T },
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fake.db = memoryDb()
  fake.dropped = []
  fake.kept = []
  fake.feeds = [{ id: 'rss_1', url: 'https://f.example/feed', name: 'Blog' }]
  await upsertPendingRecordDeletion(fake.db as AlmanacSqlDb, {
    tableName: 'feeds', syncKey: 'rss_1', title: 'Blog', snapshot: fake.feeds[0], deletedAt: 100, deviceId: 'dev-b', now: 200,
  })
})

describe('別台刪的 RSS 訂閱：確認與保留', () => {
  it('確認：先寫進最近刪除（同步刪除、30 天可救回），再從清單移除；同一個刪除不會再出現', async () => {
    expect((await listPendingRecordDeletionsForUi()).map(item => item.syncKey)).toEqual(['rss_1'])
    expect(await confirmPendingRecordDeletion('feeds', 'rss_1')).toBe(true)
    expect(fake.recordDbTrash).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'rss-feed', entityId: 'rss_1', title: 'Blog', deletedBy: 'sync', actorRole: 'sync', source: 'sync',
      metadata: { feed: expect.objectContaining({ id: 'rss_1' }), index: 0 },
    }))
    expect(fake.dropped).toEqual(['rss_1'])
    expect(await listPendingRecordDeletionsForUi()).toEqual([])
    await upsertPendingRecordDeletion(fake.db as AlmanacSqlDb, { tableName: 'feeds', syncKey: 'rss_1', title: 'Blog', snapshot: null, deletedAt: 100, deviceId: 'dev-b', now: 300 })
    expect(await listPendingRecordDeletionsForUi()).toEqual([])
  })

  it('保留：不刪，記下保留時間；別台之後又刪一次（較新的墓碑）才重新問', async () => {
    expect(await rejectPendingRecordDeletion('feeds', 'rss_1')).toBe(true)
    expect(fake.kept).toEqual(['rss_1'])
    expect(fake.dropped).toEqual([])
    expect((await listPendingRecordDeletions(fake.db as AlmanacSqlDb, 'all'))[0].status).toBe('rejected')
    await upsertPendingRecordDeletion(fake.db as AlmanacSqlDb, { tableName: 'feeds', syncKey: 'rss_1', title: 'Blog', snapshot: null, deletedAt: 500, deviceId: 'dev-b', now: 600 })
    expect((await listPendingRecordDeletionsForUi()).map(item => item.syncKey)).toEqual(['rss_1'])
  })
})

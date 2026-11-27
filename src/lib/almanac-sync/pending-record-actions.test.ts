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

// Fork（almanac ALMNC-85.3，第 8 節 2A）：別台刪的專家——確認＝專家與記憶寫進最近刪除再移除；保留＝記成現在改過（推回去）；救回＝寫回本機。
const { AGENT_SCHEMA } = await import('@/lib/agents/schema')
const { AGENT_MEMORY_SCHEMA } = await import('@/lib/agent-memory/schema')
const { restoreCrewAgentSnapshot } = await import('./pending-record-actions')

describe('別台刪的專家：確認、保留與從最近刪除救回', () => {
  beforeEach(async () => {
    const db = fake.db as AlmanacSqlDb
    for (const sql of [...AGENT_SCHEMA, ...AGENT_MEMORY_SCHEMA]) await db.execute(sql)
    await db.execute(`insert into agent_settings (id, name, role, domain, enabled, allowed_tools, created_at, updated_at)
      values ('exp-1', 'Iris', 'expert', '工業工程', 1, '[]', 10, 20)`)
    await db.execute(`insert into agent_memory (agent_id, kind, content, updated_at, updated_by) values ('exp-1', 'soul', 'Iris 的 soul', 30, 'scott')`)
    await upsertPendingRecordDeletion(db, {
      tableName: 'crew', syncKey: 'agent:exp-1', title: 'Iris（工業工程）', snapshot: null, deletedAt: 100, deviceId: 'dev-b', now: 200,
    })
  })

  const agents = async () => (fake.db as AlmanacSqlDb).select<Array<{ id: string; updatedAt: number }>>('select id, updated_at as updatedAt from agent_settings')
  const memory = async () => (fake.db as AlmanacSqlDb).select<Array<{ content: string; updatedAt: number }>>('select content, updated_at as updatedAt from agent_memory')

  it('確認：專家與記憶的快照寫進最近刪除，再從本機移除', async () => {
    expect(await confirmPendingRecordDeletion('crew', 'agent:exp-1')).toBe(true)
    expect(fake.recordDbTrash).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'agent', entityId: 'exp-1', title: 'Iris（工業工程）', deletedBy: 'sync', source: 'sync',
      metadata: { agent: expect.objectContaining({ id: 'exp-1', name: 'Iris' }), memory: [expect.objectContaining({ kind: 'soul', content: 'Iris 的 soul' })] },
    }))
    expect(await agents()).toEqual([])
    expect(await memory()).toEqual([])
  })

  it('保留：專家與記憶記成現在改過（晚於刪除），下一輪同步推回', async () => {
    expect(await rejectPendingRecordDeletion('crew', 'agent:exp-1')).toBe(true)
    const [agent] = await agents()
    expect(agent.updatedAt).toBeGreaterThan(100)
    expect((await memory())[0].updatedAt).toBeGreaterThan(100)
  })

  it('從最近刪除救回：設定與記憶寫回本機；已經存在就不重複寫', async () => {
    const trashed = (fake.recordDbTrash.mock.calls as unknown[][])
    expect(await confirmPendingRecordDeletion('crew', 'agent:exp-1')).toBe(true)
    const metadata = (trashed.at(-1)?.[0] as { metadata: Record<string, unknown> }).metadata
    await restoreCrewAgentSnapshot(metadata)
    await restoreCrewAgentSnapshot(metadata)
    expect((await agents()).map(agent => agent.id)).toEqual(['exp-1'])
    expect((await memory()).map(row => row.content)).toEqual(['Iris 的 soul'])
  })
})

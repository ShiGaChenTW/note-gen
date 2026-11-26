import { createRequire } from 'node:module'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRASH_RETENTION_MS } from '@/lib/trash/types'

type Bindings = Record<string, string | number | null>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): {
    all(bindings: Bindings): unknown[]
    run(bindings: Bindings): { changes: number; lastInsertRowid: number | bigint }
  }
  close(): void
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDb
}
const sqlite = new DatabaseSync(':memory:')
const bind = (values: Array<string | number | null>) =>
  Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

vi.mock('@/db/index', () => ({
  getDb: async () => ({
    execute: async (sql: string, values: Array<string | number | null> = []) => {
      const result = sqlite.prepare(sql).run(bind(values))
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    },
    select: async (sql: string, values: Array<string | number | null> = []) =>
      sqlite.prepare(sql).all(bind(values)),
  }),
  executeRecordTransaction: async () => undefined,
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: async () => ({
      get: async () => true,
      set: async () => undefined,
      save: async () => undefined,
    }),
  },
}))

vi.mock('@/lib/sync/auto-data-sync-queue', () => ({
  enqueueAutoDataSync: vi.fn(),
}))

vi.mock('@/lib/ai/embedding', () => ({
  fetchEmbedding: vi.fn(async () => null),
  getEmbeddingModelDescriptor: vi.fn(async () => null),
}))

const { createTrashDbStore, initTrashDb } = await import('./trash')
const { initConversationSyncStateDb } = await import('./conversation-sync-state')
const {
  getAllConversations,
  initConversationsDb,
  restoreConversation,
  softDeleteConversation,
} = await import('./conversations')
const {
  getAllMemories,
  getMemoryStats,
  initMemoriesDb,
  reindexPendingMemories,
  restoreTrashedMemory,
  softDeleteMemory,
  upsertMemory,
} = await import('./memories')

describe('Trash DB integration (ALMNC-84.4)', () => {
  beforeAll(async () => {
    sqlite.exec(`
      drop table if exists trash_items;
      drop table if exists chats;
      drop table if exists conversations;
      drop table if exists conversation_sync_clock;
      drop table if exists conversation_sync_tombstones;
      drop table if exists memories;
      drop table if exists memory_jobs;
      drop table if exists memory_global_policy;
      create table chats (
        id integer primary key autoincrement,
        tagId integer not null default 1,
        content text,
        role text,
        type text,
        createdAt integer,
        conversationId integer,
        syncId text,
        syncUpdatedAt integer
      );
    `)
    await initTrashDb()
    await initConversationSyncStateDb()
    await initConversationsDb()
    await initMemoriesDb()
  })

  beforeEach(() => {
    sqlite.exec(`
      delete from trash_items;
      delete from chats;
      delete from conversations;
      delete from memories;
    `)
  })

  afterAll(async () => {
    await reindexPendingMemories().catch(() => undefined)
    sqlite.close()
  })

  it('round-trips trash_items across workspaces and lists expired rows accurately', async () => {
    const store = createTrashDbStore()
    const base = 1_700_000_000_000

    await store.insert({
      id: 't-vault-a',
      workspace: '/vault-a',
      entityType: 'file',
      entityId: 't-vault-a',
      title: 'a.md',
      originalPath: 'notes/a.md',
      trashPath: '.almanac-trash/t-vault-a/a.md',
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'file-tree',
      sizeBytes: 120,
      metadata: null,
      deletedAt: base,
      expiresAt: base + TRASH_RETENTION_MS,
    })

    await store.insert({
      id: 't-global',
      workspace: '',
      entityType: 'memory',
      entityId: 'mem-1',
      title: 'Remember tea',
      originalPath: null,
      trashPath: null,
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'memory-settings',
      sizeBytes: 0,
      metadata: { previousStatus: 'active' },
      deletedAt: base + 1000,
      expiresAt: base + 1000 + TRASH_RETENTION_MS,
    })

    await store.insert({
      id: 't-vault-b',
      workspace: '/vault-b',
      entityType: 'file',
      entityId: 't-vault-b',
      title: 'b.md',
      originalPath: 'notes/b.md',
      trashPath: '.almanac-trash/t-vault-b/b.md',
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'file-tree',
      sizeBytes: 50,
      metadata: null,
      deletedAt: base + 2000,
      expiresAt: base + 2000 + TRASH_RETENTION_MS,
    })

    expect((await store.list('/vault-a')).map(item => item.id)).toEqual(['t-global', 't-vault-a'])
    expect((await store.findByEntity('memory', 'mem-1'))?.metadata).toEqual({ previousStatus: 'active' })
    expect((await store.listExpired(base + TRASH_RETENTION_MS)).map(item => item.id)).toEqual(['t-vault-a'])
  })

  it('soft-deletes and restores conversations and memories cleanly in SQLite', async () => {
    await initConversationsDb()
    sqlite.prepare(
      `insert into conversations (id, syncId, syncUpdatedAt, title, createdAt, updatedAt, messageCount, isPinned)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`
    ).run({ $1: 1, $2: 'conv-1', $3: 10, $4: 'Test thread', $5: 10, $6: 10, $7: 1, $8: 0 })

    expect((await getAllConversations()).map(c => c.id)).toEqual([1])
    await softDeleteConversation(1)
    expect(await getAllConversations()).toEqual([])
    await restoreConversation(1)
    expect((await getAllConversations()).map(c => c.id)).toEqual([1])

    await initMemoriesDb()
    const created = await upsertMemory({ content: 'Prefer concise checklists', status: 'active' })
    expect(await getMemoryStats()).toMatchObject({ total: 1, memories: 1 })
    await softDeleteMemory(created.id)
    expect(await getAllMemories({ includeInactive: true })).toEqual([])
    expect(await getMemoryStats()).toMatchObject({ total: 0 })
    await restoreTrashedMemory(created.id, 'active')
    expect((await getAllMemories()).map(m => m.id)).toEqual([created.id])
  })
})

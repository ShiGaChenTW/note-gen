// Fork（almanac ALMNC-69.9）：ops 表用真的 node:sqlite 測（同 lib/agent-memory/db.test.ts 的做法）：寫入讀回、整批、標記復原、清掉 7 天外的。
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createOpsDbStore, initOpsDb } from '@/db/ops'
import type { OpRecord } from './types'

type Bindings = Record<string, string | number | null>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): { all(bindings: Bindings): unknown[], run(bindings: Bindings): { changes: number, lastInsertRowid: number | bigint } }
  close(): void
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const sqlite = new DatabaseSync(':memory:')
const bind = (values: Array<string | number | null>) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

vi.mock('@/db/index', () => ({
  getDb: async () => ({
    execute: async (sql: string, values: Array<string | number | null> = []) => {
      const result = sqlite.prepare(sql).run(bind(values))
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    },
    select: async (sql: string, values: Array<string | number | null> = []) => sqlite.prepare(sql).all(bind(values)),
  }),
}))

afterAll(() => sqlite.close())

const row = (id: string, at: number, batchId?: string): Omit<OpRecord, 'seq'> => ({
  id, at, actor: 'commander', actorId: 'mia', kind: 'note.create',
  payload: { kind: 'note.create', path: `${id}.md`, title: id, content: 'x' },
  inverse: { kind: 'note.delete', path: `${id}.md`, title: id, content: 'x' },
  proposalId: 'collect:1:1', ...(batchId ? { batchId } : {}),
  baseVersions: { [`${id}.md`]: 'abc' }, undoneAt: null,
})

const opsStore = createOpsDbStore(() => '/vault-a')
const otherVault = createOpsDbStore(() => '/vault-b')

describe('ops table', () => {
  it('round-trips records, lists a batch in order, marks undone and prunes old rows', async () => {
    await initOpsDb()
    await initOpsDb()
    const [a, b] = await opsStore.insert([row('a', 10, 'batch'), row('b', 10, 'batch')])
    expect(a).toMatchObject({ id: 'a', actorId: 'mia', proposalId: 'collect:1:1', batchId: 'batch', baseVersions: { 'a.md': 'abc' }, undoneAt: null })
    expect(b.seq).toBeGreaterThan(a.seq)
    await opsStore.insert([row('c', 5)])
    expect((await opsStore.listBatch('batch')).map(item => item.id)).toEqual(['a', 'b'])
    expect((await opsStore.getMany(['c', 'a'])).map(item => item.id).sort()).toEqual(['a', 'c'])
    // 換了筆記庫就看不到（不能復原別的筆記庫的操作）。
    expect(await otherVault.get('a')).toBeNull()
    expect(await otherVault.listBatch('batch')).toEqual([])
    await opsStore.markUndone(['a'], 99)
    expect((await opsStore.get('a'))?.undoneAt).toBe(99)
    expect(await opsStore.prune(6)).toBe(1)
    expect(await opsStore.get('c')).toBeNull()
  })
})

it('inserts a guarded batch as one statement', async () => {
  const inserted = await opsStore.insert([row('atomic-a', 120, 'atomic'), row('atomic-b', 120, 'atomic')], { atomic: true })
  expect(inserted.map(op => op.id)).toEqual(['atomic-a', 'atomic-b'])
  await expect(opsStore.insert([row('atomic-c', 120, 'fail'), row('atomic-a', 120, 'fail')], { atomic: true })).rejects.toThrow()
  expect(await opsStore.listBatch('fail')).toEqual([])
})

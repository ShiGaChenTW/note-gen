// Fork（almanac ALMNC-71）：舊 activity_log（角色／來源限制沒有 system）升級，用真的 node:sqlite、foreign_keys 開著測
// （App 的 sqlx 連線預設開 foreign_keys）。executeRecordTransaction 照 Rust 端的行為：一個交易、expectedRows 不符就整批還原。
import { createRequire } from 'node:module'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateActivityLog, needsActivityRebuild } from './schema'
import { parseRepairRef, repairActivityEntries } from '@/lib/v3-model/id-scan-activity'
import type { ScanAction } from '@/lib/v3-model/id-scan'

type Value = string | number | null
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): {
    all(bindings: Record<string, Value>): unknown[]
    run(bindings: Record<string, Value>): { changes: number, lastInsertRowid: number | bigint }
  }
  close(): void
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const sqlite = new DatabaseSync(':memory:')
const bind = (values: Value[]) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))
const run = (sql: string, values: Value[] = []) => sqlite.prepare(sql).run(bind(values))
const all = <T>(sql: string, values: Value[] = []) => sqlite.prepare(sql).all(bind(values)) as T

async function transaction(statements: Array<{ sql: string, values: Value[], expectedRows?: number }>) {
  sqlite.exec('begin')
  try {
    for (const statement of statements) {
      const result = run(statement.sql, statement.values)
      if (statement.expectedRows !== undefined && statement.expectedRows !== result.changes) throw new Error('ROWS_CHANGED')
    }
    sqlite.exec('commit')
  } catch (error) {
    sqlite.exec('rollback')
    throw error
  }
}

vi.mock('@/db/index', () => ({
  executeRecordTransaction: (statements: Array<{ sql: string, values: Value[], expectedRows?: number }>) => transaction(statements),
  getDb: async () => ({
    execute: async (sql: string, values: Value[] = []) => {
      const result = run(sql, values)
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    },
    select: async (sql: string, values: Value[] = []) => all(sql, values),
  }),
}))

afterAll(() => sqlite.close())

// ALMNC-71 之前（69.9 之後）的 activity_log：原始建表語法＋op_id 用 alter 補上。
const LEGACY = [
  `create table activity_log (
    id integer primary key,
    at integer not null,
    actor_id text not null check (length(trim(actor_id)) > 0),
    actor_role text not null check (actor_role in ('scott', 'commander', 'expert', 'secretary', 'researcher')),
    action text not null,
    target_link text not null check (length(trim(target_link)) > 0),
    source_kind text not null check (source_kind in ('conversation', 'proposal')),
    source_ref text not null check (length(trim(source_ref)) > 0),
    note text not null default '' check (length(note) <= 60),
    corrects_id integer references activity_log(id),
    archived_at integer
  )`,
  'create index idx_activity_log_at on activity_log(at desc, id desc)',
  `create trigger activity_log_no_delete before delete on activity_log
    begin select raise(abort, 'ACTIVITY_LOG_APPEND_ONLY'); end`,
  'alter table activity_log add column op_id text default null',
]

const NOW = Date.UTC(2026, 10, 24)
const DAY = 24 * 60 * 60 * 1000
const LEGACY_ROWS: Value[][] = [
  [1, NOW - 100 * DAY, 'leo', 'secretary', 'created', 'task:1', 'conversation', 'c1', '新增會議', null, NOW - 9 * DAY, null],
  [2, NOW - 3 * DAY, 'mia', 'commander', 'accepted', 'proposal:p1', 'proposal', 'p1', '', null, null, 'op-1'],
  [3, NOW - 2 * DAY, 'mia', 'commander', 'corrected', 'proposal:p1', 'proposal', 'p1', '時間記錯', 2, null, null],
  [4, NOW - DAY, 'scott', 'scott', 'undone', 'note:a.md', 'proposal', 'op:op-1', '', null, null, 'op-1'],
]
const snapshot = () => all<unknown[]>('select * from activity_log order by id')

function createLegacy() {
  sqlite.exec('drop table if exists activity_log')
  for (const sql of LEGACY) sqlite.exec(sql)
  for (const row of LEGACY_ROWS) {
    run(`insert into activity_log (id, at, actor_id, actor_role, action, target_link, source_kind, source_ref, note, corrects_id, archived_at, op_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, row)
  }
}

const tableSql = () => all<Array<{ sql: string }>>("select sql from sqlite_master where type = 'table' and name = 'activity_log'")[0]?.sql

beforeEach(() => {
  sqlite.exec('pragma foreign_keys = on')
})

describe('ALMNC-71 activity_log 放寬限制', () => {
  it('rolls back completely when the copy does not match', async () => {
    createLegacy()
    const before = snapshot()
    await expect(migrateActivityLog(
      { select: async <T>(sql: string) => all<T>(sql) },
      statements => transaction(statements.map(statement => statement.expectedRows === undefined ? statement : { ...statement, expectedRows: 99 })),
    )).rejects.toThrow('ROWS_CHANGED')
    expect(snapshot()).toEqual(before)
    expect(needsActivityRebuild(tableSql())).toBe(true)
    expect(all('select name from sqlite_master where name = $1', ['activity_log_v2'])).toEqual([])
  })

  it('upgrades the old table on startup: old rows intact, append-only kept, system repairs writable, survive reload, filterable', async () => {
    createLegacy()
    const before = snapshot()
    const memory = await import('@/db/agent-memory')

    // 啟動時升級：舊資料一字不差（含編號、封存時間、op_id、更正指向）。
    const listed = await memory.listActivity({ now: NOW, includeArchived: true, limit: 500 })
    expect(snapshot()).toEqual(before)
    expect(listed.map(entry => entry.id)).toEqual([4, 3, 2, 1])
    expect(listed.find(entry => entry.id === 3)).toMatchObject({ correctsId: 2, note: '時間記錯' })
    expect(listed.find(entry => entry.id === 2)).toMatchObject({ opId: 'op-1', source: { kind: 'proposal', ref: 'p1' } })
    expect(needsActivityRebuild(tableSql())).toBe(false)
    expect(tableSql()).toMatch(/references\s+"?activity_log"?\s*\(id\)/i)
    expect(tableSql()).not.toContain('activity_log_v2')
    expect(all<Array<{ name: string }>>("select name from sqlite_master where tbl_name = 'activity_log' and type in ('index', 'trigger') order by name").map(row => row.name))
      .toEqual(['activity_log_archive_only', 'activity_log_no_delete', 'activity_log_op_fixed', 'idx_activity_log_at'])

    // 只能新增的規則仍在
    expect(() => run('delete from activity_log where id = 1')).toThrow('ACTIVITY_LOG_APPEND_ONLY')
    expect(() => run("update activity_log set note = 'x' where id = 2")).toThrow('ACTIVITY_LOG_APPEND_ONLY')
    expect(() => run("update activity_log set op_id = 'op-2' where id = 4")).toThrow('ACTIVITY_LOG_APPEND_ONLY')

    // 五種修復（＋改名修連結、大量補號）各寫一筆
    const actions: ScanAction[] = [
      { type: 'assign', path: '知識/新.md', id: 'N-20261124-0930-ab12', kind: 'N' },
      { type: 'renumber', path: '知識/新 1.md', oldId: 'N-20261124-0930-ab12', id: 'N-20261124-0931-bbbb', keptPath: '知識/新.md' },
      { type: 'restore', path: '知識/舊.md', id: 'N-20261001-0800-cccc' },
      { type: 'rename', id: 'N-20261001-0800-dddd', from: '知識/甲.md', to: '知識/乙.md' },
      { type: 'relink', path: '日誌/今天.md', count: 2 },
      { type: 'clock', reason: 'behind' },
      { type: 'held', paths: ['a.md', 'b.md'] },
    ]
    for (const entry of repairActivityEntries(actions).entries) await memory.appendActivity('system', entry, NOW)
    // 舊紀錄仍可被更正（自我參照的外鍵在改名後指向新表）
    await memory.appendActivity('system', { actorId: 'leo', actorRole: 'secretary', action: 'corrected', correctsId: 1, targetLink: 'task:1', source: { kind: 'conversation', ref: 'c1' } }, NOW)
    expect(all('pragma foreign_key_check')).toEqual([])

    // ALMNC-84.7：外部 MCP 顧問（actor=advisor, source=mcp, action=deleted）亦可直接寫入且可篩選
    await memory.appendActivity('system', {
      actorId: 'mcp:Claude Code',
      actorRole: 'advisor',
      action: 'deleted',
      targetLink: `note:${encodeURI('知識/草稿.md')}`,
      source: { kind: 'mcp', ref: 'note_delete' },
    }, NOW)

    // 重新載入（重開 App）：模組重新初始化，不再重建，紀錄都在
    vi.resetModules()
    const reloaded = await import('@/db/agent-memory')
    const repairs = await reloaded.listActivity({ now: NOW, actorId: 'system' })
    expect(repairs.map(entry => parseRepairRef(entry.source.ref)?.kind).sort())
      .toEqual(['assign', 'clock', 'held', 'relink', 'rename', 'renumber', 'restore'])
    expect(repairs.every(entry => entry.actorRole === 'system' && entry.action === 'repaired')).toBe(true)
    expect((await reloaded.listActivity({ now: NOW, actorId: 'mia' })).map(entry => entry.id)).toEqual([3, 2])
    const advisorLogs = await reloaded.listActivity({ now: NOW, actorId: 'mcp:Claude Code' })
    expect(advisorLogs).toHaveLength(1)
    expect(advisorLogs[0]).toMatchObject({ actorRole: 'advisor', action: 'deleted', source: { kind: 'mcp', ref: 'note_delete' } })
    expect((await reloaded.listActivity({ now: NOW, limit: 500 })).length).toBe(LEGACY_ROWS.length - 1 + actions.length + 2)
    expect((await reloaded.listActivityActors()).map(actor => actor.actorId)).toEqual(expect.arrayContaining(['system', 'mcp:Claude Code', 'leo', 'mia', 'scott']))
    expect((await reloaded.listActivityActors())[0]).toMatchObject({ actorId: 'mcp:Claude Code', actorRole: 'advisor' })
  })

  it('upgrades an ALMNC-71 table (system-only) to also allow advisor and mcp entries', async () => {
    sqlite.exec('drop table if exists activity_log')
    sqlite.exec(`create table activity_log (
      id integer primary key,
      at integer not null,
      actor_id text not null check (length(trim(actor_id)) > 0),
      actor_role text not null check (actor_role in ('scott', 'commander', 'expert', 'secretary', 'researcher', 'system')),
      action text not null,
      target_link text not null check (length(trim(target_link)) > 0),
      source_kind text not null check (source_kind in ('conversation', 'proposal', 'system')),
      source_ref text not null check (length(trim(source_ref)) > 0),
      note text not null default '' check (length(note) <= 60),
      corrects_id integer references activity_log(id),
      archived_at integer,
      op_id text default null
    )`)
    run(`insert into activity_log (id, at, actor_id, actor_role, action, target_link, source_kind, source_ref)
      values ($1, $2, $3, $4, $5, $6, $7, $8)`, [1, NOW, 'system', 'system', 'repaired', 'note:a.md', 'system', 'id-scan:assign'])
    expect(needsActivityRebuild(tableSql())).toBe(true)

    vi.resetModules()
    const memory = await import('@/db/agent-memory')
    await memory.appendActivity('system', {
      actorId: 'mcp:Cursor',
      actorRole: 'advisor',
      action: 'created',
      targetLink: 'note:b.md',
      source: { kind: 'mcp', ref: 'note_create' },
    }, NOW)
    expect(needsActivityRebuild(tableSql())).toBe(false)
    const rows = await memory.listActivity({ now: NOW, actorId: 'mcp:Cursor' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorRole: 'advisor', action: 'created', source: { kind: 'mcp', ref: 'note_create' } })
  })

  it('does nothing on a table that already allows system and advisor/mcp entries', async () => {
    const calls: unknown[] = []
    expect(await migrateActivityLog({ select: async <T>(sql: string) => all<T>(sql) }, async statements => { calls.push(statements) })).toBe(false)
    expect(calls).toEqual([])
    expect(needsActivityRebuild(undefined)).toBe(false)
  })
})

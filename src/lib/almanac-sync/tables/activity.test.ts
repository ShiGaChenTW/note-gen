// Fork（almanac ALMNC-85.3）：活動紀錄同步的純函式（設計 5.2 第一層：亂序、重複、更正鏈晚到、時鐘偏移）與 M1 遷移。
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import type { AlmanacSqlDb, SqlValue } from '../sql'
import { AGENT_MEMORY_SCHEMA, migrateActivitySyncColumns, type ActivityMigrationStatement } from '@/lib/agent-memory/schema'
import { createActivityTable, displayOrder, localNumberOfUid, orderActivityForInsert, type ActivitySyncEntry } from './activity'

const entry = (uid: string, at: number, extra: Partial<ActivitySyncEntry> = {}): ActivitySyncEntry => ({
  uid,
  at,
  actorId: 'scott',
  actorRole: 'scott',
  action: 'created',
  targetLink: 'note:a.md',
  source: { kind: 'proposal', ref: 'collect:1:1' },
  note: uid,
  correctsUid: null,
  opId: null,
  device: uid.slice(0, uid.lastIndexOf(':')),
  ...extra,
})

describe('orderActivityForInsert（表格驅動）', () => {
  const cases: Array<{ name: string; input: ActivitySyncEntry[]; expected: string[] }> = [
    {
      name: '亂序：依時間排',
      input: [entry('a:3', 300), entry('a:1', 100), entry('b:1', 200)],
      expected: ['a:1', 'b:1', 'a:3'],
    },
    {
      name: '重複：同一個 uid 只留一筆',
      input: [entry('a:1', 100), entry('a:1', 100), entry('b:1', 200), entry('b:1', 200)],
      expected: ['a:1', 'b:1'],
    },
    {
      name: '同一時間：依裝置、再依那台的本機編號（dev:10 排在 dev:9 後面，不用字串比）',
      input: [entry('a:10', 100), entry('b:1', 100), entry('a:9', 100)],
      expected: ['a:9', 'a:10', 'b:1'],
    },
    {
      name: '時鐘偏移：更正的時間早於被更正的那筆，仍先插被更正的那筆',
      input: [entry('b:2', 50, { action: 'corrected', correctsUid: 'a:1' }), entry('a:1', 100)],
      expected: ['a:1', 'b:2'],
    },
    {
      name: '更正鏈：更正的更正也照順序',
      input: [
        entry('a:3', 10, { action: 'corrected', correctsUid: 'a:2' }),
        entry('a:2', 20, { action: 'corrected', correctsUid: 'a:1' }),
        entry('a:1', 30),
      ],
      expected: ['a:1', 'a:2', 'a:3'],
    },
    {
      name: '被更正的那筆晚到（不在這批）：更正照時間插，不卡住',
      input: [entry('b:2', 200, { action: 'corrected', correctsUid: 'a:1' }), entry('b:1', 100)],
      expected: ['b:1', 'b:2'],
    },
  ]
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(orderActivityForInsert(testCase.input).map(item => item.uid)).toEqual(testCase.expected)
    })
  }

  it('displayOrder：最新的在前', () => {
    expect(displayOrder([entry('a:1', 100), entry('b:1', 300), entry('a:2', 200)]).map(item => item.uid)).toEqual(['b:1', 'a:2', 'a:1'])
  })

  it('localNumberOfUid：裝置編號本身含冒號也拿得到最後一段', () => {
    expect(localNumberOfUid('mac:studio:42')).toBe(42)
  })
})

type Bindings = Record<string, SqlValue>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): { all(bindings: Bindings): unknown[]; run(bindings: Bindings): { changes: number } }
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const bind = (values: SqlValue[] = []) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

function database() {
  const sqlite = new DatabaseSync(':memory:')
  for (const sql of AGENT_MEMORY_SCHEMA) sqlite.exec(sql)
  const db: AlmanacSqlDb = {
    async execute(sql, values) { return sqlite.prepare(sql).run(bind(values)) },
    async select<T>(sql: string, values?: SqlValue[]) { return sqlite.prepare(sql).all(bind(values)) as T },
  }
  const runTransaction = async (statements: ActivityMigrationStatement[]) => {
    sqlite.exec('begin')
    try {
      for (const statement of statements) {
        const result = sqlite.prepare(statement.sql).run(bind(statement.values))
        if (statement.expectedRows !== undefined && result.changes !== statement.expectedRows) throw new Error('ROW_COUNT')
      }
      sqlite.exec('commit')
    } catch (error) {
      sqlite.exec('rollback')
      throw error
    }
  }
  const insert = (note: string, correctsId: number | null = null) => sqlite.prepare(
    `insert into activity_log (at, actor_id, actor_role, action, target_link, source_kind, source_ref, note, corrects_id)
     values (1, 'scott', 'scott', 'created', 'note:a.md', 'proposal', 'p', $1, $2)`,
  ).run(bind([note, correctsId]))
  const rows = () => sqlite.prepare('select id, note, uid, corrects_uid as correctsUid, origin_device as originDevice from activity_log order by id').all({}) as Array<Record<string, unknown>>
  return { sqlite, db, runTransaction, insert, rows }
}

describe('M1：activity_log 加 uid、corrects_uid、origin_device', () => {
  it('以前的紀錄全部補上這台的 uid 與裝置（5A）；更正補 corrects_uid；可以重複呼叫', async () => {
    const { db, runTransaction, insert, rows } = database()
    insert('一')
    insert('更正一', 1)
    expect(await migrateActivitySyncColumns(db as never, runTransaction, 'mac')).toBe(true)
    expect(rows()).toEqual([
      { id: 1, note: '一', uid: 'mac:1', correctsUid: null, originDevice: 'mac' },
      { id: 2, note: '更正一', uid: 'mac:2', correctsUid: 'mac:1', originDevice: 'mac' },
    ])
    expect(await migrateActivitySyncColumns(db as never, runTransaction, 'mac')).toBe(false)
  })

  it('重建後仍只能新增：不能刪、原本的欄位不能改；同步欄位只能從空的補一次', async () => {
    const { sqlite, db, runTransaction, insert } = database()
    insert('一')
    await migrateActivitySyncColumns(db as never, runTransaction, 'mac')
    expect(() => sqlite.exec('delete from activity_log')).toThrow(/ACTIVITY_LOG_APPEND_ONLY/)
    expect(() => sqlite.exec("update activity_log set note = '改'")).toThrow(/ACTIVITY_LOG_APPEND_ONLY/)
    expect(() => sqlite.exec("update activity_log set uid = 'other:1'")).toThrow(/ACTIVITY_LOG_APPEND_ONLY/)
    // 舊版 App 插入的紀錄 uid 是空的：補一次可以，補完也不能改。
    insert('二')
    sqlite.exec("update activity_log set uid = 'mac:2', origin_device = 'mac' where id = 2")
    expect(() => sqlite.exec("update activity_log set origin_device = 'x' where id = 2")).toThrow(/ACTIVITY_LOG_APPEND_ONLY/)
    // 封存照舊可以。
    sqlite.exec('update activity_log set archived_at = 5 where id = 1')
    expect(() => sqlite.exec('update activity_log set archived_at = null where id = 1')).toThrow(/ACTIVITY_LOG_APPEND_ONLY/)
  })

  it('遷移失敗：舊表原封不動（沒有新欄位、紀錄都在）', async () => {
    const { sqlite, db, insert } = database()
    insert('一')
    const failing = async () => { throw new Error('ROW_COUNT') }
    await expect(migrateActivitySyncColumns(db as never, failing, 'mac')).rejects.toThrow('ROW_COUNT')
    const columns = (sqlite.prepare('pragma table_info(activity_log)').all({}) as Array<{ name: string }>).map(column => column.name)
    expect(columns).not.toContain('uid')
    expect(sqlite.prepare('select note from activity_log').all({})).toEqual([{ note: '一' }])
  })

  it('收進來的紀錄：本機另給整數 id、uid 保留；已有的 uid 跳過（不重複）；較新版的動作被限制擋下時跳過那一筆', async () => {
    const { db, runTransaction, rows } = database()
    const table = createActivityTable({ runTransaction })
    const context = { db, deviceId: 'mac', now: () => 1, firstSync: false, libraryScope: '' }
    const incoming = [entry('pc:5', 10), entry('pc:6', 20, { actorRole: 'future-role' })]
    await table.applyRemote(context, incoming)
    await table.applyRemote(context, incoming)
    expect(rows()).toEqual([{ id: 1, note: 'pc:5', uid: 'pc:5', correctsUid: null, originDevice: 'pc' }])
    // 這台自己寫的才上傳。
    expect(await table.readOwn(context)).toEqual([])
  })
})

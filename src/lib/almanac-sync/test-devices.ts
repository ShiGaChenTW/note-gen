// Fork（almanac ALMNC-85.5）：雙裝置模擬的共用測試替身（從 engine.test.ts 抽出，自架與雲端資料夾的雙裝置測試共用）。
// 兩份獨立的 node:sqlite；表用測試替身（demo_items 有修改的表、demo_log 只能新增的表）。只給測試用，App 不會 import。
import { createRequire } from 'node:module'
import { forward } from './merge'
import type { AlmanacSqlDb, SqlValue } from './sql'
import type { AlmanacAppendTable, AlmanacRowsTable } from './tables/registry'

type Bindings = Record<string, SqlValue>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): { all(bindings: Bindings): unknown[]; run(bindings: Bindings): { changes: number } }
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const bind = (values: SqlValue[] = []) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

export function createDevice(deviceId: string) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('create table demo_items (id text primary key, title text not null, status text not null, updated_at integer not null)')
  sqlite.exec('create table demo_log (local_id integer primary key autoincrement, uid text unique, at integer not null, note text not null)')
  const db: AlmanacSqlDb = {
    async execute(sql, values) {
      return sqlite.prepare(sql).run(bind(values))
    },
    async select<T>(sql: string, values?: SqlValue[]) {
      return sqlite.prepare(sql).all(bind(values)) as T
    },
  }
  const run = (sql: string, ...values: SqlValue[]) => sqlite.prepare(sql).run(bind(values))
  const all = <T>(sql: string, ...values: SqlValue[]) => sqlite.prepare(sql).all(bind(values)) as T[]
  return {
    deviceId,
    db,
    put(id: string, title: string, status: string, at: number) {
      run('insert into demo_items (id, title, status, updated_at) values ($1, $2, $3, $4) on conflict(id) do update set title = excluded.title, status = excluded.status, updated_at = excluded.updated_at', id, title, status, at)
    },
    remove(id: string) {
      run('delete from demo_items where id = $1', id)
    },
    items() {
      return Object.fromEntries(all<{ id: string; title: string; status: string }>('select id, title, status from demo_items order by id').map(row => [row.id, { title: row.title, status: row.status }]))
    },
    log(note: string, at: number) {
      const result = run('insert into demo_log (at, note) values ($1, $2)', at, note)
      void result
      const id = all<{ id: number }>('select max(local_id) as id from demo_log')[0].id
      run('update demo_log set uid = $1 where local_id = $2', `${deviceId}:${id}`, id)
    },
    logs() {
      return all<{ uid: string; note: string }>('select uid, note from demo_log order by at, uid').map(row => `${row.uid}=${row.note}`)
    },
    run,
    all,
  }
}

export type Device = ReturnType<typeof createDevice>
export type DemoItem = { title: string; status: string }

export function demoItemsTable(options: { buckets?: boolean; askOnRemoteDelete?: boolean } = {}): AlmanacRowsTable<DemoItem> {
  return {
    kind: 'rows',
    name: 'demo_items',
    layer: 'account',
    storage: options.buckets ? { type: 'buckets', dir: 'demo', count: 4 } : { type: 'file', path: 'demo.json' },
    rules: { status: forward(['todo', 'doing', 'done']) },
    askOnRemoteDelete: options.askOnRemoteDelete,
    async read({ db }) {
      const rows = await db.select<Array<{ id: string; title: string; status: string; updated_at: number }>>('select * from demo_items')
      return Object.fromEntries(rows.map(row => [row.id, { v: { title: row.title, status: row.status }, u: row.updated_at }]))
    },
    async apply({ db, now }, change) {
      for (const [id, value] of Object.entries(change.upserts)) {
        await db.execute(
          'insert into demo_items (id, title, status, updated_at) values ($1, $2, $3, $4) on conflict(id) do update set title = excluded.title, status = excluded.status, updated_at = excluded.updated_at',
          [id, value.title, value.status, now()],
        )
      }
      for (const id of change.deletes) await db.execute('delete from demo_items where id = $1', [id])
    },
  }
}

export type LogEntry = { uid: string; at: number; note: string }
export const demoLogTable: AlmanacAppendTable<LogEntry> = {
  kind: 'append',
  name: 'demo_log',
  layer: 'account',
  dir: 'demo-log',
  async readOwn({ db, deviceId }) {
    return db.select<LogEntry[]>('select uid, at, note from demo_log where uid like $1', [`${deviceId}:%`])
  },
  async applyRemote({ db }, entries) {
    for (const entry of entries) {
      await db.execute('insert into demo_log (uid, at, note) values ($1, $2, $3) on conflict(uid) do nothing', [entry.uid, entry.at, entry.note])
    }
  },
}

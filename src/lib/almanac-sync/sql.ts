// Fork（almanac ALMNC-85.2 骨架）：V3 同步用的最小資料庫介面與本機表（設計 1.3、1.4、M8）。
// 介面跟 @tauri-apps/plugin-sql 的 Database 相容；測試用 node:sqlite 實作，兩台裝置各一份。

export type SqlValue = string | number | null

export interface AlmanacSqlDb {
  execute(sql: string, values?: SqlValue[]): Promise<unknown>
  select<T>(sql: string, values?: SqlValue[]): Promise<T>
}

const initialized = new WeakMap<AlmanacSqlDb, Promise<void>>()

/**
 * M8：同步基準與狀態；M4：別名表。全部是新表（create if not exists），舊版 App 忽略；
 * 刪掉這三張表等於「下次重新做一次首次合併」，不丟資料。
 */
export function initAlmanacSyncTables(db: AlmanacSqlDb): Promise<void> {
  let ready = initialized.get(db)
  if (!ready) {
    ready = (async () => {
      await db.execute(`
        create table if not exists almanac_sync_base (
          scope text not null,
          table_name text not null,
          sync_key text not null,
          field_hashes text not null,
          doc text,
          synced_at integer not null,
          primary key (scope, table_name, sync_key)
        )
      `)
      await db.execute(`
        create table if not exists almanac_sync_state (
          scope text not null,
          path text not null,
          hash text not null,
          version text,
          synced_at integer not null,
          primary key (scope, path)
        )
      `)
      await db.execute(`
        create table if not exists almanac_sync_aliases (
          table_name text not null,
          alias_id text not null,
          canonical_id text not null,
          created_at integer not null,
          primary key (table_name, alias_id)
        )
      `)
    })().catch(error => {
      initialized.delete(db)
      throw error
    })
    initialized.set(db, ready)
  }
  return ready
}

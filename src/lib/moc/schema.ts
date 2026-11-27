// Fork（almanac ALMNC-85.4）：MOC 群組四張表的建表語法（原本各寫在 db/moc-snapshots、moc-positions、scott-pins、proposal-experts）。
// 抽出來讓 V3 同步表（lib/almanac-sync/tables/moc.ts）與雙裝置模擬測試用同一份語法；全部 create if not exists，可重跑。
// M7：moc_positions 加 updated_at（alter add column，純加法，舊版忽略）。

export const MOC_SNAPSHOTS_SCHEMA = `
  create table if not exists moc_snapshots (
    workspace text not null default '',
    path text not null,
    moc_id text,
    content text not null,
    updated_at integer not null,
    primary key (workspace, path)
  )
`

export const MOC_POSITIONS_SCHEMA = `create table if not exists moc_positions (
  workspace text not null, moc_id text not null, positions text not null,
  primary key (workspace, moc_id)
)`

/** M7：沒有 updated_at 時補上（default 0＝不知道何時改的；同步時較晚的贏）。 */
export const MOC_POSITIONS_UPDATED_AT = 'alter table moc_positions add column updated_at integer not null default 0'

export function needsMocPositionsUpdatedAt(columns: ReadonlyArray<{ name: string }>): boolean {
  return !columns.some(column => column.name === 'updated_at')
}

export const SCOTT_PINS_SCHEMA = `
  create table if not exists scott_pins (
    workspace text not null default '',
    pin_key text not null,
    kind text not null,
    moc_id text,
    moc_path text not null default '',
    moc_name text not null default '',
    note_id text,
    note_path text,
    chapter_id text,
    block text,
    op_id text,
    pinned_at integer not null,
    primary key (workspace, pin_key)
  )
`

export const PROPOSAL_EXPERTS_SCHEMA = `
  create table if not exists proposal_experts (
    batch_id text primary key,
    proposal_id text,
    agent_id text not null,
    name text not null,
    domain text not null,
    created_at integer not null,
    removed_at integer
  )
`

interface SchemaDb {
  execute(sql: string, values?: Array<string | number | null>): Promise<unknown>
  select<T>(sql: string, values?: Array<string | number | null>): Promise<T>
}

/** moc_positions：建表＋M7。 */
export async function ensureMocPositionsSchema(db: SchemaDb): Promise<void> {
  await db.execute(MOC_POSITIONS_SCHEMA)
  const columns = await db.select<Array<{ name: string }>>('pragma table_info(moc_positions)')
  if (needsMocPositionsUpdatedAt(columns)) await db.execute(MOC_POSITIONS_UPDATED_AT)
}

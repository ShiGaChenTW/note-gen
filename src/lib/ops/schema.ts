// Fork（almanac ALMNC-69.9 → ALMNC-85.3）：ops 表的建表語法（純字串，db/ops.ts 與 V3 同步的 ops 表共用；測試直接在 node:sqlite 建表）。
// 85.3（設計 2.13）：加兩個同步欄位——origin_device（這筆操作是哪台寫的）、undone_device（哪台按的復原）。
// 都是 alter table add column（純加法，預設 null），舊版 App 忽略；只有第一次開 V3 同步時由同步表補上。

export const OPS_SCHEMA = [
  `create table if not exists ops (
    id text primary key,
    workspace text not null default '',
    at integer not null,
    actor text not null,
    actor_id text,
    kind text not null,
    payload text not null,
    inverse text not null,
    proposal_id text,
    batch_id text,
    base_versions text not null default '{}',
    undone_at integer
  )`,
  'create index if not exists idx_ops_at on ops(at)',
  'create index if not exists idx_ops_batch on ops(batch_id)',
  'create index if not exists idx_ops_workspace_at on ops(workspace, at)',
]

export const OPS_SYNC_COLUMNS = ['origin_device', 'undone_device'] as const

export function missingOpsSyncColumns(columns: ReadonlyArray<{ name: string }>): string[] {
  return OPS_SYNC_COLUMNS.filter(name => !columns.some(column => column.name === name))
}

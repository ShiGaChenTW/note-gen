import { getDb } from './index'

export type PendingSyncDeletionStatus = 'pending' | 'confirmed' | 'rejected'
export type PendingSyncDeletionKind = 'file' | 'folder'

export interface PendingSyncDeletion {
  id: string
  workspaceRoot: string
  platform: string
  path: string
  kind: PendingSyncDeletionKind
  deletedAt: number
  deviceId: string
  status: PendingSyncDeletionStatus
  remoteRef: string | null
  resolvedAt: number | null
  createdAt: number
}

export interface UpsertPendingSyncDeletionInput {
  workspaceRoot: string
  platform: string
  path: string
  kind: PendingSyncDeletionKind
  deletedAt: number
  deviceId?: string
  remoteRef?: string | null
  now?: number
}

interface PendingSyncDeletionRow {
  id: string
  workspace_root: string
  platform: string
  path: string
  kind: PendingSyncDeletionKind
  deleted_at: number
  device_id: string
  status: PendingSyncDeletionStatus
  remote_ref: string | null
  resolved_at: number | null
  created_at: number
}

let initialized = false
let initPromise: Promise<void> | null = null

export function normalizeSyncDeletionPath(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
}

function fromRow(row: PendingSyncDeletionRow): PendingSyncDeletion {
  return {
    id: row.id,
    workspaceRoot: row.workspace_root,
    platform: row.platform,
    path: row.path,
    kind: row.kind,
    deletedAt: Number(row.deleted_at) || 0,
    deviceId: row.device_id || '',
    status: row.status,
    remoteRef: row.remote_ref ?? null,
    resolvedAt: row.resolved_at === null || row.resolved_at === undefined ? null : Number(row.resolved_at),
    createdAt: Number(row.created_at) || 0,
  }
}

export async function initSyncDeletionsDb(): Promise<void> {
  if (initialized) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    const db = await getDb()
    await db.execute(`
      create table if not exists pending_sync_deletions (
        id text primary key,
        workspace_root text not null,
        platform text not null,
        path text not null,
        kind text not null check (kind in ('file', 'folder')),
        deleted_at integer not null,
        device_id text not null default '',
        status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
        remote_ref text default null,
        resolved_at integer default null,
        created_at integer not null,
        unique (workspace_root, platform, path)
      )
    `)
    await db.execute(`
      create index if not exists idx_pending_sync_deletions_status
      on pending_sync_deletions(workspace_root, status, deleted_at desc)
    `)
    initialized = true
  })().catch(error => {
    initPromise = null
    throw error
  })

  return initPromise
}

export async function upsertPendingSyncDeletion(
  input: UpsertPendingSyncDeletionInput,
): Promise<{ createdOrReopened: boolean; item: PendingSyncDeletion }> {
  await initSyncDeletionsDb()
  const db = await getDb()
  const normalizedPath = normalizeSyncDeletionPath(input.path)
  if (!normalizedPath) {
    throw new Error('SYNC_DELETION_PATH_REQUIRED')
  }
  const workspaceRoot = input.workspaceRoot || ''
  const now = input.now ?? Date.now()
  const existingRows = await db.select<PendingSyncDeletionRow[]>(
    `select id, workspace_root, platform, path, kind, deleted_at, device_id, status, remote_ref, resolved_at, created_at
     from pending_sync_deletions
     where workspace_root = $1 and platform = $2 and path = $3
     limit 1`,
    [workspaceRoot, input.platform, normalizedPath],
  )
  const existing = existingRows[0] ? fromRow(existingRows[0]) : null

  if (existing && (existing.status === 'rejected' || existing.status === 'confirmed') && input.deletedAt <= existing.deletedAt) {
    return { createdOrReopened: false, item: existing }
  }

  if (existing) {
    const alreadyPending = existing.status === 'pending'
    await db.execute(
      `update pending_sync_deletions
       set kind = $1, deleted_at = $2, device_id = $3, status = 'pending', remote_ref = $4, resolved_at = null
       where id = $5`,
      [
        input.kind,
        Math.max(existing.deletedAt, input.deletedAt),
        input.deviceId ?? existing.deviceId,
        input.remoteRef ?? existing.remoteRef,
        existing.id,
      ],
    )
    const updated = await getPendingSyncDeletion(existing.id)
    return { createdOrReopened: !alreadyPending, item: updated ?? existing }
  }

  const id = crypto.randomUUID()
  await db.execute(
    `insert into pending_sync_deletions (
       id, workspace_root, platform, path, kind, deleted_at, device_id, status, remote_ref, resolved_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, null, $9)`,
    [
      id,
      workspaceRoot,
      input.platform,
      normalizedPath,
      input.kind,
      input.deletedAt,
      input.deviceId ?? '',
      input.remoteRef ?? null,
      now,
    ],
  )
  const created = await getPendingSyncDeletion(id)
  return {
    createdOrReopened: true,
    item: created ?? {
      id,
      workspaceRoot,
      platform: input.platform,
      path: normalizedPath,
      kind: input.kind,
      deletedAt: input.deletedAt,
      deviceId: input.deviceId ?? '',
      status: 'pending',
      remoteRef: input.remoteRef ?? null,
      resolvedAt: null,
      createdAt: now,
    },
  }
}

export async function listPendingSyncDeletions(options: {
  workspaceRoot?: string
  status?: PendingSyncDeletionStatus | 'all'
} = {}): Promise<PendingSyncDeletion[]> {
  await initSyncDeletionsDb()
  const db = await getDb()
  const status = options.status ?? 'pending'
  const clauses: string[] = []
  const values: unknown[] = []

  if (options.workspaceRoot !== undefined) {
    values.push(options.workspaceRoot)
    clauses.push(`workspace_root = $${values.length}`)
  }
  if (status !== 'all') {
    values.push(status)
    clauses.push(`status = $${values.length}`)
  }

  const whereSql = clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''
  const rows = await db.select<PendingSyncDeletionRow[]>(
    `select id, workspace_root, platform, path, kind, deleted_at, device_id, status, remote_ref, resolved_at, created_at
     from pending_sync_deletions
     ${whereSql}
     order by deleted_at desc, created_at desc`,
    values,
  )
  return rows.map(fromRow)
}

export async function getPendingSyncDeletion(id: string): Promise<PendingSyncDeletion | null> {
  await initSyncDeletionsDb()
  const db = await getDb()
  const rows = await db.select<PendingSyncDeletionRow[]>(
    `select id, workspace_root, platform, path, kind, deleted_at, device_id, status, remote_ref, resolved_at, created_at
     from pending_sync_deletions
     where id = $1
     limit 1`,
    [id],
  )
  return rows[0] ? fromRow(rows[0]) : null
}

export async function findPendingSyncDeletionByPath(
  path: string,
  workspaceRoot?: string,
): Promise<PendingSyncDeletion | null> {
  const normalized = normalizeSyncDeletionPath(path)
  if (!normalized) return null
  const pending = await listPendingSyncDeletions({ workspaceRoot, status: 'pending' })
  return pending.find(item => (
    item.path === normalized
    || (item.kind === 'folder' && normalized.startsWith(`${item.path}/`))
    || item.path.startsWith(`${normalized}/`)
  )) ?? null
}

export async function markPendingSyncDeletionStatus(
  id: string,
  status: Exclude<PendingSyncDeletionStatus, 'pending'>,
  now = Date.now(),
): Promise<void> {
  await initSyncDeletionsDb()
  const db = await getDb()
  await db.execute(
    `update pending_sync_deletions
     set status = $1, resolved_at = $2
     where id = $3`,
    [status, now, id],
  )
}

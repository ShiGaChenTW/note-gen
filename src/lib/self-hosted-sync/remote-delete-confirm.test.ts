import { createRequire } from 'node:module'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

type SqlVal = string | number | null
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): {
    all(bindings: Record<string, SqlVal>): unknown[]
    run(bindings: Record<string, SqlVal>): { changes: number; lastInsertRowid: number | bigint }
  }
  close(): void
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDb
}
const sqlite = new DatabaseSync(':memory:')
const bind = (values: SqlVal[] = []) =>
  Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

const mocks = vi.hoisted(() => ({
  localFiles: new Set<string>(['/vault/Notes/mobile-note.md']),
  emit: vi.fn(),
}))

vi.mock('@/db', () => ({
  getDb: async () => ({
    execute: async (sql: string, values: SqlVal[] = []) => {
      const result = sqlite.prepare(sql).run(bind(values))
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    },
    select: async (sql: string, values: SqlVal[] = []) => sqlite.prepare(sql).all(bind(values)),
  }),
  executeRecordTransaction: async () => undefined,
}))

vi.mock('@/db/index', () => ({
  getDb: async () => ({
    execute: async (sql: string, values: SqlVal[] = []) => {
      const result = sqlite.prepare(sql).run(bind(values))
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    },
    select: async (sql: string, values: SqlVal[] = []) => sqlite.prepare(sql).all(bind(values)),
  }),
  executeRecordTransaction: async () => undefined,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'self_hosted_sha256') return 'hash-same'
    if (cmd === 'self_hosted_delete_file') throw new Error(`should not delete directly: ${JSON.stringify(args)}`)
    if (cmd === 'self_hosted_delete_directory') throw new Error(`should not delete dir directly: ${JSON.stringify(args)}`)
    return null
  }),
}))

vi.mock('@tauri-apps/api/path', () => ({
  join: async (...parts: string[]) => parts.join('/'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: async (p: string) => mocks.localFiles.has(p),
  mkdir: async () => undefined,
  readFile: async () => new Uint8Array(),
  readTextFile: async () => 'same text',
  writeFile: async () => undefined,
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: async () => ({
      get: async (key: string) => {
        if (key === 'primaryBackupMethod') return 'selfHosted'
        return undefined
      },
      set: async () => undefined,
      save: async () => undefined,
    }),
  },
}))

vi.mock('@/lib/workspace', () => ({
  getWorkspacePath: async () => ({ path: '/vault', isCustom: true }),
  getDefaultArticleAbsolutePath: async () => '/vault',
  getFilePathOptions: async (p: string) => ({ path: `/vault/${p}`, baseDir: undefined }),
}))

vi.mock('@/lib/emitter', () => ({
  default: { emit: mocks.emit, on: vi.fn(), off: vi.fn() },
}))

vi.mock('@/lib/sync/workspace-path-moves', () => ({
  getPendingWorkspacePathMoves: async () => [],
  getWorkspacePathMoveContext: async () => '/vault',
}))

afterAll(() => sqlite.close())

describe('Self-hosted sync remote deletion confirmation & no-resurrection guard (ALMNC-84.8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.localFiles.clear()
    mocks.localFiles.add('/vault/Notes/mobile-note.md')
    sqlite.exec(`
      drop table if exists self_hosted_sync_profiles;
      drop table if exists self_hosted_workspace_bindings;
      drop table if exists self_hosted_object_mappings;
      drop table if exists self_hosted_local_changes;
      drop table if exists self_hosted_conflicts;
      drop table if exists pending_sync_deletions;
      create table self_hosted_sync_profiles (
        id text primary key,
        server_url text not null,
        instance_id text,
        account_id text,
        device_id text,
        access_expires_at integer,
        state text not null default 'disconnected',
        insecure_http integer not null default 0,
        domain_toggles text not null default '{}',
        created_at integer not null,
        updated_at integer not null
      );
      create table self_hosted_workspace_bindings (
        workspace_id text primary key,
        profile_id text not null default 'p1',
        workspace_type text not null,
        local_root text,
        binding_state text not null,
        access_mode text not null default 'read-write',
        sync_epoch text default 'epoch-1',
        bootstrap_id text default null,
        created_at integer not null default 1,
        updated_at integer not null default 1
      );
      create table self_hosted_object_mappings (
        workspace_id text not null,
        object_id text not null,
        kind text not null,
        local_identity text,
        relative_path text,
        path_casefold text,
        content_hash text,
        blob_refs text,
        deleted_at integer,
        updated_at integer,
        primary key (workspace_id, object_id)
      );
      create table self_hosted_local_changes (
        id integer primary key autoincrement,
        workspace_id text not null,
        domain text not null,
        local_key text not null,
        operation text not null,
        reason text,
        state text not null default 'pending',
        created_at integer not null,
        updated_at integer not null
      );
      create table self_hosted_conflicts (
        id text primary key,
        workspace_id text not null,
        object_id text not null,
        conflict_type text not null,
        local_snapshot text,
        local_copy_path text,
        state text not null,
        created_at integer not null
      );
      create table pending_sync_deletions (
        id text primary key,
        workspace_root text not null,
        platform text not null,
        path text not null,
        kind text not null,
        deleted_at integer not null,
        device_id text not null default '',
        status text not null default 'pending',
        remote_ref text default null,
        resolved_at integer default null,
        created_at integer not null,
        unique (workspace_root, platform, path)
      );
      insert into self_hosted_sync_profiles values ('p1', 'https://sync.example.com', 'inst-1', 'acc-1', 'dev-1', null, 'connected', 0, '{}', 1, 1);
      insert into self_hosted_workspace_bindings values ('ws-1', 'p1', 'library', '/vault', 'bound', 'read-write', 'epoch-1', null, 1, 1);
      insert into self_hosted_object_mappings values ('ws-1', 'obj-1', 'note', 'file:Notes/mobile-note.md', 'Notes/mobile-note.md', 'notes/mobile-note.md', 'hash-same', '[]', null, 1);
    `)
  })

  it('queues remote delete into pending_sync_deletions instead of deleting, and blocks outbox upsert until resolved', async () => {
    const { applyRemoteDelete } = await import('./runtime')
    const outbox = await import('./outbox')
    const syncDeletionsDb = await import('@/db/sync-deletions')
    const { rejectPendingSyncDeletion } = await import('@/lib/sync/deletion-tombstones')

    await applyRemoteDelete(
      { workspaceId: 'ws-1', workspaceType: 'library', localRoot: '/vault', bindingState: 'bound', profileId: 'p1', keyVersion: 1 } as never,
      'obj-1',
    )

    // Local file is preserved and not directly deleted.
    expect(mocks.localFiles.has('/vault/Notes/mobile-note.md')).toBe(true)
    expect(mocks.emit).toHaveBeenCalledWith('pending-sync-deletions-changed')

    const pending = await syncDeletionsDb.listPendingSyncDeletions({ workspaceRoot: '/vault' })
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      platform: 'selfHosted',
      path: 'Notes/mobile-note.md',
      kind: 'file',
      status: 'pending',
    })

    // While pending decision, accidental local upserts must be blocked from resurrecting the remote file.
    await outbox.enqueueFileSnapshot('Notes/mobile-note.md', 'upsert', 'ws-1')
    const queuedWhilePending = sqlite.prepare('select * from self_hosted_local_changes').all({})
    expect(queuedWhilePending).toHaveLength(0)

    // When Scott rejects remote delete ("保留本機檔案"), status becomes rejected and upsert is enqueued!
    expect(await rejectPendingSyncDeletion(pending[0].id)).toBe(true)
    const afterReject = sqlite.prepare(
      "select operation, local_key from self_hosted_local_changes where domain = 'file'",
    ).all({}) as Array<{ operation: string; local_key: string }>
    expect(afterReject).toHaveLength(1)
    expect(afterReject[0]).toMatchObject({ operation: 'upsert', local_key: 'Notes/mobile-note.md' })
  })
})

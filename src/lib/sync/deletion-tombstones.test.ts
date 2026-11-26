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
  storeData: new Map<string, unknown>([
    ['primaryBackupMethod', 'github'],
    ['deviceId', 'device-b'],
    ['workspacePath', '/vault'],
  ]),
  remoteFiles: new Map<string, Uint8Array>(),
  remoteUploaded: [] as Array<{ path: string; content: string }>,
  localFiles: new Set<string>(['Notes/a.md', 'Archive/sub.md']),
  movedToTrash: [] as Array<{ path: string; options: Record<string, unknown> }>,
  cleanTabsByDeletedFile: vi.fn(async () => undefined),
  cleanTabsByDeletedFolder: vi.fn(async () => undefined),
  removeLocalEntry: vi.fn(() => true),
  loadFileTree: vi.fn(async () => undefined),
  preserveRejectedSelfHostedDelete: vi.fn(async () => undefined),
  emitPendingChanged: vi.fn(),
  s3HeadObject: vi.fn(async () => null),
  webdavHeadObject: vi.fn(async () => null),
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

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: async () => ({
      get: async <T>(key: string) => mocks.storeData.get(key) as T,
      set: async (key: string, value: unknown) => { mocks.storeData.set(key, value) },
      save: async () => undefined,
    }),
  },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (p: string) => mocks.localFiles.has(p) || [...mocks.localFiles].some(f => f.startsWith(`${p}/`)),
  mkdir: async () => undefined,
  readFile: async (p: string) => mocks.localFiles.has(p) ? new TextEncoder().encode(`content:${p}`) : (() => { throw new Error('no such file') })(),
  writeTextFile: async () => undefined,
  remove: async () => undefined,
  stat: async (p: string) => {
    if (!mocks.localFiles.has(p)) throw new Error('no such file')
    return { mtime: new Date(1_700_000_000_000) }
  },
}))

vi.mock('@/lib/workspace', () => ({
  getWorkspacePath: async () => ({ path: '/vault', isCustom: true }),
  getFilePathOptions: async (p: string) => ({ path: p, baseDir: undefined }),
}))

vi.mock('@/lib/sync/remote-library', () => ({
  downloadRemoteBytes: async (path: string) => {
    const val = mocks.remoteFiles.get(path)
    if (!val) throw new Error('無法獲取遠端檔案內容')
    return val
  },
  uploadRemoteText: async (path: string, content: string) => {
    mocks.remoteUploaded.push({ path, content })
    mocks.remoteFiles.set(path, new TextEncoder().encode(content))
    return 'sha-manifest'
  },
}))

vi.mock('@/lib/trash/runtime', () => ({
  moveToAppTrash: async (path: string, options: Record<string, unknown>) => {
    mocks.movedToTrash.push({ path, options })
    mocks.localFiles.delete(path)
    return { id: 'trash-1' }
  },
}))

vi.mock('@/stores/article', () => ({
  default: {
    getState: () => ({
      cleanTabsByDeletedFile: mocks.cleanTabsByDeletedFile,
      cleanTabsByDeletedFolder: mocks.cleanTabsByDeletedFolder,
      removeLocalEntry: mocks.removeLocalEntry,
      loadFileTree: mocks.loadFileTree,
    }),
  },
}))

vi.mock('@/stores/sync', () => ({
  default: {
    getState: () => ({
      removeS3FileEtag: vi.fn(),
      removeWebDAVFileEtag: vi.fn(),
    }),
  },
}))

vi.mock('@/db/vector', () => ({
  deleteVectorDocumentsByFilename: vi.fn(async () => undefined),
  deleteVectorDocumentsByPrefix: vi.fn(async () => undefined),
}))

vi.mock('@/lib/sync/sync-context', () => ({
  getCurrentSyncContext: async () => ({ workspaceKey: '/vault', provider: 'github', repo: 'notes' }),
  getSyncMetadataKey: async (p: string) => p,
}))

vi.mock('@/lib/sync/conflict-resolution', () => ({
  checkFileLock: async () => null,
  detectAndHandleConflict: async () => ({ action: 'keep_local' }),
  mergeSimpleContent: (a: string) => a,
  updateFileSyncTime: async () => undefined,
  cleanupExpiredLocks: async () => undefined,
  getFileSyncStatus: async () => ({}),
  getFileRestoreTime: async () => null,
}))

vi.mock('@/lib/sync/github', () => ({ getFiles: async () => null, getFileCommits: async () => [] }))
vi.mock('@/lib/sync/gitee', () => ({ getFiles: async () => null, getFileCommits: async () => [] }))
vi.mock('@/lib/sync/gitlab', () => ({ getFileContent: async () => null, getFileCommits: async () => null, getGitlabApiBaseUrl: async () => '' }))
vi.mock('@/lib/sync/gitea', () => ({ getFileContent: async () => null, getFileCommits: async () => null, getGiteaApiBaseUrl: async () => '' }))
vi.mock('@/lib/sync/s3', () => ({ s3HeadObject: mocks.s3HeadObject, s3DownloadBytes: async () => null }))
vi.mock('@/lib/sync/webdav', () => ({ webdavHeadObject: mocks.webdavHeadObject, webdavDownloadBytes: async () => null }))
vi.mock('@/lib/sync/cloud-folder', () => ({
  androidCloudFolderWorkspaceDownloadBytes: async () => null,
  androidCloudFolderWorkspaceHead: async () => null,
  supportsCloudFolderWorkspace: () => false,
}))
vi.mock('@/lib/sync/repo-utils', () => ({ getSyncRepoName: async () => 'notes' }))
vi.mock('@/lib/sync/workspace-path-moves', () => ({ retryWorkspacePathMoves: async () => undefined }))
vi.mock('@/lib/emitter', () => ({
  default: {
    emit: (event: string) => {
      if (event === 'pending-sync-deletions-changed') mocks.emitPendingChanged()
    },
    on: vi.fn(),
    off: vi.fn(),
  },
}))

const tombstones = await import('./deletion-tombstones')
const syncDeletionsDb = await import('@/db/sync-deletions')
const autoSync = await import('./auto-sync')

afterAll(() => sqlite.close())

describe('ALMNC-84.8 sync deletion tombstones & no-resurrection guards', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    tombstones.invalidateDeletionTombstoneCache()
    sqlite.exec('drop table if exists pending_sync_deletions')
    // Force table re-creation cleanly via dynamic import or direct SQL matching initSyncDeletionsDb
    sqlite.exec(`
      create table pending_sync_deletions (
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
    mocks.remoteFiles.clear()
    mocks.remoteUploaded.length = 0
    mocks.movedToTrash.length = 0
    mocks.localFiles.clear()
    mocks.localFiles.add('Notes/a.md')
    mocks.localFiles.add('Archive/sub.md')
    mocks.storeData.set('primaryBackupMethod', 'github')
    mocks.storeData.set('deviceId', 'device-b')
  })

  it('merges, prunes after 30 days, and matches both files and deleted ancestor folders', () => {
    const now = 100 * 24 * 60 * 60 * 1000
    const merged = tombstones.mergeDeletionTombstones(
      {
        version: 1,
        entries: [
          { path: 'stale.md', kind: 'file', deletedAt: now - tombstones.TOMBSTONE_TTL_MS - 1, deviceId: 'dev-1' },
          { path: 'Archive/', kind: 'folder', deletedAt: now - 1000, deviceId: 'dev-1' },
        ],
      },
      [{ path: '/Notes/a.md', kind: 'file', deletedAt: now - 500, deviceId: 'dev-1' }],
      now,
    )

    expect(merged.entries.map(e => e.path)).toEqual(['Archive', 'Notes/a.md'])
    expect(tombstones.findMatchingTombstone(merged, 'Archive/sub.md')?.path).toBe('Archive')
    expect(tombstones.findMatchingTombstone(merged, 'Notes/a.md')?.kind).toBe('file')
    expect(tombstones.findMatchingTombstone(merged, 'Notes/b.md')).toBeNull()
  })

  it('prevents push-back resurrection across Git, S3, and WebDAV and enqueues pending deletion', async () => {
    const manifest = {
      version: 1 as const,
      entries: [
        { path: 'Notes/a.md', kind: 'file' as const, deletedAt: 1_700_000_050_000, deviceId: 'device-a' },
      ],
    }
    mocks.remoteFiles.set(tombstones.DELETION_TOMBSTONES_PATH, new TextEncoder().encode(JSON.stringify(manifest)))

    // Git compare
    const gitRes = await autoSync.compareFileVersions('Notes/a.md')
    expect(gitRes.action).toBe('none')
    expect(mocks.emitPendingChanged).toHaveBeenCalledTimes(1)
    expect(await tombstones.isPathBlockedByPendingSyncDeletion('Notes/a.md', '/vault')).toBe(true)

    // S3 compare (fresh pending check on S3 platform)
    sqlite.exec('delete from pending_sync_deletions')
    mocks.storeData.set('primaryBackupMethod', 's3')
    mocks.storeData.set('s3SyncConfig', { bucket: 'b', region: 'r', accessKeyId: 'k', secretAccessKey: 's' })
    const s3Res = await autoSync.compareS3FileVersions('Notes/a.md')
    expect(s3Res.action).toBe('none')
    expect((await syncDeletionsDb.listPendingSyncDeletions({ workspaceRoot: '/vault' }))[0]?.platform).toBe('s3')

    // WebDAV compare (fresh pending check on WebDAV platform)
    sqlite.exec('delete from pending_sync_deletions')
    mocks.storeData.set('primaryBackupMethod', 'webdav')
    mocks.storeData.set('webdavSyncConfig', { url: 'https://dav', username: 'u', password: 'p' })
    const davRes = await autoSync.compareWebDAVFileVersions('Notes/a.md')
    expect(davRes.action).toBe('none')
    expect((await syncDeletionsDb.listPendingSyncDeletions({ workspaceRoot: '/vault' }))[0]?.platform).toBe('webdav')
  })

  it('confirm moves local item to App Trash; reject keeps local item, clears tombstone, and unblocks push', async () => {
    const manifest = {
      version: 1 as const,
      entries: [
        { path: 'Notes/a.md', kind: 'file' as const, deletedAt: 1_700_000_050_000, deviceId: 'device-a' },
        { path: 'Archive', kind: 'folder' as const, deletedAt: 1_700_000_060_000, deviceId: 'device-a' },
      ],
    }
    mocks.remoteFiles.set(tombstones.DELETION_TOMBSTONES_PATH, new TextEncoder().encode(JSON.stringify(manifest)))

    const count = await tombstones.reconcileRemoteDeletionTombstones({ bypassCache: true })
    expect(count).toBe(2)

    const pending = await syncDeletionsDb.listPendingSyncDeletions({ workspaceRoot: '/vault' })
    const fileItem = pending.find(item => item.path === 'Notes/a.md')!
    const folderItem = pending.find(item => item.path === 'Archive')!

    // Confirm file -> moves to App Trash with sync attribution
    expect(await tombstones.confirmPendingSyncDeletion(fileItem.id)).toBe(true)
    expect(mocks.cleanTabsByDeletedFile).toHaveBeenCalledWith('Notes/a.md', '/vault')
    expect(mocks.movedToTrash).toEqual([
      {
        path: 'Notes/a.md',
        options: {
          workspaceRoot: '/vault',
          isDirectory: false,
          deletedBy: 'sync',
          actorRole: 'sync',
          source: 'sync',
        },
      },
    ])

    // Reject folder -> keeps local Archive intact and clears tombstone
    expect(await tombstones.rejectPendingSyncDeletion(folderItem.id)).toBe(true)
    expect(mocks.localFiles.has('Archive/sub.md')).toBe(true)
    expect(await tombstones.isPathBlockedByPendingSyncDeletion('Archive/sub.md', '/vault')).toBe(false)

    // Subsequent compare after reject no longer blocks push (allows user to keep & sync local)
    tombstones.invalidateDeletionTombstoneCache()
    const afterReject = await autoSync.compareFileVersions('Archive/sub.md')
    expect(afterReject.action).toBe('push')
  })
})

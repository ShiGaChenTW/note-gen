import { exists, stat } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'

import { getDb } from '@/db'
import {
  getPendingSyncDeletion,
  listPendingSyncDeletions,
  markPendingSyncDeletionStatus,
  normalizeSyncDeletionPath,
  findPendingSyncDeletionByPath,
  upsertPendingSyncDeletion,
  type PendingSyncDeletion,
} from '@/db/sync-deletions'
import emitter from '@/lib/emitter'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { decodeSyncText } from './file-content'
import { getCurrentSyncContext } from './sync-context'
import type { SyncPlatform } from '@/types/sync'

export const DELETION_TOMBSTONES_PATH = '.almanac/deletions.json'
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CACHE_TTL_MS = 15 * 1000

export interface DeletionTombstoneEntry {
  path: string
  kind: 'file' | 'folder'
  deletedAt: number
  deviceId: string
}

export interface DeletionTombstoneManifest {
  version: 1
  entries: DeletionTombstoneEntry[]
}

let cachedManifest: { key: string; fetchedAt: number; manifest: DeletionTombstoneManifest } | null = null

export function invalidateDeletionTombstoneCache(): void {
  cachedManifest = null
}

export function parseDeletionTombstoneManifest(raw?: string | null): DeletionTombstoneManifest {
  if (!raw || !raw.trim()) return { version: 1, entries: [] }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return { version: 1, entries: [] }
    const entriesRaw = (parsed as { entries?: unknown }).entries
    if (!Array.isArray(entriesRaw)) return { version: 1, entries: [] }

    const entries: DeletionTombstoneEntry[] = []
    for (const item of entriesRaw) {
      if (!item || typeof item !== 'object') continue
      const candidate = item as Record<string, unknown>
      const path = typeof candidate.path === 'string' ? normalizeSyncDeletionPath(candidate.path) : ''
      const kind = candidate.kind === 'folder' ? 'folder' : candidate.kind === 'file' ? 'file' : null
      const deletedAt = typeof candidate.deletedAt === 'number' && Number.isFinite(candidate.deletedAt) ? candidate.deletedAt : 0
      const deviceId = typeof candidate.deviceId === 'string' ? candidate.deviceId : ''
      if (!path || !kind || deletedAt <= 0) continue
      entries.push({ path, kind, deletedAt, deviceId })
    }
    return { version: 1, entries }
  } catch {
    return { version: 1, entries: [] }
  }
}

export function mergeDeletionTombstones(
  existing: DeletionTombstoneManifest,
  additions: DeletionTombstoneEntry[],
  now = Date.now(),
): DeletionTombstoneManifest {
  const byPath = new Map<string, DeletionTombstoneEntry>()
  const addEntry = (entry: DeletionTombstoneEntry) => {
    const path = normalizeSyncDeletionPath(entry.path)
    if (!path || path.startsWith('.')) return
    if (now - entry.deletedAt > TOMBSTONE_TTL_MS) return
    const prev = byPath.get(path)
    if (!prev || entry.deletedAt >= prev.deletedAt) {
      byPath.set(path, { ...entry, path })
    }
  }

  for (const entry of existing.entries) addEntry(entry)
  for (const entry of additions) addEntry(entry)

  return {
    version: 1,
    entries: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
  }
}

export function removeDeletionTombstones(
  existing: DeletionTombstoneManifest,
  paths: string[],
  now = Date.now(),
): DeletionTombstoneManifest {
  const targets = new Set(paths.map(normalizeSyncDeletionPath).filter(Boolean))
  const entries = existing.entries.filter(entry => {
    const normalized = normalizeSyncDeletionPath(entry.path)
    if (now - entry.deletedAt > TOMBSTONE_TTL_MS) return false
    for (const target of targets) {
      if (normalized === target || normalized.startsWith(`${target}/`) || target.startsWith(`${normalized}/`)) {
        return false
      }
    }
    return true
  })
  return { version: 1, entries }
}

export function findMatchingTombstone(
  manifest: DeletionTombstoneManifest,
  relativePath: string,
): DeletionTombstoneEntry | null {
  const normalized = normalizeSyncDeletionPath(relativePath)
  if (!normalized || normalized.startsWith('.')) return null

  let best: DeletionTombstoneEntry | null = null
  for (const entry of manifest.entries) {
    const entryPath = normalizeSyncDeletionPath(entry.path)
    const exactMatch = entryPath === normalized
    const ancestorMatch = entry.kind === 'folder' && normalized.startsWith(`${entryPath}/`)
    if (!exactMatch && !ancestorMatch) continue
    if (!best || entry.deletedAt > best.deletedAt) {
      best = { ...entry, path: entryPath }
    }
  }
  return best
}

export async function getOrCreateSyncDeviceId(): Promise<string> {
  const store = await Store.load('store.json')
  const existing = await store.get<string>('deviceId')
  if (existing && existing.trim()) return existing.trim()
  const generated = crypto.randomUUID()
  await store.set('deviceId', generated)
  await store.save()
  return generated
}

async function resolveCurrentWorkspaceRoot(): Promise<string> {
  try {
    const workspace = await getWorkspacePath()
    return workspace.path || ''
  } catch {
    return ''
  }
}

async function getLocalPathMtimeMs(relativePath: string): Promise<number | null> {
  try {
    const workspace = await getWorkspacePath()
    const pathOptions = await getFilePathOptions(relativePath)
    const info = workspace.isCustom || !pathOptions.baseDir
      ? await stat(pathOptions.path)
      : await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
    return info.mtime ? info.mtime.getTime() : null
  } catch {
    return null
  }
}

async function localPathExists(relativePath: string): Promise<boolean> {
  try {
    const workspace = await getWorkspacePath()
    const pathOptions = await getFilePathOptions(relativePath)
    return workspace.isCustom || !pathOptions.baseDir
      ? await exists(pathOptions.path)
      : await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
  } catch {
    return false
  }
}

export async function readRemoteDeletionTombstones(options: {
  bypassCache?: boolean
  platform?: SyncPlatform
} = {}): Promise<DeletionTombstoneManifest> {
  const store = await Store.load('store.json')
  const platform = (options.platform ?? await store.get<SyncPlatform>('primaryBackupMethod') ?? 'github')
  if (platform === 'local' || platform === 'selfHosted') {
    return { version: 1, entries: [] }
  }

  const workspaceRoot = await resolveCurrentWorkspaceRoot()
  const cacheKey = `${workspaceRoot}\0${platform}`
  if (
    !options.bypassCache
    && cachedManifest
    && cachedManifest.key === cacheKey
    && Date.now() - cachedManifest.fetchedAt < CACHE_TTL_MS
  ) {
    return cachedManifest.manifest
  }

  try {
    const { downloadRemoteBytes } = await import('./remote-library')
    const bytes = await downloadRemoteBytes(DELETION_TOMBSTONES_PATH, 'workspace', platform)
    const text = decodeSyncText(DELETION_TOMBSTONES_PATH, bytes)
    const manifest = parseDeletionTombstoneManifest(text)
    cachedManifest = { key: cacheKey, fetchedAt: Date.now(), manifest }
    return manifest
  } catch {
    const empty: DeletionTombstoneManifest = { version: 1, entries: [] }
    cachedManifest = { key: cacheKey, fetchedAt: Date.now(), manifest: empty }
    return empty
  }
}

export async function recordRemoteDeletionTombstones(
  entries: Array<{ path: string; kind: 'file' | 'folder' }>,
  platform?: SyncPlatform,
): Promise<void> {
  if (entries.length === 0) return
  const store = await Store.load('store.json')
  const resolvedPlatform = platform ?? await store.get<SyncPlatform>('primaryBackupMethod') ?? 'github'
  if (resolvedPlatform === 'local' || resolvedPlatform === 'selfHosted') return

  const cleanEntries = entries
    .map(entry => ({ ...entry, path: normalizeSyncDeletionPath(entry.path) }))
    .filter(entry => Boolean(entry.path) && !entry.path.startsWith('.'))
  if (cleanEntries.length === 0) return

  const deviceId = await getOrCreateSyncDeviceId()
  const now = Date.now()
  const current = await readRemoteDeletionTombstones({ bypassCache: true, platform: resolvedPlatform })
  const next = mergeDeletionTombstones(
    current,
    cleanEntries.map(entry => ({ ...entry, deletedAt: now, deviceId })),
    now,
  )

  const { uploadRemoteText } = await import('./remote-library')
  await uploadRemoteText(
    DELETION_TOMBSTONES_PATH,
    JSON.stringify(next, null, 2),
    'chore(sync): update deletion tombstones',
  )
  const workspaceRoot = await resolveCurrentWorkspaceRoot()
  cachedManifest = { key: `${workspaceRoot}\0${resolvedPlatform}`, fetchedAt: Date.now(), manifest: next }
}

export async function clearRemoteDeletionTombstones(
  paths: string[],
  platform?: SyncPlatform,
): Promise<void> {
  if (paths.length === 0) return
  const store = await Store.load('store.json')
  const resolvedPlatform = platform ?? await store.get<SyncPlatform>('primaryBackupMethod') ?? 'github'
  if (resolvedPlatform === 'local' || resolvedPlatform === 'selfHosted') return

  const current = await readRemoteDeletionTombstones({ bypassCache: true, platform: resolvedPlatform })
  if (current.entries.length === 0) return
  const next = removeDeletionTombstones(current, paths)
  if (next.entries.length === current.entries.length) return

  const { uploadRemoteText } = await import('./remote-library')
  await uploadRemoteText(
    DELETION_TOMBSTONES_PATH,
    JSON.stringify(next, null, 2),
    'chore(sync): clear rejected deletion tombstones',
  )
  const workspaceRoot = await resolveCurrentWorkspaceRoot()
  cachedManifest = { key: `${workspaceRoot}\0${resolvedPlatform}`, fetchedAt: Date.now(), manifest: next }
}

async function shouldBlockLocalPathForTombstone(
  entry: DeletionTombstoneEntry,
  relativePath: string,
  localDeviceId: string,
): Promise<boolean> {
  if (entry.deviceId && entry.deviceId === localDeviceId) {
    const localMtime = await getLocalPathMtimeMs(relativePath)
    if (localMtime !== null && localMtime > entry.deletedAt) {
      return false
    }
  }
  return true
}

/**
 * 檢查遠端墓碑清單：若其他裝置已刪除該路徑且本機仍有檔案，將待確認項目寫入佇列並回傳 true（阻止回推）。
 * 若 Scott 先前已對同一刪除事件選擇「保留本機檔案」且沒有更新的遠端刪除，則回傳 false 允許本機同步。
 */
export async function enqueueTombstoneIfRemoteDeleted(
  path: string,
  platform: string,
  options: { bypassCache?: boolean } = {},
): Promise<boolean> {
  const normalized = normalizeSyncDeletionPath(path)
  if (!normalized || normalized.startsWith('.') || platform === 'local') return false

  const workspaceRoot = await resolveCurrentWorkspaceRoot()
  const existingPending = await findPendingSyncDeletionByPath(normalized, workspaceRoot)
  if (existingPending) return true

  if (platform === 'selfHosted') return false

  const manifest = await readRemoteDeletionTombstones({
    bypassCache: options.bypassCache,
    platform: platform as SyncPlatform,
  })
  const tombstone = findMatchingTombstone(manifest, normalized)
  if (!tombstone) return false

  const localDeviceId = await getOrCreateSyncDeviceId()
  if (!await shouldBlockLocalPathForTombstone(tombstone, normalized, localDeviceId)) {
    return false
  }

  const { createdOrReopened, item } = await upsertPendingSyncDeletion({
    workspaceRoot,
    platform,
    path: tombstone.path,
    kind: tombstone.kind,
    deletedAt: tombstone.deletedAt,
    deviceId: tombstone.deviceId,
  })
  if (createdOrReopened) {
    emitter.emit('pending-sync-deletions-changed')
  }
  return item.status === 'pending'
}

export async function reconcileRemoteDeletionTombstones(options: {
  bypassCache?: boolean
  platform?: SyncPlatform
} = {}): Promise<number> {
  const store = await Store.load('store.json')
  const platform = options.platform ?? await store.get<SyncPlatform>('primaryBackupMethod') ?? 'github'
  if (platform === 'local' || platform === 'selfHosted') return 0

  const manifest = await readRemoteDeletionTombstones({ bypassCache: options.bypassCache ?? true, platform })
  if (manifest.entries.length === 0) return 0

  const workspaceRoot = await resolveCurrentWorkspaceRoot()
  const localDeviceId = await getOrCreateSyncDeviceId()
  let pendingCount = 0
  let emitted = false

  for (const entry of manifest.entries) {
    if (!await localPathExists(entry.path)) continue
    if (!await shouldBlockLocalPathForTombstone(entry, entry.path, localDeviceId)) continue

    const { createdOrReopened, item } = await upsertPendingSyncDeletion({
      workspaceRoot,
      platform,
      path: entry.path,
      kind: entry.kind,
      deletedAt: entry.deletedAt,
      deviceId: entry.deviceId,
    })
    if (item.status === 'pending') pendingCount += 1
    if (createdOrReopened) emitted = true
  }

  if (emitted) {
    emitter.emit('pending-sync-deletions-changed')
  }
  return pendingCount
}

export async function isPathBlockedByPendingSyncDeletion(
  path: string,
  workspaceRoot?: string,
): Promise<boolean> {
  const resolvedRoot = workspaceRoot ?? await resolveCurrentWorkspaceRoot()
  return Boolean(await findPendingSyncDeletionByPath(path, resolvedRoot))
}

async function clearSyncedPathMetadata(path: string, platform: string, isFolder: boolean): Promise<void> {
  try {
    const store = await Store.load('store.json')
    const syncContext = await getCurrentSyncContext()
    const syncedShas = await store.get<Record<string, string>>('syncedFileShas') || {}
    const matchesTarget = (candidate: string) => (
      candidate === path || (isFolder && candidate.startsWith(`${path}/`))
    )

    let changed = false
    for (const key of Object.keys(syncedShas)) {
      let candidatePath = syncContext.workspaceKey === '__default__' ? key : ''
      try {
        const value: unknown = JSON.parse(key)
        if (
          Array.isArray(value)
          && value.length === 4
          && value[0] === syncContext.workspaceKey
          && value[1] === syncContext.provider
          && value[2] === syncContext.repo
          && typeof value[3] === 'string'
        ) {
          candidatePath = value[3]
        } else if (Array.isArray(value)) {
          candidatePath = ''
        }
      } catch {
        // Legacy unscoped path key
      }
      if (candidatePath && matchesTarget(candidatePath)) {
        delete syncedShas[key]
        changed = true
      }
    }
    if (changed) {
      await store.set('syncedFileShas', syncedShas)
      await store.save()
    }

    const { default: useSyncStore } = await import('@/stores/sync')
    if (platform === 's3') useSyncStore.getState().removeS3FileEtag(path)
    if (platform === 'webdav') useSyncStore.getState().removeWebDAVFileEtag(path)
  } catch (error) {
    console.warn('[deletion-tombstones] Failed to clear sync metadata:', error)
  }
}

function parseSelfHostedRemoteRef(
  item: PendingSyncDeletion,
): { workspaceId: string; objectId: string; kind: string } | null {
  if (!item.remoteRef) return null
  try {
    const parsed = JSON.parse(item.remoteRef) as Record<string, unknown>
    if (typeof parsed.workspaceId === 'string' && typeof parsed.objectId === 'string') {
      return {
        workspaceId: parsed.workspaceId,
        objectId: parsed.objectId,
        kind: typeof parsed.kind === 'string' ? parsed.kind : (item.kind === 'folder' ? 'folder' : 'note'),
      }
    }
  } catch {
    // Ignore malformed remoteRef
  }
  return null
}

/**
 * Scott 確認套用遠端刪除：關閉相關分頁、將本機檔案或資料夾移入 App「最近刪除」（30 天可還原）、
 * 更新同步狀態並從待確認清單移除。
 */
export async function confirmPendingSyncDeletion(id: string): Promise<boolean> {
  const item = await getPendingSyncDeletion(id)
  if (!item || item.status !== 'pending') return false

  try {
    const { default: useArticleStore } = await import('@/stores/article')
    const article = useArticleStore.getState()
    if (item.kind === 'folder') {
      await article.cleanTabsByDeletedFolder(item.path, item.workspaceRoot || undefined)
    } else {
      await article.cleanTabsByDeletedFile(item.path, item.workspaceRoot || undefined)
      emitter.emit('editor-file-close', { path: item.path })
    }
  } catch (error) {
    console.warn('[deletion-tombstones] Failed closing tabs before confirming delete:', error)
  }

  const { moveToAppTrash } = await import('@/lib/trash/runtime')
  await moveToAppTrash(item.path, {
    workspaceRoot: item.workspaceRoot || undefined,
    isDirectory: item.kind === 'folder',
    deletedBy: 'sync',
    actorRole: 'sync',
    source: 'sync',
  })

  try {
    const { default: useArticleStore } = await import('@/stores/article')
    const article = useArticleStore.getState()
    if (!article.removeLocalEntry(item.path)) {
      await article.loadFileTree()
    }
  } catch (error) {
    console.warn('[deletion-tombstones] Failed refreshing file tree:', error)
  }

  try {
    const { deleteVectorDocumentsByFilename, deleteVectorDocumentsByPrefix } = await import('@/db/vector')
    if (item.kind === 'folder') {
      await deleteVectorDocumentsByPrefix(item.path)
    } else {
      await deleteVectorDocumentsByFilename(item.path)
    }
  } catch {
    // Best-effort vector cleanup
  }

  await clearSyncedPathMetadata(item.path, item.platform, item.kind === 'folder')

  if (item.platform === 'selfHosted') {
    const ref = parseSelfHostedRemoteRef(item)
    if (ref) {
      const database = await getDb()
      await database.execute(
        `update self_hosted_object_mappings set deleted_at = $1, updated_at = $1
         where workspace_id = $2 and object_id = $3`,
        [Date.now(), ref.workspaceId, ref.objectId],
      )
    }
  }

  await markPendingSyncDeletionStatus(id, 'confirmed')
  emitter.emit('pending-sync-deletions-changed')
  return true
}

/**
 * Scott 拒絕套用遠端刪除：保留本機檔案，並將「保留本機」狀態同步出去。
 */
export async function rejectPendingSyncDeletion(id: string): Promise<boolean> {
  const item = await getPendingSyncDeletion(id)
  if (!item || item.status !== 'pending') return false

  // Unblock pushes first so preserving the local copy can enqueue cleanly.
  await markPendingSyncDeletionStatus(id, 'rejected')

  if (item.platform === 'selfHosted') {
    const ref = parseSelfHostedRemoteRef(item)
    if (ref) {
      const { preserveRejectedSelfHostedDelete } = await import('@/lib/self-hosted-sync/runtime')
      await preserveRejectedSelfHostedDelete(ref.workspaceId, ref.objectId, ref.kind, item.path)
    }
  } else {
    await clearRemoteDeletionTombstones([item.path]).catch(error => {
      console.warn('[deletion-tombstones] Failed clearing remote tombstone after reject:', error)
    })
  }

  emitter.emit('pending-sync-deletions-changed')
  return true
}

export async function confirmAllPendingSyncDeletions(): Promise<number> {
  const items = await listPendingSyncDeletions({ status: 'pending' })
  let count = 0
  for (const item of items) {
    if (await confirmPendingSyncDeletion(item.id)) count += 1
  }
  return count
}

export async function rejectAllPendingSyncDeletions(): Promise<number> {
  const items = await listPendingSyncDeletions({ status: 'pending' })
  let count = 0
  for (const item of items) {
    if (await rejectPendingSyncDeletion(item.id)) count += 1
  }
  return count
}

import { join } from '@tauri-apps/api/path'
import { exists, mkdir, readDir, remove, rename, stat, type BaseDirectory } from '@tauri-apps/plugin-fs'

import { trashDbStore } from '@/db/trash'
import emitter from '@/lib/emitter'
import { getDefaultArticleAbsolutePath, getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import type { Source } from '@/lib/v3-model/source'
import type { RssFeed } from '@/lib/source-import/rss-feeds'
import {
  createTrashService,
  type DbTrashEntityType,
  type MoveFileToTrashInput,
  type RecordDbTrashInput,
  type RestoreTrashResult,
  type TrashEntityHandlers,
  type TrashFs,
  type TrashService,
} from './service'
import type { RestoreConflictStrategy, TrashItem } from './types'

const HOURLY_CHECK_MS = 60 * 60 * 1000
const DAILY_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000

let autoPurgeTimer: ReturnType<typeof setInterval> | null = null
let lastPurgeAt = 0
let purgeInFlight: Promise<void> | null = null

interface ResolvedFsTarget {
  path: string
  baseDir?: BaseDirectory
}

async function resolveFsTarget(relativePath: string, workspaceRoot?: string): Promise<ResolvedFsTarget> {
  if (workspaceRoot) {
    return { path: relativePath ? await join(workspaceRoot, relativePath) : workspaceRoot }
  }
  return getFilePathOptions(relativePath)
}

function createAppTrashFs(workspaceRoot?: string): TrashFs {
  return {
    async exists(relativePath) {
      const target = await resolveFsTarget(relativePath, workspaceRoot)
      return target.baseDir
        ? exists(target.path, { baseDir: target.baseDir })
        : exists(target.path)
    },

    async mkdir(relativePath, options) {
      if (!relativePath) return
      const target = await resolveFsTarget(relativePath, workspaceRoot)
      if (target.baseDir) {
        await mkdir(target.path, { baseDir: target.baseDir, recursive: options?.recursive ?? true })
      } else {
        await mkdir(target.path, { recursive: options?.recursive ?? true })
      }
    },

    async rename(fromRelativePath, toRelativePath) {
      const [fromTarget, toTarget] = await Promise.all([
        resolveFsTarget(fromRelativePath, workspaceRoot),
        resolveFsTarget(toRelativePath, workspaceRoot),
      ])
      if (fromTarget.baseDir && toTarget.baseDir) {
        await rename(fromTarget.path, toTarget.path, {
          oldPathBaseDir: fromTarget.baseDir,
          newPathBaseDir: toTarget.baseDir,
        })
      } else {
        await rename(fromTarget.path, toTarget.path)
      }
    },

    async remove(relativePath, options) {
      const target = await resolveFsTarget(relativePath, workspaceRoot)
      if (target.baseDir) {
        await remove(target.path, { baseDir: target.baseDir, recursive: options?.recursive ?? false })
      } else {
        await remove(target.path, { recursive: options?.recursive ?? false })
      }
    },

    async stat(relativePath) {
      try {
        const target = await resolveFsTarget(relativePath, workspaceRoot)
        const info = target.baseDir
          ? await stat(target.path, { baseDir: target.baseDir })
          : await stat(target.path)
        return {
          size: Number(info.size) || 0,
          isDirectory: Boolean(info.isDirectory),
        }
      } catch {
        return null
      }
    },

    async readDir(relativePath) {
      const target = await resolveFsTarget(relativePath, workspaceRoot)
      const entries = target.baseDir
        ? await readDir(target.path, { baseDir: target.baseDir })
        : await readDir(target.path)
      return entries
        .filter(entry => Boolean(entry.name))
        .map(entry => ({
          name: entry.name,
          isDirectory: Boolean(entry.isDirectory),
          isFile: Boolean(entry.isFile),
        }))
    },
  }
}

function normalizeComparablePath(input: string): string {
  return input.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Canonicalize a workspace root into the persisted `trash_items.workspace` key
 * so default-workspace callers passing `<appDataDir>/article` match callers using `'article'`.
 */
export async function resolveTrashWorkspaceScope(workspaceRoot?: string): Promise<string> {
  const workspace = await getWorkspacePath()
  if (!workspaceRoot) return workspace.path

  const normalized = normalizeComparablePath(workspaceRoot)
  if (!workspace.isCustom) {
    let defaultRoot = ''
    try {
      defaultRoot = normalizeComparablePath(await getDefaultArticleAbsolutePath(''))
    } catch {
      defaultRoot = ''
    }
    if (normalized === 'article' || (defaultRoot && normalized === defaultRoot)) {
      return workspace.path
    }
  } else if (normalized === normalizeComparablePath(workspace.path)) {
    return workspace.path
  }

  return normalized
}

function createAppEntityHandlers(): TrashEntityHandlers {
  return {
    async restoreCanvas(entityId) {
      const { restoreCanvasProject } = await import('@/db/canvases')
      await restoreCanvasProject(entityId)
    },
    async purgeCanvas(entityId) {
      const [{ getCanvasProject, permanentlyDeleteCanvasProject }, { removeCanvasThumbnail }] = await Promise.all([
        import('@/db/canvases'),
        import('@/lib/canvas/thumbnail'),
      ])
      const project = await getCanvasProject(entityId)
      await permanentlyDeleteCanvasProject(entityId)
      if (project?.thumbnailPath) {
        await removeCanvasThumbnail(project.thumbnailPath).catch(() => undefined)
      }
    },

    async restoreMark(entityId) {
      const id = Number(entityId)
      if (!Number.isFinite(id)) return
      const { restoreMark } = await import('@/db/marks')
      await restoreMark(id)
    },
    async purgeMark(entityId) {
      const id = Number(entityId)
      if (!Number.isFinite(id)) return
      const { delMarkForever } = await import('@/db/marks')
      await delMarkForever(id)
    },

    async restoreConversation(entityId) {
      const id = Number(entityId)
      if (!Number.isFinite(id)) return
      const { restoreConversation } = await import('@/db/conversations')
      await restoreConversation(id)
    },
    async purgeConversation(entityId) {
      const id = Number(entityId)
      if (!Number.isFinite(id)) return
      const { permanentlyDeleteConversation } = await import('@/db/conversations')
      await permanentlyDeleteConversation(id)
    },

    async restoreMemory(entityId, item) {
      const { restoreTrashedMemory } = await import('@/db/memories')
      const previousStatus = item.metadata?.previousStatus as 'active' | 'pending' | 'archived' | undefined
      await restoreTrashedMemory(entityId, previousStatus)
    },
    async purgeMemory(entityId) {
      const { permanentlyDeleteMemory } = await import('@/db/memories')
      await permanentlyDeleteMemory(entityId)
    },

    async restoreTag(entityId, item) {
      const meta = item.metadata as {
        name?: string
        isPin?: boolean
        sortOrder?: number
        affectedMarkIds?: number[]
      } | null
      const tagName = meta?.name || item.title
      if (!tagName) return

      const [{ getDb }, { initTagsDb }, { restoreMarks }] = await Promise.all([
        import('@/db'),
        import('@/db/tags'),
        import('@/db/marks'),
      ])
      await initTagsDb()
      const db = await getDb()
      const numericId = Number(entityId)
      const isPin = Boolean(meta?.isPin)
      const sortOrder = Number(meta?.sortOrder) || 0

      let restoredTagId: number | null = null
      const byName = await db.select<Array<{ id: number }>>('select id from tags where name = $1 limit 1', [tagName])
      if (byName[0]) {
        restoredTagId = byName[0].id
      } else if (Number.isInteger(numericId) && numericId > 0) {
        const byId = await db.select<Array<{ id: number }>>('select id from tags where id = $1 limit 1', [numericId])
        if (!byId[0]) {
          await db.execute(
            'insert into tags (id, name, isLocked, isPin, sortOrder) values ($1, $2, 0, $3, $4)',
            [numericId, tagName, isPin, sortOrder]
          )
          restoredTagId = numericId
        }
      }
      if (restoredTagId === null) {
        const result = await db.execute(
          'insert into tags (name, isLocked, isPin, sortOrder) values ($1, 0, $2, $3)',
          [tagName, isPin, sortOrder]
        )
        restoredTagId = result.lastInsertId ?? null
      }

      const affectedMarkIds = Array.isArray(meta?.affectedMarkIds)
        ? meta.affectedMarkIds.filter((id): id is number => Number.isInteger(id))
        : []
      if (affectedMarkIds.length > 0) {
        await restoreMarks(affectedMarkIds)
        if (restoredTagId !== null) {
          const placeholders = affectedMarkIds.map((_, index) => `$${index + 2}`).join(', ')
          await db.execute(
            `update marks set tagId = $1 where id in (${placeholders})`,
            [restoredTagId, ...affectedMarkIds]
          )
        }
      }
    },
    async purgeTag() {
      // Tag row was deleted on soft-trash; nothing left to delete beyond index cleanup.
    },

    async restoreSource(_entityId, item) {
      const source = item.metadata?.source as Source | undefined
      if (!source?.id) return
      const { restoreDeletedSource } = await import('@/db/v3-sources')
      await restoreDeletedSource(source)
    },
    async purgeSource() {
      // Source row was deleted after snapshotting into trash_items.metadata.
    },

    // Fork（almanac ALMNC-85.2）：RSS 訂閱放回原本的位置（救回算一次修改，V3 同步不會被刪除墓碑擋下）。
    async restoreRssFeed(_entityId, item) {
      const feed = item.metadata?.feed as RssFeed | undefined
      if (!feed?.id || typeof feed.url !== 'string') return
      const index = typeof item.metadata?.index === 'number' ? item.metadata.index : Number.MAX_SAFE_INTEGER
      const { default: useRssStore } = await import('@/lib/source-import/rss-store')
      await useRssStore.getState().load()
      await useRssStore.getState().restore(feed, index)
    },
    async purgeRssFeed() {
      // 訂閱確認刪除時已從清單移除，快照只在 trash_items.metadata。
    },
  }
}

export function getAppTrashService(workspaceRoot?: string): TrashService {
  return createTrashService({
    fs: createAppTrashFs(workspaceRoot),
    store: trashDbStore,
    entities: createAppEntityHandlers(),
    getWorkspaceScope: () => resolveTrashWorkspaceScope(workspaceRoot),
    onChange: () => {
      emitter.emit('trash-changed')
    },
  })
}

export async function moveToAppTrash(
  relativePath: string,
  options: Omit<MoveFileToTrashInput, 'relativePath'> & { workspaceRoot?: string } = {},
): Promise<TrashItem | null> {
  const { workspaceRoot, ...rest } = options
  return getAppTrashService(workspaceRoot).moveFileToTrash({
    relativePath,
    ...rest,
  })
}

export async function recordDbTrash(input: RecordDbTrashInput): Promise<TrashItem> {
  return getAppTrashService().recordDbTrash(input)
}

export async function removeDbTrashEntry(entityType: DbTrashEntityType, entityId: string): Promise<void> {
  await getAppTrashService().removeDbEntry(entityType, entityId)
}

export async function listTrashItems(workspace?: string): Promise<TrashItem[]> {
  const scope = await resolveTrashWorkspaceScope(workspace)
  return getAppTrashService().list(scope)
}

export async function restoreTrashItem(
  id: string,
  options?: { conflictStrategy?: RestoreConflictStrategy; workspaceRoot?: string },
): Promise<RestoreTrashResult> {
  return getAppTrashService(options?.workspaceRoot).restoreItem(id, {
    conflictStrategy: options?.conflictStrategy,
  })
}

export async function permanentlyDeleteTrashItem(
  id: string,
  workspaceRoot?: string,
): Promise<boolean> {
  return getAppTrashService(workspaceRoot).permanentlyDeleteItem(id)
}

export async function emptyAppTrash(workspace?: string): Promise<{ deletedCount: number; failedIds: string[] }> {
  const scope = await resolveTrashWorkspaceScope(workspace)
  return getAppTrashService().emptyTrash(scope)
}

export async function purgeExpiredTrash(nowMs?: number): Promise<{ purgedCount: number; failedIds: string[] }> {
  return getAppTrashService().purgeExpired(nowMs)
}

async function runRetentionSweep(): Promise<void> {
  if (purgeInFlight) return purgeInFlight
  purgeInFlight = (async () => {
    lastPurgeAt = Date.now()
    await purgeExpiredTrash().catch(error => console.debug('[trash] expired purge failed', error))
    const { pruneOrganizeHistory } = await import('@/lib/organize/history')
    await pruneOrganizeHistory().catch(error => console.debug('[trash] organize prune failed', error))
    const { opsService } = await import('@/lib/ops/runtime')
    const ops = await opsService().catch(() => null)
    if (ops) {
      await ops.prune().catch(error => console.debug('[trash] ops prune failed', error))
    }
  })().finally(() => {
    purgeInFlight = null
  })
  return purgeInFlight
}

/** Start App Trash + 30-day retention sweep on app startup and daily thereafter. */
export function initTrashAutoPurgeRuntime(): () => void {
  void runRetentionSweep()
  if (!autoPurgeTimer) {
    autoPurgeTimer = setInterval(() => {
      if (Date.now() - lastPurgeAt >= DAILY_PURGE_INTERVAL_MS) {
        void runRetentionSweep()
      }
    }, HOURLY_CHECK_MS)
  }
  return stopTrashAutoPurgeRuntime
}

export function stopTrashAutoPurgeRuntime(): void {
  if (autoPurgeTimer) {
    clearInterval(autoPurgeTimer)
    autoPurgeTimer = null
  }
}

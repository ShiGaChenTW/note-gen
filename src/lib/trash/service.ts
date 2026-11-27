import type { TrashDbStore } from '@/db/trash'
import {
  buildRestoredConflictPath,
  isTrashExcludedPath,
  normalizeTrashRelativePath,
  TRASH_DIR_NAME,
  TRASH_RETENTION_MS,
  type RestoreConflictStrategy,
  type TrashActor,
  type TrashEntityType,
  type TrashItem,
  type TrashSource,
} from './types'

export interface TrashDirEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
}

export interface TrashFsStat {
  size: number
  isDirectory: boolean
}

export interface TrashFs {
  exists(relativePath: string): Promise<boolean>
  mkdir(relativePath: string, options?: { recursive?: boolean }): Promise<void>
  rename(fromRelativePath: string, toRelativePath: string): Promise<void>
  remove(relativePath: string, options?: { recursive?: boolean }): Promise<void>
  stat(relativePath: string): Promise<TrashFsStat | null>
  readDir(relativePath: string): Promise<TrashDirEntry[]>
}

export type DbTrashEntityType = Exclude<TrashEntityType, 'file' | 'folder'>

export interface TrashEntityHandlers {
  restoreCanvas(entityId: string, item: TrashItem): Promise<void>
  purgeCanvas(entityId: string, item: TrashItem): Promise<void>
  restoreMark(entityId: string, item: TrashItem): Promise<void>
  purgeMark(entityId: string, item: TrashItem): Promise<void>
  restoreConversation(entityId: string, item: TrashItem): Promise<void>
  purgeConversation(entityId: string, item: TrashItem): Promise<void>
  restoreMemory(entityId: string, item: TrashItem): Promise<void>
  purgeMemory(entityId: string, item: TrashItem): Promise<void>
  restoreTag(entityId: string, item: TrashItem): Promise<void>
  purgeTag(entityId: string, item: TrashItem): Promise<void>
  restoreSource(entityId: string, item: TrashItem): Promise<void>
  purgeSource(entityId: string, item: TrashItem): Promise<void>
  /** Fork（almanac ALMNC-85.2）：RSS 訂閱（V3 同步確認別台的刪除後進垃圾桶）。沒實作就當成不支援。 */
  restoreRssFeed?(entityId: string, item: TrashItem): Promise<void>
  purgeRssFeed?(entityId: string, item: TrashItem): Promise<void>
  restoreAgent?(entityId: string, item: TrashItem): Promise<void>
  purgeAgent?(entityId: string, item: TrashItem): Promise<void>
}

export interface TrashServiceDeps {
  fs: TrashFs
  store: TrashDbStore
  entities: TrashEntityHandlers
  now?: () => number
  newId?: () => string
  getWorkspaceScope?: () => Promise<string> | string
  onChange?: () => Promise<void> | void
}

export interface MoveFileToTrashInput {
  relativePath: string
  isDirectory?: boolean
  deletedBy?: string
  actorRole?: TrashActor
  source?: TrashSource
  metadata?: Record<string, unknown> | null
}

export interface RecordDbTrashInput {
  entityType: DbTrashEntityType
  entityId: string
  title: string
  deletedBy?: string
  actorRole?: TrashActor
  source?: TrashSource
  sizeBytes?: number
  metadata?: Record<string, unknown> | null
  deletedAt?: number
}

export type RestoreTrashResult =
  | { status: 'restored'; item: TrashItem; restoredPath?: string; renamed?: boolean }
  | { status: 'conflict'; item: TrashItem; existingPath: string }
  | { status: 'missing'; item: TrashItem }
  | { status: 'not-found' }

export interface TrashService {
  moveFileToTrash(input: MoveFileToTrashInput): Promise<TrashItem | null>
  recordDbTrash(input: RecordDbTrashInput): Promise<TrashItem>
  removeDbEntry(entityType: DbTrashEntityType, entityId: string): Promise<void>
  list(workspace?: string): Promise<TrashItem[]>
  restoreItem(id: string, options?: { conflictStrategy?: RestoreConflictStrategy }): Promise<RestoreTrashResult>
  permanentlyDeleteItem(id: string): Promise<boolean>
  emptyTrash(workspace?: string): Promise<{ deletedCount: number; failedIds: string[] }>
  purgeExpired(nowMs?: number): Promise<{ purgedCount: number; failedIds: string[] }>
}

function validateRelativePath(input: string): string {
  const normalized = normalizeTrashRelativePath(input)
  if (!normalized || isTrashExcludedPath(normalized)) {
    throw new Error(`Invalid trash relative path: ${input}`)
  }
  const segments = normalized.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe trash relative path: ${input}`)
  }
  return normalized
}

function basenameOf(relativePath: string): string {
  const index = relativePath.lastIndexOf('/')
  return index >= 0 ? relativePath.slice(index + 1) : relativePath
}

function parentOf(relativePath: string): string {
  const index = relativePath.lastIndexOf('/')
  return index >= 0 ? relativePath.slice(0, index) : ''
}

function containerDirFor(item: Pick<TrashItem, 'id' | 'trashPath'>): string {
  if (item.trashPath) {
    const parent = parentOf(normalizeTrashRelativePath(item.trashPath))
    if (parent.startsWith(`${TRASH_DIR_NAME}/`)) return parent
  }
  return `${TRASH_DIR_NAME}/${item.id}`
}

async function computeSizeBytes(fs: TrashFs, relativePath: string, isDirectory: boolean): Promise<number> {
  if (!isDirectory) {
    try {
      return Math.max(0, (await fs.stat(relativePath))?.size ?? 0)
    } catch {
      return 0
    }
  }

  let total = 0
  const entries = await fs.readDir(relativePath).catch(() => [])
  for (const entry of entries) {
    if (!entry.name) continue
    const childPath = `${relativePath}/${entry.name}`
    total += await computeSizeBytes(fs, childPath, entry.isDirectory)
  }
  return total
}

async function runEntityAction(
  entities: TrashEntityHandlers,
  item: TrashItem,
  action: 'restore' | 'purge',
): Promise<void> {
  switch (item.entityType) {
    case 'canvas':
      return action === 'restore'
        ? entities.restoreCanvas(item.entityId, item)
        : entities.purgeCanvas(item.entityId, item)
    case 'mark':
      return action === 'restore'
        ? entities.restoreMark(item.entityId, item)
        : entities.purgeMark(item.entityId, item)
    case 'conversation':
      return action === 'restore'
        ? entities.restoreConversation(item.entityId, item)
        : entities.purgeConversation(item.entityId, item)
    case 'memory':
      return action === 'restore'
        ? entities.restoreMemory(item.entityId, item)
        : entities.purgeMemory(item.entityId, item)
    case 'tag':
      return action === 'restore'
        ? entities.restoreTag(item.entityId, item)
        : entities.purgeTag(item.entityId, item)
    case 'source':
      return action === 'restore'
        ? entities.restoreSource(item.entityId, item)
        : entities.purgeSource(item.entityId, item)
    case 'rss-feed': {
      const handler = action === 'restore' ? entities.restoreRssFeed : entities.purgeRssFeed
      if (!handler) throw new Error(`Unsupported DB trash entity type: ${item.entityType}`)
      return handler(item.entityId, item)
    }
    case 'agent': {
      const handler = action === 'restore' ? entities.restoreAgent : entities.purgeAgent
      if (!handler) throw new Error(`Unsupported DB trash entity type: ${item.entityType}`)
      return handler(item.entityId, item)
    }
    default:
      throw new Error(`Unsupported DB trash entity type: ${item.entityType}`)
  }
}

export function createTrashService(deps: TrashServiceDeps): TrashService {
  const now = deps.now ?? (() => Date.now())
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const getWorkspaceScope = deps.getWorkspaceScope ?? (() => '')

  async function notifyChanged(): Promise<void> {
    await deps.onChange?.()
  }

  async function findAvailableRestorePath(originalPath: string, isDirectory: boolean): Promise<string> {
    for (let attempt = 1; attempt < 1000; attempt += 1) {
      const candidate = buildRestoredConflictPath(originalPath, isDirectory, attempt)
      if (!await deps.fs.exists(candidate)) {
        return candidate
      }
    }
    throw new Error(`Unable to allocate restored path for ${originalPath}`)
  }

  const service: TrashService = {
    async moveFileToTrash(input) {
      const originalPath = validateRelativePath(input.relativePath)
      if (!await deps.fs.exists(originalPath)) {
        return null
      }

      const info = await deps.fs.stat(originalPath)
      const isDirectory = input.isDirectory ?? info?.isDirectory ?? false
      const sizeBytes = info && !isDirectory
        ? Math.max(0, info.size)
        : await computeSizeBytes(deps.fs, originalPath, isDirectory)

      const id = newId()
      const containerDir = `${TRASH_DIR_NAME}/${id}`
      const title = basenameOf(originalPath)
      const trashPath = `${containerDir}/${title}`
      const deletedAt = now()
      const workspace = await getWorkspaceScope()

      const item: TrashItem = {
        id,
        workspace,
        entityType: isDirectory ? 'folder' : 'file',
        entityId: id,
        title,
        originalPath,
        trashPath,
        deletedBy: input.deletedBy ?? 'scott',
        actorRole: input.actorRole ?? 'scott',
        source: input.source ?? 'file-tree',
        sizeBytes,
        metadata: input.metadata ?? null,
        deletedAt,
        expiresAt: deletedAt + TRASH_RETENTION_MS,
      }

      await deps.fs.mkdir(containerDir, { recursive: true })
      await deps.fs.rename(originalPath, trashPath)

      try {
        await deps.store.insert(item)
      } catch (error) {
        // Never leave a renamed file orphaned without a trash index row.
        await deps.fs.rename(trashPath, originalPath).catch(() => undefined)
        await deps.fs.remove(containerDir, { recursive: true }).catch(() => undefined)
        throw error
      }

      await notifyChanged()
      return item
    },

    async recordDbTrash(input) {
      await deps.store.removeByEntity(input.entityType, input.entityId)
      const deletedAt = input.deletedAt ?? now()
      const item: TrashItem = {
        id: newId(),
        workspace: '',
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
        originalPath: null,
        trashPath: null,
        deletedBy: input.deletedBy ?? 'scott',
        actorRole: input.actorRole ?? 'scott',
        source: input.source ?? 'other',
        sizeBytes: input.sizeBytes ?? 0,
        metadata: input.metadata ?? null,
        deletedAt,
        expiresAt: deletedAt + TRASH_RETENTION_MS,
      }
      await deps.store.insert(item)
      await notifyChanged()
      return item
    },

    async removeDbEntry(entityType, entityId) {
      await deps.store.removeByEntity(entityType, entityId)
      await notifyChanged()
    },

    async list(workspace) {
      return deps.store.list(workspace)
    },

    async restoreItem(id, options = {}) {
      const item = await deps.store.get(id)
      if (!item) return { status: 'not-found' }

      if (item.entityType === 'file' || item.entityType === 'folder') {
        if (!item.originalPath || !item.trashPath || !await deps.fs.exists(item.trashPath)) {
          await deps.store.remove(item.id)
          await notifyChanged()
          return { status: 'missing', item }
        }

        const conflictStrategy = options.conflictStrategy ?? 'rename'
        const isDirectory = item.entityType === 'folder'
        let targetPath = item.originalPath
        let renamed = false
        let swapBackupPath: string | null = null

        if (await deps.fs.exists(targetPath)) {
          if (conflictStrategy === 'error') {
            return { status: 'conflict', item, existingPath: targetPath }
          }
          if (conflictStrategy === 'overwrite') {
            const swapDir = `${TRASH_DIR_NAME}/_swap-${newId()}`
            swapBackupPath = `${swapDir}/${basenameOf(targetPath)}`
            await deps.fs.mkdir(swapDir, { recursive: true })
            await deps.fs.rename(targetPath, swapBackupPath)
          } else {
            targetPath = await findAvailableRestorePath(targetPath, isDirectory)
            renamed = true
          }
        }

        const parent = parentOf(targetPath)
        if (parent) {
          await deps.fs.mkdir(parent, { recursive: true })
        }

        try {
          await deps.fs.rename(item.trashPath, targetPath)
        } catch (error) {
          if (swapBackupPath) {
            await deps.fs.rename(swapBackupPath, item.originalPath).catch(() => undefined)
            await deps.fs.remove(parentOf(swapBackupPath), { recursive: true }).catch(() => undefined)
          }
          throw error
        }

        if (swapBackupPath) {
          await deps.fs.remove(parentOf(swapBackupPath), { recursive: true }).catch(() => undefined)
        }
        await deps.fs.remove(containerDirFor(item), { recursive: true }).catch(() => undefined)
        await deps.store.remove(item.id)
        await notifyChanged()
        return { status: 'restored', item, restoredPath: targetPath, renamed }
      }

      await runEntityAction(deps.entities, item, 'restore')
      await deps.store.remove(item.id)
      await notifyChanged()
      return { status: 'restored', item, renamed: false }
    },

    async permanentlyDeleteItem(id) {
      const item = await deps.store.get(id)
      if (!item) return false

      if (item.entityType === 'file' || item.entityType === 'folder') {
        const containerDir = containerDirFor(item)
        if (await deps.fs.exists(containerDir)) {
          await deps.fs.remove(containerDir, { recursive: true })
        } else if (item.trashPath && await deps.fs.exists(item.trashPath)) {
          await deps.fs.remove(item.trashPath, { recursive: true })
        }
      } else {
        await runEntityAction(deps.entities, item, 'purge')
      }

      await deps.store.remove(item.id)
      await notifyChanged()
      return true
    },

    async emptyTrash(workspace) {
      const items = await deps.store.list(workspace)
      let deletedCount = 0
      const failedIds: string[] = []
      for (const item of items) {
        try {
          if (await service.permanentlyDeleteItem(item.id)) {
            deletedCount += 1
          }
        } catch {
          failedIds.push(item.id)
        }
      }
      return { deletedCount, failedIds }
    },

    async purgeExpired(nowMs) {
      const expired = await deps.store.listExpired(nowMs ?? now())
      let purgedCount = 0
      const failedIds: string[] = []
      for (const item of expired) {
        try {
          if (await service.permanentlyDeleteItem(item.id)) {
            purgedCount += 1
          }
        } catch {
          failedIds.push(item.id)
        }
      }
      return { purgedCount, failedIds }
    },
  }

  return service
}

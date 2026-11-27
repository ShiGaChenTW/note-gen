/** Hidden trash root inside every synced or local vault workspace. */
export const TRASH_DIR_NAME = '.almanac-trash'

/** Unified retention period across App Trash, ops undo, and organize snapshots. */
export const TRASH_RETENTION_DAYS = 30
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export type TrashEntityType =
  | 'file'
  | 'folder'
  | 'canvas'
  | 'mark'
  | 'conversation'
  | 'memory'
  | 'tag'
  | 'source'
  /** Fork（almanac ALMNC-85.2）：別台刪掉、Scott 確認的 RSS 訂閱（快照在 metadata.feed）。 */
  | 'rss-feed'

export type TrashActor = 'scott' | 'partner' | 'advisor' | 'system' | 'sync'

export type TrashSource =
  | 'file-tree'
  | 'workbench-proposal'
  | 'agent-tool'
  | 'mcp'
  | 'canvas-sidebar'
  | 'mark-list'
  | 'chat-header'
  | 'memory-settings'
  | 'tag-delete'
  | 'source-delete'
  | 'organize'
  | 'sync'
  | 'other'

export interface TrashItem {
  id: string
  /** Workspace scope (`''` for DB-level items visible in every vault). */
  workspace: string
  entityType: TrashEntityType
  entityId: string
  title: string
  originalPath: string | null
  trashPath: string | null
  deletedBy: string
  actorRole: TrashActor
  source: TrashSource
  sizeBytes: number
  metadata: Record<string, unknown> | null
  deletedAt: number
  expiresAt: number
}

export type RestoreConflictStrategy = 'rename' | 'overwrite' | 'error'

export function normalizeTrashRelativePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
}

export function isTrashExcludedPath(path: string): boolean {
  const normalized = normalizeTrashRelativePath(path)
  if (!normalized) return false
  return normalized.split('/').some(segment => segment === TRASH_DIR_NAME)
}

export function getTrashRemainingDays(
  item: Pick<TrashItem, 'expiresAt'>,
  now = Date.now(),
): number {
  return Math.max(0, Math.ceil((item.expiresAt - now) / DAY_MS))
}

export function buildRestoredConflictPath(
  originalPath: string,
  isDirectory: boolean,
  attempt: number,
): string {
  const normalized = normalizeTrashRelativePath(originalPath)
  const slashIndex = normalized.lastIndexOf('/')
  const dir = slashIndex >= 0 ? normalized.slice(0, slashIndex) : ''
  const name = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
  const suffix = attempt <= 1 ? ' (restored)' : ` (restored ${attempt})`

  let nextName: string
  if (isDirectory) {
    nextName = `${name}${suffix}`
  } else {
    const dotIndex = name.lastIndexOf('.')
    if (dotIndex > 0) {
      nextName = `${name.slice(0, dotIndex)}${suffix}${name.slice(dotIndex)}`
    } else {
      nextName = `${name}${suffix}`
    }
  }

  return dir ? `${dir}/${nextName}` : nextName
}

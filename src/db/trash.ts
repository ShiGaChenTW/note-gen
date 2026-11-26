// Fork（almanac ALMNC-84.4）：最近刪除索引表（note.db `trash_items`），桌面與手機共用同一套索引與 30 天保留規則。
import { getDb } from './index'
import type { TrashActor, TrashEntityType, TrashItem, TrashSource } from '@/lib/trash/types'

interface TrashRow {
  id: string
  workspace: string
  entityType: string
  entityId: string
  title: string
  originalPath: string | null
  trashPath: string | null
  deletedBy: string
  actorRole: string
  source: string
  sizeBytes: number
  metadata: string | null
  deletedAt: number
  expiresAt: number
}

export interface TrashDbStore {
  insert(item: TrashItem): Promise<void>
  get(id: string): Promise<TrashItem | null>
  findByEntity(entityType: TrashEntityType, entityId: string): Promise<TrashItem | null>
  list(workspace?: string): Promise<TrashItem[]>
  listExpired(now: number): Promise<TrashItem[]>
  remove(id: string): Promise<void>
  removeByEntity(entityType: TrashEntityType, entityId: string): Promise<void>
}

const COLUMNS = `id, workspace, entity_type as entityType, entity_id as entityId, title,
  original_path as originalPath, trash_path as trashPath, deleted_by as deletedBy,
  actor_role as actorRole, source, size_bytes as sizeBytes, metadata,
  deleted_at as deletedAt, expires_at as expiresAt`

let initialized: Promise<void> | null = null

export function initTrashDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists trash_items (
          id text primary key,
          workspace text not null default '',
          entity_type text not null,
          entity_id text not null,
          title text not null,
          original_path text default null,
          trash_path text default null,
          deleted_by text not null default 'scott',
          actor_role text not null default 'scott',
          source text not null default 'other',
          size_bytes integer not null default 0,
          metadata text default null,
          deleted_at integer not null,
          expires_at integer not null
        )
      `)
      await db.execute(
        'create index if not exists idx_trash_items_workspace_deleted on trash_items(workspace, deleted_at desc)'
      )
      await db.execute(
        'create index if not exists idx_trash_items_expires on trash_items(expires_at)'
      )
      await db.execute(
        'create index if not exists idx_trash_items_entity on trash_items(entity_type, entity_id)'
      )
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed legacy metadata instead of failing listing.
  }
  return null
}

function fromRow(row: TrashRow): TrashItem {
  return {
    id: row.id,
    workspace: row.workspace,
    entityType: row.entityType as TrashEntityType,
    entityId: row.entityId,
    title: row.title,
    originalPath: row.originalPath,
    trashPath: row.trashPath,
    deletedBy: row.deletedBy,
    actorRole: row.actorRole as TrashActor,
    source: row.source as TrashSource,
    sizeBytes: Number(row.sizeBytes) || 0,
    metadata: parseMetadata(row.metadata),
    deletedAt: Number(row.deletedAt),
    expiresAt: Number(row.expiresAt),
  }
}

export function createTrashDbStore(): TrashDbStore {
  return {
    async insert(item) {
      await initTrashDb()
      const db = await getDb()
      await db.execute(
        `insert into trash_items (
          id, workspace, entity_type, entity_id, title, original_path, trash_path,
          deleted_by, actor_role, source, size_bytes, metadata, deleted_at, expires_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          item.id,
          item.workspace,
          item.entityType,
          item.entityId,
          item.title,
          item.originalPath,
          item.trashPath,
          item.deletedBy,
          item.actorRole,
          item.source,
          item.sizeBytes,
          item.metadata ? JSON.stringify(item.metadata) : null,
          item.deletedAt,
          item.expiresAt,
        ]
      )
    },

    async get(id) {
      await initTrashDb()
      const db = await getDb()
      const rows = await db.select<TrashRow[]>(
        `select ${COLUMNS} from trash_items where id = $1 limit 1`,
        [id]
      )
      return rows[0] ? fromRow(rows[0]) : null
    },

    async findByEntity(entityType, entityId) {
      await initTrashDb()
      const db = await getDb()
      const rows = await db.select<TrashRow[]>(
        `select ${COLUMNS} from trash_items where entity_type = $1 and entity_id = $2 limit 1`,
        [entityType, entityId]
      )
      return rows[0] ? fromRow(rows[0]) : null
    },

    async list(workspace) {
      await initTrashDb()
      const db = await getDb()
      const rows = workspace !== undefined
        ? await db.select<TrashRow[]>(
            `select ${COLUMNS} from trash_items where workspace = '' or workspace = $1 order by deleted_at desc, rowid desc`,
            [workspace]
          )
        : await db.select<TrashRow[]>(
            `select ${COLUMNS} from trash_items order by deleted_at desc, rowid desc`
          )
      return rows.map(fromRow)
    },

    async listExpired(now) {
      await initTrashDb()
      const db = await getDb()
      const rows = await db.select<TrashRow[]>(
        `select ${COLUMNS} from trash_items where expires_at <= $1 order by deleted_at asc`,
        [now]
      )
      return rows.map(fromRow)
    },

    async remove(id) {
      await initTrashDb()
      const db = await getDb()
      await db.execute('delete from trash_items where id = $1', [id])
    },

    async removeByEntity(entityType, entityId) {
      await initTrashDb()
      const db = await getDb()
      await db.execute(
        'delete from trash_items where entity_type = $1 and entity_id = $2',
        [entityType, entityId]
      )
    },
  }
}

export const trashDbStore: TrashDbStore = createTrashDbStore()

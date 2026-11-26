import { describe, expect, it, vi } from 'vitest'
import { createTrashDbStore } from '@/db/trash'
import type { TrashDbStore } from '@/db/trash'
import { ORGANIZE_HISTORY_RETENTION_MS } from '@/lib/organize/history'
import { UNDO_WINDOW_MS } from '@/lib/ops/types'
import { createTrashService, type TrashDirEntry, type TrashEntityHandlers, type TrashFs } from './service'
import {
  buildRestoredConflictPath,
  getTrashRemainingDays,
  isTrashExcludedPath,
  TRASH_RETENTION_MS,
  type TrashItem,
} from './types'

class MemoryTrashFs implements TrashFs {
  readonly files = new Map<string, string>()
  readonly dirs = new Set<string>([''])

  private norm(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  }

  private ensureParentDirs(path: string): void {
    const parts = path.split('/').slice(0, -1)
    let cur = ''
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part
      this.dirs.add(cur)
    }
  }

  seedFile(path: string, content: string): void {
    const clean = this.norm(path)
    this.ensureParentDirs(clean)
    this.files.set(clean, content)
  }

  seedDir(path: string): void {
    const clean = this.norm(path)
    this.ensureParentDirs(clean)
    this.dirs.add(clean)
  }

  async exists(relativePath: string): Promise<boolean> {
    const clean = this.norm(relativePath)
    return this.files.has(clean) || this.dirs.has(clean)
  }

  async mkdir(relativePath: string): Promise<void> {
    const clean = this.norm(relativePath)
    if (!clean) return
    this.ensureParentDirs(clean)
    this.dirs.add(clean)
  }

  async rename(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const from = this.norm(fromRelativePath)
    const to = this.norm(toRelativePath)
    this.ensureParentDirs(to)
    if (this.files.has(from)) {
      this.files.set(to, this.files.get(from)!)
      this.files.delete(from)
      return
    }
    if (this.dirs.has(from)) {
      const movedDirs = [...this.dirs].filter(dir => dir === from || dir.startsWith(`${from}/`))
      for (const dir of movedDirs) {
        this.dirs.delete(dir)
        this.dirs.add(to + dir.slice(from.length))
      }
      const movedFiles = [...this.files.entries()].filter(([path]) => path.startsWith(`${from}/`))
      for (const [path, content] of movedFiles) {
        this.files.delete(path)
        this.files.set(to + path.slice(from.length), content)
      }
      return
    }
    throw new Error(`Missing source: ${from}`)
  }

  async remove(relativePath: string, options?: { recursive?: boolean }): Promise<void> {
    const clean = this.norm(relativePath)
    if (this.files.delete(clean)) return
    if (options?.recursive && this.dirs.has(clean)) {
      for (const dir of [...this.dirs]) {
        if (dir === clean || dir.startsWith(`${clean}/`)) this.dirs.delete(dir)
      }
      for (const file of [...this.files.keys()]) {
        if (file.startsWith(`${clean}/`)) this.files.delete(file)
      }
    } else {
      this.dirs.delete(clean)
    }
  }

  async stat(relativePath: string) {
    const clean = this.norm(relativePath)
    if (this.files.has(clean)) {
      return { size: Buffer.byteLength(this.files.get(clean)!, 'utf8'), isDirectory: false }
    }
    if (this.dirs.has(clean)) {
      return { size: 0, isDirectory: true }
    }
    return null
  }

  async readDir(relativePath: string): Promise<TrashDirEntry[]> {
    const clean = this.norm(relativePath)
    const prefix = clean ? `${clean}/` : ''
    const seen = new Map<string, TrashDirEntry>()

    for (const dir of this.dirs) {
      if (!dir || (prefix && !dir.startsWith(prefix))) continue
      const rest = dir.slice(prefix.length)
      if (!rest || rest.includes('/')) continue
      seen.set(rest, { name: rest, isDirectory: true, isFile: false })
    }
    for (const file of this.files.keys()) {
      if (prefix && !file.startsWith(prefix)) continue
      const rest = file.slice(prefix.length)
      if (!rest || rest.includes('/')) continue
      seen.set(rest, { name: rest, isDirectory: false, isFile: true })
    }
    return [...seen.values()]
  }
}

class MemoryTrashStore implements TrashDbStore {
  readonly rows = new Map<string, TrashItem>()
  failNextInsert = false

  async insert(item: TrashItem): Promise<void> {
    if (this.failNextInsert) {
      this.failNextInsert = false
      throw new Error('simulated db error')
    }
    this.rows.set(item.id, item)
  }

  async get(id: string): Promise<TrashItem | null> {
    return this.rows.get(id) ?? null
  }

  async findByEntity(entityType: TrashItem['entityType'], entityId: string): Promise<TrashItem | null> {
    return [...this.rows.values()].find(
      row => row.entityType === entityType && row.entityId === entityId
    ) ?? null
  }

  async list(workspace?: string): Promise<TrashItem[]> {
    const all = [...this.rows.values()].sort((a, b) => b.deletedAt - a.deletedAt)
    if (workspace === undefined) return all
    return all.filter(row => row.workspace === '' || row.workspace === workspace)
  }

  async listExpired(now: number): Promise<TrashItem[]> {
    return [...this.rows.values()]
      .filter(row => row.expiresAt <= now)
      .sort((a, b) => a.deletedAt - b.deletedAt)
  }

  async remove(id: string): Promise<void> {
    this.rows.delete(id)
  }

  async removeByEntity(entityType: TrashItem['entityType'], entityId: string): Promise<void> {
    for (const [id, row] of this.rows.entries()) {
      if (row.entityType === entityType && row.entityId === entityId) {
        this.rows.delete(id)
      }
    }
  }
}

function createEntitySpies(): TrashEntityHandlers {
  return {
    restoreCanvas: vi.fn(async () => undefined),
    purgeCanvas: vi.fn(async () => undefined),
    restoreMark: vi.fn(async () => undefined),
    purgeMark: vi.fn(async () => undefined),
    restoreConversation: vi.fn(async () => undefined),
    purgeConversation: vi.fn(async () => undefined),
    restoreMemory: vi.fn(async () => undefined),
    purgeMemory: vi.fn(async () => undefined),
    restoreTag: vi.fn(async () => undefined),
    purgeTag: vi.fn(async () => undefined),
    restoreSource: vi.fn(async () => undefined),
    purgeSource: vi.fn(async () => undefined),
  }
}

function setup(workspace = 'vault-main') {
  const fs = new MemoryTrashFs()
  const store = new MemoryTrashStore()
  const entities = createEntitySpies()
  let seq = 0
  const clock = { now: 1_700_000_000_000 }
  const onChange = vi.fn()

  const service = createTrashService({
    fs,
    store,
    entities,
    now: () => clock.now,
    newId: () => `trash-${++seq}`,
    getWorkspaceScope: () => workspace,
    onChange,
  })

  return { fs, store, entities, clock, service, onChange }
}

describe('Trash Core service (ALMNC-84.4)', () => {
  it('moves files and folders into .almanac-trash/, computes size, and rolls back if DB insert fails', async () => {
    const { fs, store, service } = setup()
    fs.seedFile('notes/hello.md', 'hello world')
    fs.seedFile('folder/a.md', 'aaa')
    fs.seedFile('folder/sub/b.md', 'bbbbb')

    const fileItem = await service.moveFileToTrash({
      relativePath: 'notes/hello.md',
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'file-tree',
    })
    expect(fileItem).toMatchObject({
      id: 'trash-1',
      workspace: 'vault-main',
      entityType: 'file',
      title: 'hello.md',
      originalPath: 'notes/hello.md',
      trashPath: '.almanac-trash/trash-1/hello.md',
      sizeBytes: 11,
    })
    expect(await fs.exists('notes/hello.md')).toBe(false)
    expect(fs.files.get('.almanac-trash/trash-1/hello.md')).toBe('hello world')

    const folderItem = await service.moveFileToTrash({ relativePath: 'folder', isDirectory: true })
    expect(folderItem?.entityType).toBe('folder')
    expect(folderItem?.sizeBytes).toBe(8)
    expect(await fs.exists('folder')).toBe(false)
    expect(fs.files.get('.almanac-trash/trash-2/folder/sub/b.md')).toBe('bbbbb')

    fs.seedFile('notes/rollback.md', 'keep me')
    store.failNextInsert = true
    await expect(service.moveFileToTrash({ relativePath: 'notes/rollback.md' })).rejects.toThrow('simulated db error')
    expect(fs.files.get('notes/rollback.md')).toBe('keep me')
    expect(await fs.exists('.almanac-trash/trash-3')).toBe(false)
  })

  it('handles restore when original path is free vs occupied (rename, error, overwrite)', async () => {
    const { fs, service } = setup()
    fs.seedFile('notes/doc.md', 'old-version')
    const trashed = await service.moveFileToTrash({ relativePath: 'notes/doc.md' })

    // Restores to exact original path when free.
    const cleanRestore = await service.restoreItem(trashed!.id)
    expect(cleanRestore).toMatchObject({ status: 'restored', restoredPath: 'notes/doc.md', renamed: false })
    expect(fs.files.get('notes/doc.md')).toBe('old-version')

    // Re-trash, create replacement at original path -> test error, rename, overwrite.
    const trashedAgain = await service.moveFileToTrash({ relativePath: 'notes/doc.md' })
    fs.seedFile('notes/doc.md', 'newer-version')

    expect(await service.restoreItem(trashedAgain!.id, { conflictStrategy: 'error' })).toMatchObject({
      status: 'conflict',
      existingPath: 'notes/doc.md',
    })

    const renamedRestore = await service.restoreItem(trashedAgain!.id)
    expect(renamedRestore).toMatchObject({
      status: 'restored',
      restoredPath: 'notes/doc (restored).md',
      renamed: true,
    })
    expect(fs.files.get('notes/doc.md')).toBe('newer-version')
    expect(fs.files.get('notes/doc (restored).md')).toBe('old-version')

    // Test overwrite conflict strategy.
    const trashedOverwrite = await service.moveFileToTrash({ relativePath: 'notes/doc (restored).md' })
    fs.seedFile('notes/doc (restored).md', 'will-be-overwritten')
    const overwriteResult = await service.restoreItem(trashedOverwrite!.id, { conflictStrategy: 'overwrite' })
    expect(overwriteResult).toMatchObject({
      status: 'restored',
      restoredPath: 'notes/doc (restored).md',
      renamed: false,
    })
    expect(fs.files.get('notes/doc (restored).md')).toBe('old-version')
  })

  it('tracks, restores, and permanently purges all DB entity types (canvas, mark, conversation, memory, tag, source)', async () => {
    const { service, entities } = setup()
    const kinds = [
      ['canvas', 'c-1', 'My Canvas'],
      ['mark', '42', 'Record 42'],
      ['conversation', '7', 'Chat 7'],
      ['memory', 'mem-1', 'Prefers dark mode'],
      ['tag', '9', 'ProjectTag'],
      ['source', 'src_1', 'Article Source'],
    ] as const

    for (const [entityType, entityId, title] of kinds) {
      await service.recordDbTrash({ entityType, entityId, title })
    }
    expect(await service.list('vault-main')).toHaveLength(6)

    const items = await service.list('vault-main')
    // Restore first 3 types
    for (const entityType of ['canvas', 'mark', 'conversation'] as const) {
      const item = items.find(entry => entry.entityType === entityType)!
      await service.restoreItem(item.id)
    }
    expect(entities.restoreCanvas).toHaveBeenCalledWith('c-1', expect.any(Object))
    expect(entities.restoreMark).toHaveBeenCalledWith('42', expect.any(Object))
    expect(entities.restoreConversation).toHaveBeenCalledWith('7', expect.any(Object))

    // Purge remaining 3 types via emptyTrash
    const emptyResult = await service.emptyTrash('vault-main')
    expect(emptyResult).toEqual({ deletedCount: 3, failedIds: [] })
    expect(entities.purgeMemory).toHaveBeenCalledWith('mem-1', expect.any(Object))
    expect(entities.purgeTag).toHaveBeenCalledWith('9', expect.any(Object))
    expect(entities.purgeSource).toHaveBeenCalledWith('src_1', expect.any(Object))
    expect(await service.list('vault-main')).toHaveLength(0)
  })

  it('auto-purges items older than 30 days and keeps newer items', async () => {
    const { fs, clock, service } = setup()
    fs.seedFile('old.md', 'old')
    await service.moveFileToTrash({ relativePath: 'old.md' })

    clock.now += 5 * 24 * 60 * 60 * 1000
    fs.seedFile('recent.md', 'recent')
    const recentItem = await service.moveFileToTrash({ relativePath: 'recent.md' })

    expect(getTrashRemainingDays(recentItem!, clock.now)).toBe(30)

    // Jump to 30 days + 1ms since old.md was trashed (recent.md still has 5 days left).
    clock.now += 25 * 24 * 60 * 60 * 1000 + 1
    expect(getTrashRemainingDays(recentItem!, clock.now)).toBe(5)

    const purge = await service.purgeExpired()
    expect(purge).toEqual({ purgedCount: 1, failedIds: [] })

    const remaining = await service.list('vault-main')
    expect(remaining.map(item => item.title)).toEqual(['recent.md'])
    expect(await fs.exists('.almanac-trash/trash-1')).toBe(false)
    expect(await fs.exists('.almanac-trash/trash-2/recent.md')).toBe(true)
  })

  it('unifies 30-day retention constants and excludes .almanac-trash paths cleanly', () => {
    expect(TRASH_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(UNDO_WINDOW_MS).toBe(TRASH_RETENTION_MS)
    expect(ORGANIZE_HISTORY_RETENTION_MS).toBe(TRASH_RETENTION_MS)
    expect(isTrashExcludedPath('.almanac-trash/id/note.md')).toBe(true)
    expect(isTrashExcludedPath('notes/.almanac-trash/x.md')).toBe(true)
    expect(isTrashExcludedPath('notes/daily.md')).toBe(false)
    expect(buildRestoredConflictPath('notes/doc.md', false, 2)).toBe('notes/doc (restored 2).md')
    expect(buildRestoredConflictPath('projects/demo', true, 1)).toBe('projects/demo (restored)')
    expect(createTrashDbStore).toBeTypeOf('function')
  })
})

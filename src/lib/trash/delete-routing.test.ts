// Fork（almanac ALMNC-84.5）：驗證檔案樹、夥伴刪除提案、folder_delete、對話、畫布、記錄、標籤、未送出資料源、記憶清理皆改走 App 內「最近刪除」。
import { createRequire } from 'node:module'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Bindings = Record<string, string | number | null>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): {
    all(bindings: Bindings): unknown[]
    run(bindings: Bindings): { changes: number; lastInsertRowid: number | bigint }
  }
  close(): void
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDb
}
const sqlite = new DatabaseSync(':memory:')
const bind = (values: Array<string | number | null | boolean>) =>
  Object.fromEntries(values.map((value, index) => [
    `$${index + 1}`,
    typeof value === 'boolean' ? (value ? 1 : 0) : value,
  ]))

const mocks = vi.hoisted(() => ({
  moveToAppTrash: vi.fn(async (relativePath: string, opts?: Record<string, unknown>) => ({
    id: `trash-${relativePath}`,
    workspace: '/vault',
    entityType: opts?.isDirectory ? 'folder' : 'file',
    entityId: `trash-${relativePath}`,
    title: relativePath.split('/').pop() ?? relativePath,
    originalPath: relativePath,
    trashPath: `.almanac-trash/id/${relativePath}`,
    deletedBy: String(opts?.deletedBy ?? 'scott'),
    actorRole: (opts?.actorRole ?? 'scott') as string,
    source: (opts?.source ?? 'file-tree') as string,
    sizeBytes: 12,
    metadata: null,
    deletedAt: 1000,
    expiresAt: 2000,
  })),
  recordDbTrash: vi.fn(async (input: Record<string, unknown>) => ({
    id: `db-${String(input.entityType)}-${String(input.entityId)}`,
    ...input,
  })),
  removeDbTrashEntry: vi.fn(async () => undefined),
  restoreTrashItem: vi.fn(async () => ({ status: 'restored' })),
  deleteSelfHostedWorkspacePath: vi.fn(async () => false),
  fsRemove: vi.fn(async () => undefined),
  fsExists: vi.fn(async () => true),
  fsReadTextFile: vi.fn(async () => '# Note content'),
  fsWriteTextFile: vi.fn(async () => undefined),
  tauriInvoke: vi.fn(async () => undefined),
  cleanTabsByDeletedFile: vi.fn(async () => undefined),
  cleanTabsByDeletedFolder: vi.fn(async () => undefined),
  removeLocalEntry: vi.fn(() => true),
  loadFileTree: vi.fn(async () => undefined),
  deleteVectorDocumentsByFilename: vi.fn(async () => undefined),
}))

vi.mock('@/db/index', () => ({
  getDb: async () => ({
    execute: async (sql: string, values: Array<string | number | null | boolean> = []) => {
      const result = sqlite.prepare(sql).run(bind(values))
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    },
    select: async (sql: string, values: Array<string | number | null | boolean> = []) =>
      sqlite.prepare(sql).all(bind(values)),
  }),
  executeRecordTransaction: async () => undefined,
}))

vi.mock('@/lib/trash/runtime', () => ({
  moveToAppTrash: mocks.moveToAppTrash,
  recordDbTrash: mocks.recordDbTrash,
  removeDbTrashEntry: mocks.removeDbTrashEntry,
  restoreTrashItem: mocks.restoreTrashItem,
}))

vi.mock('@/lib/self-hosted-sync/files', () => ({
  deleteSelfHostedWorkspacePath: mocks.deleteSelfHostedWorkspacePath,
  writeSelfHostedWorkspaceText: vi.fn(async () => false),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: mocks.fsExists,
  mkdir: vi.fn(async () => undefined),
  readDir: vi.fn(async () => []),
  readTextFile: mocks.fsReadTextFile,
  writeTextFile: mocks.fsWriteTextFile,
  remove: mocks.fsRemove,
  rename: vi.fn(async () => undefined),
  copyFile: vi.fn(async () => undefined),
  stat: vi.fn(async () => ({ size: 10, isDirectory: false })),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.tauriInvoke,
}))

vi.mock('@tauri-apps/api/path', () => ({
  join: async (...parts: string[]) => parts.join('/'),
  appDataDir: async () => '/app-data',
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: async () => ({
      get: async () => undefined,
      set: async () => undefined,
      save: async () => undefined,
    }),
  },
}))

vi.mock('@/stores/article', async () => {
  const { create } = await import('zustand')
  return {
    default: create(() => ({
      activeFilePath: '',
      openTabs: [],
      vectorIndexedFiles: new Map<string, number>(),
      cleanTabsByDeletedFile: mocks.cleanTabsByDeletedFile,
      cleanTabsByDeletedFolder: mocks.cleanTabsByDeletedFolder,
      removeLocalEntry: mocks.removeLocalEntry,
      loadFileTree: mocks.loadFileTree,
      reconcileLocalFile: vi.fn(() => true),
      ensurePathExpanded: vi.fn(async () => undefined),
    })),
  }
})

vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({})) }
})

vi.mock('@/lib/workspace', () => ({
  ensureSafeWorkspaceRelativePath: async (p: string) => p.replace(/^\/+|\/+$/g, ''),
  getWorkspacePath: async () => ({ path: '/vault', isCustom: true }),
  getFilePathOptions: async (p: string) => ({ path: `/vault/${p}`, baseDir: undefined }),
  toWorkspaceRelativePath: async (p: string) => p,
}))

vi.mock('@/lib/files', () => ({
  getAllMarkdownFiles: async () => [],
  collectMarkdownFiles: async () => [{ path: 'docs/a.md' }],
  isLinkedFolder: () => false,
}))

vi.mock('@/db/vector', () => ({
  deleteVectorDocumentsByFilename: mocks.deleteVectorDocumentsByFilename,
  getVectorDocumentsByFilename: async () => [],
  upsertVectorDocument: async () => undefined,
}))

vi.mock('@/lib/editor-deactivation', () => ({
  markEditorPathMutation: vi.fn(),
  prepareActiveEditorDeactivation: vi.fn(() => true),
  prepareActiveEditorDeactivationDurably: vi.fn(async () => true),
  prepareActiveEditorPathMutationDurably: vi.fn(async () => true),
  runEditorPathWriteTransaction: async (
    _path: string,
    fn: (ctx: { hasQueuedSave: () => boolean }) => Promise<boolean>,
  ) => fn({ hasQueuedSave: () => false }),
}))

vi.mock('@/lib/skills/runtime', () => ({
  getSkillWorkspaceIdentity: () => 'ws-1',
}))

vi.mock('@/lib/sync/auto-data-sync-queue', () => ({
  enqueueAutoDataSync: vi.fn(),
}))

vi.mock('@/lib/ai/embedding', () => ({
  fetchEmbedding: vi.fn(async () => null),
  getEmbeddingModelDescriptor: vi.fn(async () => null),
}))

vi.mock('@/lib/knowledge-index', () => ({
  enqueueKnowledgeSourceIndex: vi.fn(),
  removeKnowledgeSourceIndex: vi.fn(async () => undefined),
  reconcileStructuredKnowledgeSources: vi.fn(async () => undefined),
}))

vi.mock('@/lib/tag-sync', () => ({
  normalizeTagBoolean: (value: unknown) => Boolean(value),
  invalidateLocalTagSyncIdentity: vi.fn(async () => undefined),
}))

vi.mock('@/lib/sync/record-assets', () => ({
  getMarkLocalAssetPath: () => null,
  getMarkLocalAssetPaths: () => [],
  queueRecordAssetRemoteDeletions: vi.fn(async () => undefined),
}))

vi.mock('@/lib/record-image-thumbnail', () => ({
  getRecordImageThumbnailPath: vi.fn(async () => null),
}))

vi.mock('@/db/activity', () => ({
  insertActivityEvent: vi.fn(async () => undefined),
  recordCanvasActivity: vi.fn(async () => undefined),
}))

vi.mock('@/lib/moc/app-writes', () => ({
  noteAppWrite: vi.fn(),
}))

const { moveEntryToSystemTrash } = await import('@/app/core/main/file/system-trash')
const { deleteLocalFolderIfExists } = await import('@/app/core/main/file/folder-item/delete-folder-utils')
const { removeNote } = await import('@/lib/daily/note-io')
const { deleteMarkdownFileTool, deleteMarkdownFilesBatchTool } = await import('@/lib/agent/tools/note-tools')
const { deleteFolderTool, deleteFoldersBatchTool } = await import('@/lib/agent/tools/folder-tools')
const { clearMemoriesTool } = await import('@/lib/agent/tools/memory-tools')

vi.mock('@/lib/agent/tool-registry', () => ({
  agentToolRegistry: {
    getTool: (name: string) => {
      if (name === 'note_delete_file') {
        return {
          name: 'note_delete_file',
          execute: async (input: Record<string, unknown>) => {
            const res = await deleteMarkdownFileTool.execute(input)
            return { ok: res.success, data: res.data, message: res.message ?? '', error: res.error }
          },
        }
      }
      return undefined
    },
  },
}))

const { acceptProposal } = await import('@/lib/collect/write')
const { initConversationSyncStateDb } = await import('@/db/conversation-sync-state')
const { initConversationsDb, createConversation, updateConversationTitle, deleteConversation, getAllConversations, permanentlyDeleteConversation } = await import('@/db/conversations')
const { initCanvasesDb, insertCanvasProject, softDeleteCanvasProject, restoreCanvasProject, permanentlyDeleteCanvasProject } = await import('@/db/canvases')
const { initTagsDb, insertTag, delTag } = await import('@/db/tags')
const { insertMark, delMark, deleteMarks, deleteAllMarks, restoreMark } = await import('@/db/marks')
const { initV3SourceDb, addSource, deleteUnsentSource } = await import('@/db/v3-sources')
const { initMemoriesDb, upsertMemory, getAllMemories, reindexPendingMemories } = await import('@/db/memories')

describe('ALMNC-84.5 delete routing to App Trash', () => {
  beforeAll(async () => {
    sqlite.exec(`
      create table chats (
        id integer primary key autoincrement,
        tagId integer not null default 1,
        content text,
        role text,
        type text,
        createdAt integer,
        conversationId integer,
        syncId text,
        syncUpdatedAt integer
      );
      create table marks (
        id integer primary key autoincrement,
        tagId integer not null,
        type text not null,
        content text default null,
        url text default null,
        desc text default null,
        deleted integer default 0,
        createdAt integer,
        sourceId text default null
      );
      create table record_tag_metadata (
        markId integer primary key,
        tagIds text not null,
        updatedAt integer not null default 0
      );
    `)
    await initConversationSyncStateDb()
    await initConversationsDb()
    await initCanvasesDb()
    await initTagsDb()
    await initV3SourceDb()
    await initMemoriesDb()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fsExists.mockResolvedValue(true)
    mocks.fsReadTextFile.mockResolvedValue('# Note content')
    mocks.deleteSelfHostedWorkspacePath.mockResolvedValue(false)
    sqlite.exec(`
      delete from chats;
      delete from conversations;
      delete from canvases;
      delete from marks;
      delete from record_tag_metadata;
      delete from source_outputs;
      delete from sources;
      delete from id_index;
      delete from memories;
      delete from tags where isLocked = 0;
    `)
  })

  afterAll(async () => {
    await reindexPendingMemories().catch(() => undefined)
    sqlite.close()
  })

  it('檔案樹檔案與資料夾刪除改走 moveToAppTrash，不呼叫系統垃圾桶或 plugin-fs remove', async () => {
    await moveEntryToSystemTrash('Notes/hello.md', '/vault', {
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'file-tree',
    })
    await deleteLocalFolderIfExists('Notes/Archive')
    await removeNote('Temp/draft.md')

    expect(mocks.moveToAppTrash).toHaveBeenNthCalledWith(1, 'Notes/hello.md', {
      workspaceRoot: '/vault',
      isDirectory: undefined,
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'file-tree',
    })
    expect(mocks.moveToAppTrash).toHaveBeenNthCalledWith(2, 'Notes/Archive', {
      isDirectory: true,
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'file-tree',
    })
    expect(mocks.moveToAppTrash).toHaveBeenNthCalledWith(3, 'Temp/draft.md', {
      deletedBy: 'scott',
      actorRole: 'scott',
      source: 'other',
    })
    expect(mocks.fsRemove).not.toHaveBeenCalled()
    expect(mocks.tauriInvoke).not.toHaveBeenCalledWith('move_paths_to_trash', expect.anything())
  })

  it('Agent note_delete_file / batch 與 folder_delete / batch 皆改走 moveToAppTrash，並保留 workbench-proposal 來源', async () => {
    await deleteMarkdownFileTool.execute({ filePath: 'Projects/plan.md' })
    await deleteMarkdownFilesBatchTool.execute({ filePaths: ['Projects/a.md', 'Projects/b.md'] })
    await deleteFolderTool.execute({ folderPath: 'docs' })
    await deleteFoldersBatchTool.execute({ folderPaths: ['docs/sub'] })

    await acceptProposal({
      id: 'prop-del-1',
      kind: 'note',
      title: '清理舊檔',
      body: '',
      due: '',
      time: '',
      tags: [],
      sourceIds: [],
      change: {
        kind: 'delete',
        path: 'Projects/stale.md',
        toolName: 'note_delete_file',
        args: { filePath: 'Projects/stale.md' },
        baseContent: '# Note content',
        summary: '刪除過時筆記',
      },
    }, { noteFolder: '10 Inbox' })

    expect(mocks.moveToAppTrash).toHaveBeenCalledWith('Projects/plan.md', {
      deletedBy: 'partner',
      actorRole: 'partner',
      source: 'agent-tool',
    })
    expect(mocks.moveToAppTrash).toHaveBeenCalledWith('Projects/a.md', {
      deletedBy: 'partner',
      actorRole: 'partner',
      source: 'agent-tool',
    })
    expect(mocks.moveToAppTrash).toHaveBeenCalledWith('docs', {
      isDirectory: true,
      deletedBy: 'partner',
      actorRole: 'partner',
      source: 'agent-tool',
    })
    expect(mocks.moveToAppTrash).toHaveBeenCalledWith('docs/sub', {
      isDirectory: true,
      deletedBy: 'partner',
      actorRole: 'partner',
      source: 'agent-tool',
    })
    expect(mocks.moveToAppTrash).toHaveBeenCalledWith('Projects/stale.md', {
      deletedBy: 'partner',
      actorRole: 'partner',
      source: 'workbench-proposal',
    })
    expect(mocks.fsRemove).not.toHaveBeenCalled()
  })

  it('對話、畫布、記錄、標籤、未送出資料源、記憶清零全數軟刪除或快照寫入 trash_items', async () => {
    const convId = await createConversation('專案討論')
    await updateConversationTitle(convId, '專案討論')
    await deleteConversation(convId)
    expect(await getAllConversations()).toHaveLength(0)
    expect(mocks.recordDbTrash).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'conversation',
      entityId: String(convId),
      title: '專案討論',
      source: 'chat-header',
    }))

    await permanentlyDeleteConversation(convId)

    const canvas = (await insertCanvasProject({ id: 'canvas-1', title: '流程圖', canvasType: 'flowchart' }))!
    await softDeleteCanvasProject(canvas.id)
    expect(mocks.recordDbTrash).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'canvas',
      entityId: canvas.id,
      title: '流程圖',
      source: 'canvas-sidebar',
    }))
    await restoreCanvasProject(canvas.id)
    await permanentlyDeleteCanvasProject(canvas.id)
    expect(mocks.removeDbTrashEntry).toHaveBeenCalledWith('canvas', canvas.id)

    const m1 = await insertMark({ tagId: 1, type: 'text', content: '第一則記錄', url: '' })
    const m2 = await insertMark({ tagId: 1, type: 'text', content: '第二則記錄', url: '' })
    await delMark(m1.lastInsertId!)
    await restoreMark(m1.lastInsertId!)
    await deleteMarks([m1.lastInsertId!])
    await deleteAllMarks()
    expect(mocks.recordDbTrash).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'mark',
      entityId: String(m2.lastInsertId!),
      source: 'mark-list',
    }))

    const tagInsert = await insertTag({ name: '工作靈感' })
    const customTagId = Number(tagInsert.lastInsertId)
    const mTagged = await insertMark({ tagId: customTagId, type: 'text', content: '被標籤連帶刪除的記錄', url: '' })
    await delTag(customTagId)
    expect(mocks.recordDbTrash).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'tag',
      entityId: String(customTagId),
      title: '工作靈感',
      source: 'tag-delete',
      metadata: expect.objectContaining({
        name: '工作靈感',
        affectedMarkIds: [mTagged.lastInsertId!],
      }),
    }))

    const src = await addSource({
      id: 'src_fail_1',
      sourceType: 'external',
      kind: 'link',
      content: '擷取失敗的網頁摘要',
      origin: 'https://example.com',
      collector: 'web',
    })
    await deleteUnsentSource(src.id)
    expect(mocks.recordDbTrash).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'source',
      entityId: 'src_fail_1',
      source: 'source-delete',
      metadata: expect.objectContaining({
        source: expect.objectContaining({ id: 'src_fail_1', content: '擷取失敗的網頁摘要' }),
      }),
    }))

    const mem = await upsertMemory({ content: '喜歡條列式報告', category: 'preference' })
    await clearMemoriesTool.execute({})
    expect(await getAllMemories({ includeInactive: true })).toHaveLength(0)
    expect(mocks.recordDbTrash).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'memory',
      entityId: mem.id,
      source: 'agent-tool',
      actorRole: 'partner',
    }))
    expect(mocks.fsRemove).not.toHaveBeenCalled()
  })
})

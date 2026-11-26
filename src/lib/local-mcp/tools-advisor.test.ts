import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const files = new Map<string, string>([
    ['Notes/alpha.md', 'hello alpha'],
    ['Notes/beta.md', 'hello beta'],
  ])
  const articleState = {
    activeFilePath: '',
    fileTree: [],
    cleanTabsByDeletedFile: vi.fn(async () => undefined),
    removeLocalEntry: vi.fn(() => true),
    loadFileTree: vi.fn(async () => undefined),
    addTab: vi.fn(async () => undefined),
  }
  const canvasState = {
    projects: [] as Array<{ id: string; title: string }>,
    deletedProjects: [],
    loadProjects: vi.fn(async () => undefined),
    createProject: vi.fn(async (_type: string, title: string) => ({ id: 'canvas-1', title })),
    openProject: vi.fn(async (id: string) => ({ id, title: 'Canvas' })),
    saveProject: vi.fn(async () => undefined),
    renameProject: vi.fn(async () => undefined),
    deleteProject: vi.fn(async () => 'local' as const),
    restoreProject: vi.fn(async (id: string) => ({ id, title: 'Canvas' })),
  }
  const chatState = {
    currentConversationId: 1,
    createConversation: vi.fn(async () => 42),
    switchConversation: vi.fn(async () => undefined),
    insert: vi.fn(async () => ({ id: 100 })),
    updateConversationTitle: vi.fn(async () => undefined),
    deleteConversation: vi.fn(async () => undefined),
  }
  return {
    files,
    articleState,
    canvasState,
    chatState,
    appendActivity: vi.fn(async () => 1),
    moveEntryToSystemTrash: vi.fn(async (filePath: string) => files.delete(filePath)),
    delMark: vi.fn(async () => ({ rowsAffected: 1 })),
    restoreMark: vi.fn(async () => ({ rowsAffected: 1 })),
    insertMark: vi.fn(async () => ({ lastInsertId: 77, rowsAffected: 1 })),
    updateMark: vi.fn(async () => ({ rowsAffected: 1 })),
    getMarkById: vi.fn(async (id: number) => ({
      id,
      tagId: 1,
      type: 'text',
      content: 'mark content',
      url: '',
      desc: '',
      deleted: 0,
      createdAt: 1,
    })),
    runAgentTool: vi.fn(async (name: string, input: Record<string, unknown>) => {
      if (name === 'note_create_file') {
        const folder = typeof input.folderPath === 'string' && input.folderPath ? `${input.folderPath}/` : ''
        files.set(`${folder}${String(input.fileName)}`, String(input.content ?? ''))
      } else if (name === 'note_update_file') {
        files.set(String(input.filePath), String(input.content ?? ''))
      } else if (name === 'note_copy_file') {
        const src = files.get(String(input.filePath)) ?? ''
        const folder = typeof input.targetFolderPath === 'string' && input.targetFolderPath ? `${input.targetFolderPath}/` : ''
        const base = String(input.newName || String(input.filePath).split('/').pop())
        files.set(`${folder}${base}`, src)
      } else if (name === 'note_move_file') {
        const src = files.get(String(input.filePath)) ?? ''
        files.delete(String(input.filePath))
        const folder = typeof input.targetFolderPath === 'string' && input.targetFolderPath ? `${input.targetFolderPath}/` : ''
        const base = String(input.filePath).split('/').pop()!
        files.set(`${folder}${base}`, src)
      } else if (name === 'note_rename_file') {
        const oldPath = String(input.filePath)
        const src = files.get(oldPath) ?? ''
        files.delete(oldPath)
        const folder = oldPath.includes('/') ? `${oldPath.split('/').slice(0, -1).join('/')}/` : ''
        files.set(`${folder}${String(input.newName)}`, src)
      }
      return { ok: true, message: `${name} ok`, data: { ok: true } }
    }),
  }
})

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async () => false),
  lstat: vi.fn(async () => ({ isSymlink: false })),
  readDir: vi.fn(async () => []),
  readTextFile: vi.fn(async (p: string) => {
    const val = mocks.files.get(p)
    if (val === undefined) throw new Error(`not found: ${p}`)
    return val
  }),
}))

vi.mock('@/lib/workspace', () => ({
  ensureSafeWorkspaceRelativePath: vi.fn(async (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '')),
  getFilePathOptions: vi.fn(async (p: string) => ({ path: p })),
  getWorkspacePath: vi.fn(async () => ({ path: '/vault', isCustom: true })),
  isAbsoluteFsPath: vi.fn((p: string) => p.startsWith('/')),
}))

vi.mock('@/app/core/main/file/system-trash', () => ({
  moveEntryToSystemTrash: mocks.moveEntryToSystemTrash,
}))

vi.mock('@/db/agent-memory', () => ({
  appendActivity: mocks.appendActivity,
}))

vi.mock('@/db/marks', () => ({
  delMark: mocks.delMark,
  getAllMarks: vi.fn(async () => []),
  getMarkById: mocks.getMarkById,
  insertMark: mocks.insertMark,
  restoreMark: mocks.restoreMark,
  updateMark: mocks.updateMark,
}))

vi.mock('@/db/tags', () => ({
  getTags: vi.fn(async () => []),
}))

vi.mock('@/db/conversations', () => ({
  getAllConversations: vi.fn(async () => []),
  getConversation: vi.fn(async (id: number) => ({ id, title: `Conv ${id}` })),
}))

vi.mock('@/db/chats', () => ({
  getChatsByConversation: vi.fn(async () => []),
}))

vi.mock('@/db/vector', () => ({
  deleteVectorDocumentsByFilename: vi.fn(async () => undefined),
}))

vi.mock('@/lib/editor-deactivation', () => ({
  prepareActiveEditorPathMutationDurably: vi.fn(async () => true),
}))

vi.mock('@/lib/files', () => ({
  getAllMarkdownFiles: vi.fn(async () => []),
}))

vi.mock('@/lib/knowledge-search', () => ({
  readKnowledgeSourcePage: vi.fn(),
  searchKnowledge: vi.fn(async () => []),
}))

vi.mock('@/lib/agent/editor-adapter', () => ({
  prepareEditorLineTransaction: vi.fn(() => ({ ok: true, markdown: 'patched' })),
}))

vi.mock('@/lib/agent/tools', () => ({
  getToolByName: vi.fn((name: string) => ({
    execute: (input: Record<string, unknown>) => mocks.runAgentTool(name, input),
  })),
}))

vi.mock('@/lib/agent/tools/editor-tools', () => ({
  readCurrentEditorState: vi.fn(async () => ({ markdown: '', wordCount: 0, charCount: 0, totalLines: 1, selection: null })),
}))

vi.mock('@/stores/article', () => ({
  default: { getState: () => mocks.articleState },
}))
vi.mock('@/stores/canvas', () => ({
  default: { getState: () => mocks.canvasState },
}))
vi.mock('@/stores/chat', () => ({
  default: { getState: () => mocks.chatState },
}))
vi.mock('@/stores/mark', () => ({
  default: { getState: () => ({ fetchMarks: vi.fn(async () => {}), fetchAllMarks: vi.fn(async () => {}) }) },
}))
vi.mock('@/stores/tag', () => ({
  default: { getState: () => ({ currentTagId: 1, fetchTags: vi.fn(async () => {}) }) },
}))
vi.mock('./workspace-guard', () => ({
  beginLocalMcpWorkspaceWrite: vi.fn(() => () => {}),
}))

const { executeLocalMcpTool } = await import('./tools')

describe('executeLocalMcpTool advisor activity & trash attribution (ALMNC-84.7)', () => {
  const ctx = { clientName: 'Claude Code', connectionId: 'conn-1', requestId: 'req-1' }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.files.clear()
    mocks.files.set('Notes/alpha.md', 'hello alpha')
    mocks.files.set('Notes/my draft.md', 'hello draft')
  })

  it('logs advisor activity with clientName and mcp source for all write and delete operations', async () => {
    const created = await executeLocalMcpTool('note_create', { filePath: 'Notes/new note.md', content: '# Hi' }, ctx)
    expect(created.isError).toBeUndefined()
    expect(mocks.appendActivity).toHaveBeenLastCalledWith('system', {
      actorId: 'mcp:Claude Code',
      actorRole: 'advisor',
      action: 'created',
      targetLink: 'note:Notes/new%20note.md',
      source: { kind: 'mcp', ref: 'note_create' },
    })

    const read = await executeLocalMcpTool('note_read', { filePath: 'Notes/new note.md' }, ctx)
    expect(read.isError).toBeUndefined()
    // Read-only calls must not write activity entries.
    expect(mocks.appendActivity).toHaveBeenCalledTimes(1)

    const revision = read.structuredContent?.revision as string
    const updated = await executeLocalMcpTool('note_update', {
      filePath: 'Notes/new note.md',
      expectedRevision: revision,
      content: '# Updated',
    }, ctx)
    expect(updated.isError).toBeUndefined()
    expect(mocks.appendActivity).toHaveBeenLastCalledWith('system', {
      actorId: 'mcp:Claude Code',
      actorRole: 'advisor',
      action: 'updated',
      targetLink: 'note:Notes/new%20note.md',
      source: { kind: 'mcp', ref: 'note_update' },
    })

    // Revision mismatch returns conflict and does NOT log activity.
    const callsBeforeConflict = mocks.appendActivity.mock.calls.length
    const conflict = await executeLocalMcpTool('note_update', {
      filePath: 'Notes/new note.md',
      expectedRevision: 'sha256:stale',
      content: '# Bad',
    }, ctx)
    expect(conflict.isError).toBe(true)
    expect(mocks.appendActivity).toHaveBeenCalledTimes(callsBeforeConflict)

    const deleted = await executeLocalMcpTool('note_delete', { filePath: 'Notes/my draft.md' }, ctx)
    expect(deleted.isError).toBeUndefined()
    expect(mocks.moveEntryToSystemTrash).toHaveBeenCalledWith('Notes/my draft.md', undefined, {
      source: 'mcp',
      actorRole: 'advisor',
      deletedBy: 'Claude Code',
    })
    expect(mocks.appendActivity).toHaveBeenLastCalledWith('system', {
      actorId: 'mcp:Claude Code',
      actorRole: 'advisor',
      action: 'deleted',
      targetLink: 'note:Notes/my%20draft.md',
      source: { kind: 'mcp', ref: 'note_delete' },
    })
  })

  it('logs activity and attributes App Trash for record, conversation, and canvas tools', async () => {
    await executeLocalMcpTool('record_create', { tagId: 1, content: 'idea' }, ctx)
    expect(mocks.appendActivity).toHaveBeenLastCalledWith('system', expect.objectContaining({
      actorId: 'mcp:Claude Code',
      actorRole: 'advisor',
      action: 'created',
      targetLink: 'record:77',
      source: { kind: 'mcp', ref: 'record_create' },
    }))

    await executeLocalMcpTool('record_delete', { id: 77 }, ctx)
    expect(mocks.delMark).toHaveBeenCalledWith(77, {
      source: 'mcp',
      actorRole: 'advisor',
      deletedBy: 'Claude Code',
    })
    expect(mocks.appendActivity).toHaveBeenLastCalledWith('system', expect.objectContaining({
      actorRole: 'advisor',
      action: 'deleted',
      targetLink: 'record:77',
      source: { kind: 'mcp', ref: 'record_delete' },
    }))

    await executeLocalMcpTool('conversation_create', { title: 'MCP Chat' }, ctx)
    expect(mocks.appendActivity).toHaveBeenLastCalledWith('system', expect.objectContaining({
      actorRole: 'advisor',
      action: 'created',
      targetLink: 'conversation:42',
      source: { kind: 'mcp', ref: 'conversation_create' },
    }))

    await executeLocalMcpTool('conversation_delete', { id: 42 }, ctx)
    expect(mocks.chatState.deleteConversation).toHaveBeenCalledWith(42, {
      source: 'mcp',
      actorRole: 'advisor',
      deletedBy: 'Claude Code',
    })
    expect(mocks.appendActivity).toHaveBeenLastCalledWith('system', expect.objectContaining({
      actorRole: 'advisor',
      action: 'deleted',
      targetLink: 'conversation:42',
      source: { kind: 'mcp', ref: 'conversation_delete' },
    }))

    await executeLocalMcpTool('canvas_create', { title: 'Diagram A' }, ctx)
    expect(mocks.appendActivity).toHaveBeenLastCalledWith('system', expect.objectContaining({
      actorRole: 'advisor',
      action: 'created',
      targetLink: 'canvas:canvas-1',
      source: { kind: 'mcp', ref: 'canvas_create' },
    }))

    await executeLocalMcpTool('canvas_delete', { canvasId: 'canvas-1' }, ctx)
    expect(mocks.canvasState.deleteProject).toHaveBeenCalledWith('canvas-1', undefined, {
      source: 'mcp',
      actorRole: 'advisor',
      deletedBy: 'Claude Code',
    })
    expect(mocks.appendActivity).toHaveBeenLastCalledWith('system', expect.objectContaining({
      actorRole: 'advisor',
      action: 'deleted',
      targetLink: 'canvas:canvas-1',
      source: { kind: 'mcp', ref: 'canvas_delete' },
    }))
  })
})

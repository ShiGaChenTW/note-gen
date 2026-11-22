import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseV3Note } from '@/lib/v3-model/note'
import type { DeskMaterial } from './desk'

const database = vi.hoisted(() => ({
  createConversation: vi.fn<(title: string) => Promise<number>>().mockResolvedValue(42),
  getConversation: vi.fn<(id: number) => Promise<{ id: number, syncId: string }>>().mockResolvedValue({ id: 42, syncId: 'desk-42' }),
  deleteConversation: vi.fn<(id: number) => Promise<void>>().mockResolvedValue(undefined),
  insertChat: vi.fn<(chat: { conversationId: number, type: string, content: string }) => Promise<{ lastInsertId: number }>>().mockResolvedValue({ lastInsertId: 1 }),
  markCommanderThread: vi.fn<(conversation: unknown) => Promise<void>>().mockResolvedValue(undefined),
}))
const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  removeNote: vi.fn(async (path: string) => { fs.files.delete(path) }),
  commitNoteWrites: vi.fn<(writes: { path: string, before: string, after: string }[], options: unknown) => Promise<void>>().mockResolvedValue(undefined),
  addSourceOutput: vi.fn<(id: string, type: string, path: string) => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/lib/decide/actions', () => ({ acceptDecision: vi.fn(), rejectDecision: vi.fn() }))
vi.mock('@/stores/collect', () => ({ default: {} }))
vi.mock('@/stores/workbench', () => ({ default: {} }))
vi.mock('@/stores/article', () => ({ default: { getState: () => ({ activeFilePath: 'a.md' }) } }))
vi.mock('@/stores/setting', () => ({ default: { getState: () => ({ workspacePath: '/vault' }) } }))
vi.mock('@/stores/tag', () => ({ default: { getState: () => ({ currentTagId: 1 }) } }))
vi.mock('@/stores/threads', () => ({ default: { getState: () => ({ markCommanderThread: database.markCommanderThread }) } }))
vi.mock('@/stores/daily-settings', () => ({ default: { getState: () => ({ inboxFolder: 'Inbox', initSettings: async () => {} }) } }))
vi.mock('@/db/conversations', () => database)
vi.mock('@/db/chats', () => database)
vi.mock('@/db/agents', () => ({
  ensureDefaultRoster: async () => false,
  listAgentSettings: async () => [{ id: 'expert', name: 'Alex', role: 'expert', domain: '工程', enabled: true }],
}))
vi.mock('@/db/v3-domains', () => ({ listDomains: async () => [{ id: 'eng', name: '工程' }] }))
vi.mock('@/db/v3-sources', () => ({
  listOutputsToTarget: async (_type: string, path: string) => path === 'b.md' ? [{ sourceId: 'output-only' }] : [],
  addSourceOutput: fs.addSourceOutput,
}))
vi.mock('@/lib/editor-deactivation', () => ({ prepareActiveEditorPathMutationDurably: async () => true }))
vi.mock('@/lib/daily/coordinated-write', () => ({ commitNoteWrites: fs.commitNoteWrites }))
vi.mock('@/lib/daily/note-io', () => ({
  noteExists: async (path: string) => fs.files.has(path),
  readNote: async (path: string) => fs.files.get(path) ?? null,
  writeNote: async (path: string, content: string, options: { createNew?: boolean }) => {
    if (options.createNew && fs.files.has(path)) throw new Error('EXISTS')
    fs.files.set(path, content)
  },
  removeNote: fs.removeNote,
  revealInFileTree: async () => {},
}))

const { loadDeskMaterials, mergeDeskNotes, startProcessConversation } = await import('./actions')
const materials: DeskMaterial[] = [
  { id: 'a.md', kind: 'note', path: 'a.md', title: 'A', text: '' },
  { id: 'b.md', kind: 'note', path: 'b.md', title: 'B', text: '' },
]

beforeEach(() => {
  vi.clearAllMocks()
  fs.files.clear()
  fs.files.set('a.md', '---\ndomains: [eng]\nsources: [s1]\n---\n第一則')
  fs.files.set('b.md', '第二則')
})

describe('ALMNC-54.22 desk actions', () => {
  it('saves the loaded materials and matching expert in the new processing conversation', async () => {
    const result = await startProcessConversation(await loadDeskMaterials(materials), '檯面筆記')
    expect(result).toMatchObject({ id: 42, experts: [{ id: 'expert' }] })
    expect(database.markCommanderThread).toHaveBeenCalledWith({ id: 42, syncId: 'desk-42' })
    const seed = database.insertChat.mock.calls[0][0]
    expect(seed).toMatchObject({ conversationId: 42, type: 'desk_context' })
    expect(JSON.parse(seed.content)).toEqual({
      materials: [
        { title: 'a', path: 'a.md', text: '第一則', noteSourceIds: ['s1'] },
        { title: 'b', path: 'b.md', text: '第二則', noteSourceIds: [] },
      ],
      expertIds: ['expert'],
    })
  })

  const options = { handTag: '親手寫的', fallbackName: '檯面筆記', reason: '在檯面合併' }
  const draft = { title: '合併筆記', body: '重新整理的內容' }

  it('writes a new note, submits coordinated archive writes and links every source', async () => {
    fs.files.set('Inbox/合併筆記.md', '已存在的筆記')
    const merged = await mergeDeskNotes(draft, await loadDeskMaterials(materials), options)
    expect(merged).toBe('Inbox/合併筆記 2.md')
    expect(fs.files.get('Inbox/合併筆記.md')).toBe('已存在的筆記')
    expect(parseV3Note(fs.files.get(merged)!).fields.sources).toEqual(['s1', 'output-only'])
    const [writes, settings] = fs.commitNoteWrites.mock.calls[0]
    expect(settings).toEqual({ requireExisting: true })
    for (const write of writes) expect(parseV3Note(write.after).fields.status).toBe('archived')
    expect(fs.addSourceOutput.mock.calls).toEqual([['s1', 'note', merged], ['output-only', 'note', merged]])
  })

  it('removes the new note and skips source links if the original notes changed', async () => {
    fs.commitNoteWrites.mockRejectedValueOnce(new Error('CONFLICT'))
    await expect(mergeDeskNotes(draft, await loadDeskMaterials(materials), options)).rejects.toThrow('CONFLICT')
    expect(fs.files.has('Inbox/合併筆記.md')).toBe(false)
    expect(fs.files.get('b.md')).toBe('第二則')
    expect(fs.addSourceOutput).not.toHaveBeenCalled()
  })
})

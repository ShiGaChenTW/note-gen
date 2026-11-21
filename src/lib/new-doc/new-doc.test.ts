// Fork（almanac ALMNC-54.16）：新增文件的命名、去重與標題整理。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Set<string>()
const written: Array<{ path: string, content: string }> = []
const store = {
  activeFilePath: '',
  insertLocalEntry: vi.fn(() => true),
  loadFileTree: vi.fn(async () => {}),
  ensurePathExpanded: vi.fn(async () => {}),
  setActiveFilePath: vi.fn(async () => {}),
}
const prepare = vi.fn<(path: string) => Promise<boolean>>(async () => true)

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (path: string) => files.has(path)),
  writeTextFile: vi.fn(async (path: string, content: string) => { files.add(path); written.push({ path, content }) }),
}))
vi.mock('@/lib/workspace', () => ({
  getWorkspacePath: async () => ({ path: '/vault', isCustom: true }),
  getFilePathOptions: async (relativePath: string) => ({ path: relativePath }),
}))
vi.mock('@/lib/self-hosted-sync/files', () => ({ writeSelfHostedWorkspaceText: async () => false }))
vi.mock('@/lib/editor-deactivation', () => ({ prepareActiveEditorDeactivationDurably: (path: string) => prepare(path) }))
vi.mock('@/stores/article', () => ({ default: { getState: () => store } }))

const { createNewDocument, newDocumentFolder } = await import('./create')
const { planTitleCommit, sanitizeDocTitle, titleFromPath, isMarkdownDocPath } = await import('./title')
const { useTitleFocusStore } = await import('./title-focus')

beforeEach(() => {
  files.clear()
  written.length = 0
  store.activeFilePath = ''
  store.insertLocalEntry.mockReset().mockReturnValue(true)
  store.loadFileTree.mockClear()
  store.ensurePathExpanded.mockClear()
  store.setActiveFilePath.mockClear()
  prepare.mockReset().mockResolvedValue(true)
  useTitleFocusStore.setState({ pendingPath: null })
})

describe('createNewDocument', () => {
  it('creates 未命名.md in the vault root, opens it and asks the title field for focus', async () => {
    expect(await createNewDocument()).toBe('未命名.md')
    expect(written).toEqual([{ path: '未命名.md', content: '' }])
    expect(store.insertLocalEntry).toHaveBeenCalledWith('未命名.md', false)
    expect(store.setActiveFilePath).toHaveBeenCalledWith('未命名.md', false, { deactivationAlreadyPrepared: true })
    expect(useTitleFocusStore.getState().pendingPath).toBe('未命名.md')
  })

  it('adds the app’s (1), (2) suffix instead of overwriting', async () => {
    files.add('未命名.md')
    files.add('未命名 (1).md')
    expect(await createNewDocument()).toBe('未命名 (2).md')
    expect(written.map(item => item.path)).toEqual(['未命名 (2).md'])
  })

  it('follows upstream newFile: next to the open file when it is in a folder', async () => {
    store.activeFilePath = 'Projects/plan.md'
    expect(await createNewDocument()).toBe('Projects/未命名.md')
    expect(store.ensurePathExpanded).toHaveBeenCalledWith('Projects/未命名.md')
    expect(newDocumentFolder('/Users/me/outside/a.md')).toBe('')
    expect(newDocumentFolder('a.md')).toBe('')
  })

  it('reloads the tree when the row cannot be inserted, and stops when the editor cannot be left', async () => {
    store.insertLocalEntry.mockReturnValue(false)
    await createNewDocument()
    expect(store.loadFileTree).toHaveBeenCalledTimes(1)

    written.length = 0
    prepare.mockResolvedValue(false)
    expect(await createNewDocument()).toBeNull()
    expect(written).toEqual([])
  })
})

describe('title helpers', () => {
  it('reads the title from the file name', () => {
    expect(titleFromPath('Projects/未命名 (1).md')).toBe('未命名 (1)')
    expect(isMarkdownDocPath('a/b.md')).toBe(true)
    expect(isMarkdownDocPath('a/b.txt')).toBe(false)
  })

  it('replaces illegal characters with "-" and drops leading dots, a typed .md and surrounding spaces', () => {
    expect(sanitizeDocTitle('  a/b\\c:d*e?f"g<h>i|j  ')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(sanitizeDocTitle('..隱藏')).toBe('隱藏')
    expect(sanitizeDocTitle('會議記錄.md')).toBe('會議記錄')
    expect(sanitizeDocTitle('結尾. ')).toBe('結尾')
    expect(sanitizeDocTitle('   ')).toBe('')
    expect(sanitizeDocTitle('...')).toBe('')
  })

  it('plans no rename for empty or unchanged titles', () => {
    expect(planTitleCommit('未命名.md', '')).toBeNull()
    expect(planTitleCommit('未命名.md', '  ')).toBeNull()
    expect(planTitleCommit('未命名.md', '未命名')).toBeNull()
    expect(planTitleCommit('Projects/未命名.md', '週報')).toEqual({ parent: 'Projects', base: '週報' })
  })
})

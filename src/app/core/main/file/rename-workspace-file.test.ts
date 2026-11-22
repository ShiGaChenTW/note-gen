// Fork（almanac ALMNC-54.16）：從 file-item 抽出的改名流程：不覆蓋既有檔案，分頁、檔案樹、向量與連結都跟著新路徑。
import { beforeEach, expect, it, vi } from 'vitest'

const files = new Set<string>()
const fs = vi.hoisted(() => ({ rename: vi.fn(), exists: vi.fn() }))
const store = {
  activeFilePath: '未命名.md',
  beginFileTreeRename: vi.fn(() => 'op-1' as string | null),
  completeFileTreeRename: vi.fn(),
  finishFileTreeRename: vi.fn(),
  syncOpenTabsForPathChange: vi.fn(async () => {}),
}
const linkRewrite = vi.fn(async () => {})
const vectorRename = vi.fn(async () => {})

vi.mock('@tauri-apps/plugin-fs', () => ({ BaseDirectory: { AppData: 1 }, ...fs }))
vi.mock('@/lib/workspace', () => ({
  getWorkspacePath: async () => ({ path: '/vault', isCustom: true }),
  getFilePathOptions: async (path: string) => ({ path }),
}))
vi.mock('@/lib/editor-deactivation', () => ({
  prepareActiveEditorDeactivationDurably: async () => true,
  prepareActiveEditorPathMutationDurably: async () => true,
}))
vi.mock('@/lib/markdown-media-path', () => ({ rewriteWorkspaceMarkdownMediaPaths: async () => {} }))
vi.mock('@/lib/self-hosted-sync/files', () => ({ moveSelfHostedWorkspacePath: async () => false }))
vi.mock('@/lib/sync/workspace-path-moves', () => ({ withWorkspacePathMove: async (_a: string, _b: string, run: () => Promise<void>) => run() }))
vi.mock('@/stores/article', () => ({ default: { getState: () => store } }))
vi.mock('@/db/vector', () => ({ renameVectorDocumentsByFilename: vectorRename }))
vi.mock('../link-rewrite/link-rewrite-store', () => ({ requestLinkRewrite: linkRewrite }))

const { renameWorkspaceFile } = await import('./rename-workspace-file')

beforeEach(() => {
  files.clear()
  files.add('未命名.md')
  fs.exists.mockImplementation(async (path: string) => files.has(path))
  fs.rename.mockReset()
  store.beginFileTreeRename.mockReset().mockReturnValue('op-1')
  for (const fn of [store.completeFileTreeRename, store.finishFileTreeRename, store.syncOpenTabsForPathChange, linkRewrite, vectorRename]) fn.mockClear()
})

it('moves the file and lets tabs, tree, vectors and links follow', async () => {
  const onMoved = vi.fn()
  expect(await renameWorkspaceFile('未命名.md', '週報.md', { onMoved })).toBe('renamed')
  expect(fs.rename).toHaveBeenCalledWith('未命名.md', '週報.md')
  expect(store.syncOpenTabsForPathChange).toHaveBeenCalledWith('未命名.md', '週報.md', false)
  expect(store.completeFileTreeRename).toHaveBeenCalledWith('未命名.md', '週報.md', 'op-1')
  expect(store.finishFileTreeRename).toHaveBeenCalledWith('未命名.md', '週報.md', 'op-1')
  expect(vectorRename).toHaveBeenCalledWith('未命名.md', '週報.md')
  expect(linkRewrite).toHaveBeenCalledWith([{ sourcePath: '未命名.md', targetPath: '週報.md' }])
  expect(onMoved).toHaveBeenCalledTimes(1)
})

it('never overwrites an existing target', async () => {
  files.add('週報.md')
  expect(await renameWorkspaceFile('未命名.md', '週報.md')).toBe('exists')
  expect(fs.rename).not.toHaveBeenCalled()
  expect(store.beginFileTreeRename).not.toHaveBeenCalled()
})

it('reports busy when the tree refuses the rename', async () => {
  store.beginFileTreeRename.mockReturnValue(null)
  expect(await renameWorkspaceFile('未命名.md', '週報.md')).toBe('busy')
  expect(fs.rename).not.toHaveBeenCalled()
})

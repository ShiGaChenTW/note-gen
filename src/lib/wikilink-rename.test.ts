import { beforeEach, describe, expect, it, vi } from 'vitest'
import { indexNote } from '@/lib/vault-index/index-note'
import useVaultIndexStore from '@/stores/vault-index'

const files = new Map<string, string>()
const article = {
  activeFilePath: '',
  currentArticle: '',
  setCurrentArticle: vi.fn((content: string) => { article.currentArticle = content }),
}
const emitted: Array<[string, unknown]> = []
let queued = false
const revisions = new Map<string, number>()

vi.mock('@/stores/article', () => ({ default: { getState: () => article } }))
vi.mock('@/lib/emitter', () => ({ default: { emit: (name: string, payload: unknown) => emitted.push([name, payload]) } }))
vi.mock('@/lib/daily/note-io', () => ({
  readNote: vi.fn(async (path: string) => files.get(path) ?? null),
  writeNote: vi.fn(async (path: string, content: string) => { files.set(path, content) }),
}))
vi.mock('@/lib/editor-deactivation', () => ({
  markEditorPathMutation: vi.fn((path: string) => { revisions.set(path, (revisions.get(path) ?? 0) + 1) }),
  getEditorPathMutationRevision: vi.fn((path: string) => revisions.get(path) ?? 0),
  prepareActiveEditorDeactivation: vi.fn(() => true),
  runEditorPathWriteTransaction: vi.fn(async (_path: string, tx: (ctx: { hasQueuedSave: () => boolean }) => Promise<boolean>) => tx({ hasQueuedSave: () => queued })),
}))

const { planLinkRewrite, applyLinkRewrite } = await import('./wikilink-rename')
const { NoteRewriteConflictError } = await import('./note-rewrite')

const SOURCE = '---\r\nrelated: "[[Old]]"\r\n---\r\n# 來源\r\n\r\n看 [[Old|別名]] 與 [[Other]]。\r\n`[[Old]]` 不動\r\n'
const MOVED = '我是被搬動的 [t](../Other.md) 與 [[Other]]\n'

/** 以「索引仍是舊路徑、磁碟已是新路徑」模擬掛載當下的狀態。 */
function setup(moves: Array<{ sourcePath: string, targetPath: string }>, disk: Record<string, string>) {
  files.clear()
  const indexed = new Map<string, ReturnType<typeof indexNote>>()
  for (const [path, text] of Object.entries(disk)) indexed.set(path, indexNote(path, text, 1))
  for (const [path, text] of Object.entries(disk)) {
    const move = moves.find(m => path === m.sourcePath || path.startsWith(`${m.sourcePath}/`))
    files.set(move ? `${move.targetPath}${path.slice(move.sourcePath.length)}` : path, text)
  }
  useVaultIndexStore.getState().reset('test')
  useVaultIndexStore.getState().replaceAll(indexed)
}

beforeEach(() => {
  article.activeFilePath = ''
  article.currentArticle = ''
  emitted.length = 0
  queued = false
})

describe('planLinkRewrite / applyLinkRewrite', () => {
  const moves = [{ sourcePath: 'notes/Old.md', targetPath: 'archive/deep/New.md' }]

  it('用舊路徑查索引、新路徑讀檔，算出受影響的筆記與連結數', async () => {
    setup(moves, { 'Source.md': SOURCE, 'notes/Old.md': MOVED, 'Other.md': '', 'Unrelated.md': '[[Other]]' })
    const plan = await planLinkRewrite(moves)
    expect(plan.files).toEqual([{ path: 'Source.md', count: 2 }, { path: 'archive/deep/New.md', count: 1 }])
    expect(plan.totalLinks).toBe(3)
    expect(plan.pathsAfter).toContain('archive/deep/New.md')
    expect(files.get('Source.md')).toBe(SOURCE)
  })

  it('沒有受影響的連結或沒有搬動時 files 為空', async () => {
    setup(moves, { 'Source.md': '[[Other]]', 'notes/Old.md': '', 'Other.md': '' })
    expect((await planLinkRewrite(moves)).files).toEqual([])
    expect((await planLinkRewrite([{ sourcePath: 'a.md', targetPath: 'a.md' }])).files).toEqual([])
  })

  it('套用：只改連結那幾行，CRLF 與其他行一字不差，並通知編輯器', async () => {
    setup(moves, { 'Source.md': SOURCE, 'notes/Old.md': MOVED, 'Other.md': '' })
    const written = await applyLinkRewrite(await planLinkRewrite(moves))
    expect(written.map(w => w.path)).toEqual(['Source.md', 'archive/deep/New.md'])
    const source = files.get('Source.md')!
    const before = SOURCE.split('\n')
    const after = source.split('\n')
    expect(after[1]).toBe('related: "[[New]]"\r')
    expect(after[5]).toBe('看 [[New|別名]] 與 [[Other]]。\r')
    after.forEach((line, i) => { if (i !== 1 && i !== 5) expect(line).toBe(before[i]) })
    expect(files.get('archive/deep/New.md')).toBe('我是被搬動的 [t](../../Other.md) 與 [[Other]]\n')
    expect(emitted.map(([name, payload]) => [name, (payload as { path: string }).path])).toEqual([
      ['editor-file-content-updated', 'Source.md'], ['editor-file-content-updated', 'archive/deep/New.md'],
    ])
  })

  it('寫回前重讀最新內容；衝突時整批還原', async () => {
    setup(moves, { 'Source.md': SOURCE, 'notes/Old.md': MOVED, 'Other.md': '' })
    const plan = await planLinkRewrite(moves)
    files.set('Source.md', '新增一行 [[Old]]\r\n' + SOURCE)
    article.activeFilePath = 'archive/deep/New.md'
    article.currentArticle = MOVED
    queued = true
    await expect(applyLinkRewrite(plan)).rejects.toBeInstanceOf(NoteRewriteConflictError)
    expect(files.get('Source.md')).toBe('新增一行 [[Old]]\r\n' + SOURCE)
    queued = false
    await applyLinkRewrite(plan)
    expect(files.get('Source.md')!.split('\n')[0]).toBe('新增一行 [[New]]\r')
    expect(article.setCurrentArticle).toHaveBeenCalledWith('我是被搬動的 [t](../../Other.md) 與 [[Other]]\n')
  })
})

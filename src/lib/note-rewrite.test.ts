import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()
const article = {
  activeFilePath: '',
  currentArticle: '',
  setCurrentArticle: vi.fn((content: string) => { article.currentArticle = content }),
}
const emitted: Array<[string, unknown]> = []
let queued = false
let editorStable = true
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
  prepareActiveEditorDeactivation: vi.fn(() => editorStable),
  runEditorPathWriteTransaction: vi.fn(async (_path: string, tx: (ctx: { hasQueuedSave: () => boolean }) => Promise<boolean>) => tx({ hasQueuedSave: () => queued })),
}))

const { rewriteNotes, NoteRewriteConflictError } = await import('./note-rewrite')

beforeEach(() => {
  files.clear()
  files.set('a.md', 'A [[old]]\n')
  files.set('b.md', 'B [[old]]\n')
  files.set('c.md', 'no link\n')
  article.activeFilePath = ''
  article.currentArticle = ''
  emitted.length = 0
  queued = false
  editorStable = true
})

const replaceOld = (content: string) => content.replace('[[old]]', '[[new]]')

describe('rewriteNotes', () => {
  it('只回傳真的改到的檔案', async () => {
    const result = await rewriteNotes([
      { path: 'a.md', rewrite: replaceOld },
      { path: 'c.md', rewrite: replaceOld },
      { path: 'missing.md', rewrite: replaceOld },
    ])
    expect(result.map(r => r.path)).toEqual(['a.md'])
    expect(files.get('a.md')).toBe('A [[new]]\n')
    expect(files.get('c.md')).toBe('no link\n')
    expect(emitted.map(([name]) => name)).toEqual(['editor-file-content-updated'])
  })

  it('開著的那篇用 store 的內容當來源，寫完通知編輯器', async () => {
    article.activeFilePath = 'a.md'
    article.currentArticle = 'A [[old]] 未存檔的新字\n'
    await rewriteNotes([{ path: 'b.md', rewrite: replaceOld }, { path: 'a.md', rewrite: replaceOld }])
    expect(files.get('a.md')).toBe('A [[new]] 未存檔的新字\n')
    expect(article.setCurrentArticle).toHaveBeenCalledWith('A [[new]] 未存檔的新字\n')
    expect(emitted.at(-1)).toEqual(['external-content-update', 'A [[new]] 未存檔的新字\n'])
  })

  it('編輯器有排隊中的存檔時整批還原', async () => {
    article.activeFilePath = 'b.md'
    article.currentArticle = 'B [[old]]\n'
    queued = true
    await expect(rewriteNotes([{ path: 'a.md', rewrite: replaceOld }, { path: 'b.md', rewrite: replaceOld }]))
      .rejects.toBeInstanceOf(NoteRewriteConflictError)
    expect(files.get('a.md')).toBe('A [[old]]\n')
    expect(files.get('b.md')).toBe('B [[old]]\n')
    expect(emitted).toEqual([])
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/daily/note-io', () => ({ readNote: vi.fn(async () => null) }))

import type { AgentRuntimeCallbacks, AgentRuntimeInput, AgentRuntimeResult, AgentTool } from '@/lib/agent/types'
import {
  buildResumeNote,
  dependsOnPendingDraft,
  describeDraftTarget,
  hasConflict,
  markInterrupted,
  mergeDraft,
  pickRunnable,
  readThroughDrafts,
  requiresIndividualReview,
  statusAfterReview,
} from './draft'
import { buildBackgroundTools, type DraftSink } from './draft-tools'
import { applyBulk, applyDraft, inspectDrafts } from './review'
import { AgentTaskCenter, type RuntimeLike } from './task-center'
import type { AgentTask, DraftChange } from './types'

function tool(name: string, category: AgentTool['category'], risk: AgentTool['risk'], execute?: AgentTool['execute']): AgentTool {
  return {
    name,
    title: name,
    description: name,
    category,
    risk,
    inputSchema: { type: 'object' },
    execute: execute ?? (async () => ({ ok: true, message: `${name} ran` })),
  }
}

function draft(partial: Partial<DraftChange>): DraftChange {
  return {
    id: partial.id ?? 'd1',
    toolName: 'note_update_file',
    args: {},
    kind: 'update',
    path: 'a.md',
    baseContent: 'old',
    content: 'new',
    summary: '',
    state: 'pending',
    ...partial,
  }
}

function task(partial: Partial<AgentTask>): AgentTask {
  return { id: 't', kind: 'chat', title: 't', prompt: 'p', status: 'queued', drafts: [], tokens: 0, createdAt: 0, updatedAt: 0, ...partial }
}

describe('草稿規則', () => {
  it('從工具參數推出路徑與目的地', () => {
    expect(describeDraftTarget('note_create_file', { folderPath: 'Rust/', fileName: 'a.md', content: 'x' })).toEqual({ path: 'Rust/a.md', content: 'x' })
    expect(describeDraftTarget('note_move_file', { filePath: 'Inbox/a.md', targetFolderPath: '生活' })).toEqual({ path: 'Inbox/a.md', targetPath: '生活/a.md' })
    expect(describeDraftTarget('note_rename_file', { filePath: 'Inbox/a.md', newName: 'b.md' })).toEqual({ path: 'Inbox/a.md', targetPath: 'Inbox/b.md' })
    expect(describeDraftTarget('note_copy_file', { filePath: 'x/a.md' }).targetPath).toBe('x/a.md')
  })

  it('搬移、刪除與衝突一律逐條確認', () => {
    expect(requiresIndividualReview(draft({ kind: 'delete' }), false)).toBe(true)
    expect(requiresIndividualReview(draft({ kind: 'move' }), false)).toBe(true)
    expect(requiresIndividualReview(draft({ kind: 'update' }), true)).toBe(true)
    expect(requiresIndividualReview(draft({ kind: 'update' }), false)).toBe(false)
  })

  it('檔案在草稿之後被改過就是衝突', () => {
    expect(hasConflict(draft({ baseContent: 'old' }), 'old')).toBe(false)
    expect(hasConflict(draft({ baseContent: 'old' }), 'phone edit')).toBe(true)
    expect(hasConflict(draft({ kind: 'create', baseContent: null, content: 'x' }), null)).toBe(false)
    expect(hasConflict(draft({ kind: 'create', baseContent: null, content: 'x' }), 'someone else')).toBe(true)
  })

  it('同一任務已收下的修改不算衝突（先改內容再改名）', () => {
    const edit = draft({ id: 'e', path: 'a.md', baseContent: 'old', content: 'new', state: 'applied' })
    const move = draft({ id: 'm', kind: 'move', toolName: 'note_rename_file', path: 'a.md', baseContent: 'old' })
    expect(hasConflict(move, 'new', [edit, move])).toBe(false)
    expect(hasConflict(move, 'phone edit', [edit, move])).toBe(true)
    expect(hasConflict(move, 'new', [{ ...edit, state: 'pending' }, move])).toBe(true)
  })

  it('改名後再改內容：讀得到新路徑、收下時依序處理', () => {
    const rename = draft({ id: 'r', kind: 'move', toolName: 'note_rename_file', path: 'a.md', targetPath: 'b.md', content: 'hi', baseContent: 'hi' })
    const edit = draft({ id: 'e', path: 'b.md', baseContent: null, content: 'hi\nworld' })
    expect(readThroughDrafts([rename], 'b.md')).toEqual({ found: true, content: 'hi' })
    expect(readThroughDrafts([rename], 'a.md')).toEqual({ found: true, content: null })
    expect(dependsOnPendingDraft(edit, [rename, edit])).toBe(true)
    expect(dependsOnPendingDraft(edit, [{ ...rename, state: 'applied' }, edit])).toBe(false)
    expect(hasConflict(edit, 'hi', [{ ...rename, state: 'applied' }, edit])).toBe(false)
  })

  it('同一路徑的草稿合併成一筆', () => {
    const created = draft({ id: 'c', kind: 'create', toolName: 'note_create_file', baseContent: null, content: 'v1', args: { content: 'v1' } })
    const merged = mergeDraft([created], draft({ id: 'u', content: 'v2' }))
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: 'c', kind: 'create', content: 'v2', args: { content: 'v2' } })
    expect(mergeDraft([created], draft({ id: 'x', kind: 'delete', content: undefined }))).toEqual([])
    const updated = mergeDraft([draft({ id: 'u1', baseContent: 'disk' })], draft({ id: 'del', kind: 'delete' }))
    expect(updated).toEqual([expect.objectContaining({ id: 'del', kind: 'delete', baseContent: 'disk' })])
  })

  it('讀檔時看到草稿後的內容', () => {
    const drafts = [draft({ path: 'a.md', content: 'drafted' }), draft({ id: 'd2', kind: 'delete', path: 'b.md' })]
    expect(readThroughDrafts(drafts, 'a.md')).toEqual({ found: true, content: 'drafted' })
    expect(readThroughDrafts(drafts, 'b.md')).toEqual({ found: true, content: null })
    expect(readThroughDrafts(drafts, 'c.md').found).toBe(false)
  })

  it('並行上限內先進先出', () => {
    const tasks = [task({ id: 'r', status: 'running' }), task({ id: 'q2', createdAt: 2 }), task({ id: 'q1', createdAt: 1 }), task({ id: 'q3', createdAt: 3 })]
    expect(pickRunnable(tasks, 2).map(t => t.id)).toEqual(['q1'])
    expect(pickRunnable(tasks, 1)).toEqual([])
  })

  it('重開 app 時執行中與排隊的任務變成沒做完', () => {
    expect(markInterrupted(task({ status: 'running' }), 5)).toMatchObject({ status: 'interrupted', updatedAt: 5 })
    expect(markInterrupted(task({ status: 'queued' }), 5).status).toBe('interrupted')
    const done = task({ status: 'completed' })
    expect(markInterrupted(done, 5)).toBe(done)
  })

  it('還有沒處理的草稿就繼續等你；繼續時提醒模型不要重做', () => {
    expect(statusAfterReview(task({ drafts: [draft({ state: 'applied' }), draft({ id: 'd2' })] }))).toBe('awaiting_review')
    expect(statusAfterReview(task({ drafts: [draft({ state: 'applied' }), draft({ id: 'd2', state: 'discarded' })] }))).toBe('completed')
    expect(buildResumeNote([draft({ summary: '修改 a.md' })])).toContain('修改 a.md')
    expect(buildResumeNote([])).toBe('')
  })
})

describe('草稿版工具', () => {
  function sinkOf(): DraftSink & { list: DraftChange[] } {
    const sink = { list: [] as DraftChange[], drafts: () => sink.list, add: (d: DraftChange) => { sink.list = mergeDraft(sink.list, d) } }
    return sink
  }

  it('只留唯讀工具與包成草稿的檔案操作', () => {
    const tools = buildBackgroundTools([
      tool('note_read_file', 'note', 'read'),
      tool('note_open_file', 'note', 'read'),
      tool('editor_get_state', 'editor', 'read'),
      tool('note_update_file', 'note', 'file-update'),
      tool('memory_create', 'memory', 'memory-write'),
      tool('skill_execute_script', 'skill', 'script'),
      tool('folder_delete', 'folder', 'delete'),
      tool('knowledge_search', 'note', 'read'),
    ], sinkOf(), async () => null)
    expect(tools.map(t => t.name)).toEqual(['note_read_file', 'note_update_file', 'knowledge_search'])
  })

  it('改檔不寫入 vault，只記成草稿', async () => {
    const realWrite = vi.fn(async () => ({ ok: true, message: 'written' }))
    const sink = sinkOf()
    const [update] = buildBackgroundTools([tool('note_update_file', 'note', 'file-update', realWrite)], sink, async () => 'old')
    const result = await update.execute({ filePath: 'a.md', content: 'new' }, { runId: 'r', context: { userInput: '' } })
    expect(result.ok).toBe(true)
    expect(realWrite).not.toHaveBeenCalled()
    expect(sink.list).toEqual([expect.objectContaining({ kind: 'update', path: 'a.md', baseContent: 'old', content: 'new', state: 'pending' })])
  })

  it('修改不存在的檔案會失敗；先新增再修改則可以', async () => {
    const sink = sinkOf()
    const tools = buildBackgroundTools([tool('note_create_file', 'note', 'file-create'), tool('note_update_file', 'note', 'file-update')], sink, async () => null)
    const [create, update] = tools
    expect((await update.execute({ filePath: 'n.md', content: 'x' }, { runId: 'r', context: { userInput: '' } })).ok).toBe(false)
    await create.execute({ fileName: 'n.md', content: 'v1' }, { runId: 'r', context: { userInput: '' } })
    expect((await update.execute({ filePath: 'n.md', content: 'v2' }, { runId: 'r', context: { userInput: '' } })).ok).toBe(true)
    expect(sink.list).toHaveLength(1)
    expect(sink.list[0]).toMatchObject({ kind: 'create', content: 'v2' })
  })

  it('改名之後可以修改新路徑的檔案', async () => {
    const sink = sinkOf()
    const [rename, update] = buildBackgroundTools([tool('note_rename_file', 'note', 'file-update'), tool('note_update_file', 'note', 'file-update')], sink, async p => (p === 'x/a.md' ? 'hi' : null))
    await rename.execute({ filePath: 'x/a.md', newName: 'b.md' }, { runId: 'r', context: { userInput: '' } })
    expect((await update.execute({ filePath: 'x/b.md', content: 'hi\nworld' }, { runId: 'r', context: { userInput: '' } })).ok).toBe(true)
    expect(sink.list.map(d => [d.kind, d.path, d.targetPath, d.content])).toEqual([['move', 'x/a.md', 'x/b.md', 'hi'], ['update', 'x/b.md', undefined, 'hi\nworld']])
  })

  it('讀檔先看草稿', async () => {
    const sink = sinkOf()
    sink.list = [draft({ path: 'a.md', content: 'drafted' })]
    const disk = vi.fn(async () => ({ ok: true, message: 'disk' }))
    const [read] = buildBackgroundTools([tool('note_read_file', 'note', 'read', disk)], sink, async () => 'disk')
    expect((await read.execute({ filePath: 'a.md' }, { runId: 'r', context: { userInput: '' } })).message).toContain('drafted')
    await read.execute({ filePath: 'b.md' }, { runId: 'r', context: { userInput: '' } })
    expect(disk).toHaveBeenCalledTimes(1)
  })
})

describe('審核', () => {
  it('收下時用原本的工具寫入，並去掉舊的修改時間檢查', async () => {
    const execute = vi.fn(async () => ({ ok: true, message: 'ok' }))
    const deps = { readFile: async () => 'old', getTool: () => tool('note_update_file', 'note', 'file-update', execute) }
    const result = await applyDraft(draft({ args: { filePath: 'a.md', content: 'new', expectedModifiedAt: 'x' } }), deps)
    expect(result.state).toBe('applied')
    expect(execute).toHaveBeenCalledWith({ filePath: 'a.md', content: 'new' }, expect.anything())
  })

  it('有衝突時不寫入，除非使用者確認', async () => {
    const execute = vi.fn(async () => ({ ok: true, message: 'ok' }))
    const deps = { readFile: async () => 'phone edit', getTool: () => tool('note_update_file', 'note', 'file-update', execute) }
    expect((await applyDraft(draft({}), deps)).error).toBe('CONFLICT')
    expect(execute).not.toHaveBeenCalled()
    expect((await applyDraft(draft({}), deps, true)).state).toBe('applied')
  })

  it('整批收下跳過搬移、刪除與衝突', async () => {
    const execute = vi.fn(async () => ({ ok: true, message: 'ok' }))
    const files: Record<string, string> = { 'a.md': 'old', 'b.md': 'changed', 'c.md': 'x' }
    const deps = { readFile: async (p: string) => files[p] ?? null, getTool: (name: string) => tool(name, 'note', 'file-update', execute) }
    const drafts = [
      draft({ id: 'ok', path: 'a.md' }),
      draft({ id: 'conflict', path: 'b.md' }),
      draft({ id: 'del', kind: 'delete', toolName: 'note_delete_file', path: 'c.md', baseContent: 'x' }),
    ]
    const views = await inspectDrafts(drafts, deps)
    expect(views.map(v => [v.draft.id, v.conflict, v.individual])).toEqual([['ok', false, false], ['conflict', true, true], ['del', false, true]])
    const results = await applyBulk(views, deps)
    expect(results.map(d => d.state)).toEqual(['applied', 'pending', 'pending'])
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('任務中心', () => {
  function setup(runImpl: (input: AgentRuntimeInput, callbacks: AgentRuntimeCallbacks, stop: Promise<void>) => Promise<AgentRuntimeResult>, stored: AgentTask[] = []) {
    const persisted: AgentTask[] = []
    const notified: string[] = []
    const runtimes: Array<{ input?: AgentRuntimeInput; stopped: boolean }> = []
    let clock = 100
    const center = new AgentTaskCenter({
      createRuntime: (): RuntimeLike => {
        const record = { input: undefined as AgentRuntimeInput | undefined, stopped: false }
        runtimes.push(record)
        let resolveStop: () => void = () => {}
        const stop = new Promise<void>(resolve => { resolveStop = resolve })
        return {
          run: (input, callbacks = {}) => { record.input = input; return runImpl(input, callbacks, stop) },
          stop: () => { record.stopped = true; resolveStop() },
        }
      },
      persist: async t => { persisted.push(t) },
      load: async () => stored,
      remove: async () => {},
      concurrency: async () => 2,
      notify: (event, t) => notified.push(`${event}:${t.id}`),
      now: () => ++clock,
    })
    return { center, persisted, notified, runtimes }
  }

  const done = (content = 'done'): AgentRuntimeResult => ({ runId: 'r', content, stopped: false, steps: [], toolCalls: [], changes: [], trace: [] })
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  it('最多同時跑兩個，其餘排隊', async () => {
    const releases: Array<() => void> = []
    const { center } = setup(() => new Promise(resolve => releases.push(() => resolve(done()))))
    await center.enqueue({ prompt: 'a' })
    await center.enqueue({ prompt: 'b' })
    await center.enqueue({ prompt: 'c' })
    await flush()
    expect(center.list().filter(t => t.status === 'running')).toHaveLength(2)
    expect(center.list().filter(t => t.status === 'queued')).toHaveLength(1)
    releases[0]()
    await flush(); await flush()
    expect(center.list().filter(t => t.status === 'running')).toHaveLength(2)
    expect(center.list().filter(t => t.status === 'completed')).toHaveLength(1)
  })

  it('有草稿就等你審，並在執行時用草稿版工具', async () => {
    const { center, notified, runtimes } = setup(async input => {
      const tools = input.transformTools!([tool('note_create_file', 'note', 'file-create')])
      await tools[0].execute({ fileName: 'x.md', content: 'hi' }, { runId: 'r', context: { userInput: '' } })
      return done()
    })
    const created = await center.enqueue({ prompt: '整理 Inbox' })
    await flush(); await flush()
    const t = center.get(created.id)!
    expect(t.status).toBe('awaiting_review')
    expect(t.drafts).toEqual([expect.objectContaining({ kind: 'create', path: 'x.md' })])
    expect(runtimes[0].input).toMatchObject({ permissionMode: 'auto-edit', selectedMcpServerIds: [] })
    expect(notified).toEqual([`awaiting_review:${created.id}`])
  })

  it('取消執行中的任務：沒有草稿就是已取消', async () => {
    const { center, runtimes } = setup(async (_input, _callbacks, stop) => { await stop; return { ...done(''), stopped: true } })
    const created = await center.enqueue({ prompt: 'a' })
    await flush()
    await center.cancel(created.id)
    await flush(); await flush()
    expect(runtimes[0].stopped).toBe(true)
    expect(center.get(created.id)!.status).toBe('cancelled')
  })

  it('啟動時把上次沒跑完的標成沒做完；繼續時帶著草稿重跑', async () => {
    const stored = [task({ id: 'old', status: 'running', drafts: [draft({ summary: '修改 a.md' })] })]
    const { center, runtimes } = setup(async () => done(), stored)
    await center.init()
    expect(center.get('old')!.status).toBe('interrupted')
    await center.resume('old')
    await flush(); await flush()
    const system = runtimes[0].input!.messages![0].content as string
    expect(system).toContain('修改 a.md')
    expect(center.get('old')!.status).toBe('awaiting_review')
  })

  it('執行失敗算沒做完，可以繼續', async () => {
    const { center, notified } = setup(async () => { throw new Error('boom') })
    const created = await center.enqueue({ prompt: 'a' })
    await flush(); await flush()
    expect(center.get(created.id)).toMatchObject({ status: 'failed', error: 'boom' })
    expect(notified).toEqual([`failed:${created.id}`])
  })

  it('累計 token', async () => {
    const { center } = setup(async (_input, callbacks) => {
      callbacks.onTrace?.({ id: 'm1', runId: 'r', type: 'model_response', title: '', status: 'running', timestamp: 0, streamedTokenCount: 10 })
      callbacks.onTrace?.({ id: 'm1', runId: 'r', type: 'model_response', title: '', status: 'success', timestamp: 0, streamedTokenCount: 30 })
      callbacks.onTrace?.({ id: 'm2', runId: 'r', type: 'model_response', title: '', status: 'success', timestamp: 0, streamedTokenCount: 5 })
      return done()
    })
    const created = await center.enqueue({ prompt: 'a' })
    await flush(); await flush()
    expect(center.get(created.id)!.tokens).toBe(35)
  })
})

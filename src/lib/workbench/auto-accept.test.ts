import { describe, expect, it, vi } from 'vitest'
import { CARD_VERBS } from './cards'
import { tryAutoAcceptLink } from './auto-accept'
import { createOpsService } from '@/lib/ops/service'
import { createMemoryOpsIo, createMemoryOpsStore } from '@/lib/ops/testing'
import { UNDO_WINDOW_MS } from '@/lib/ops/types'
import { opActivityEntry } from '@/lib/ops/runtime'

const path = '筆記/番茄鐘.md'
const noteId = 'N-20261123-120000-ABCD'
const before = `---\nid: ${noteId}\n---\n番茄鐘可以減少切換。\n`
const after = before + '\n- [[注意力殘留]]\n'
const changes = [{ target: 'note' as const, path, before, after }]
const candidate = { verb: 'supplement', changes, key: 'collect:batch:link', actor: 'expert' as const, actorId: 'alex' }

function setup() {
  const io = createMemoryOpsIo({ [path]: before }, { [noteId]: path })
  const store = createMemoryOpsStore()
  const activity = vi.fn()
  let now = 100
  const makeService = () => createOpsService({
    ...io, store, now: () => now,
    onRecorded: async (records, context) => {
      for (const record of records) activity(opActivityEntry(record, context))
    },
  })
  const service = makeService()
  const deps = { enabled: true, isScottPinned: vi.fn(async () => false), applyOps: vi.fn(service.applyOps) }
  return { io, store, deps, activity, restart: (elapsed: number) => { now += elapsed; return makeService() } }
}

describe('低風險提案自動接受', () => {
  it('用發起夥伴與提案編號寫入、留下自動接受紀錄，重開後仍可復原', async () => {
    const { io, store, deps, activity, restart } = setup()
    expect(await tryAutoAcceptLink(candidate, deps)).toBe(true)
    expect(io.files[path]).toBe(after)
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]).toMatchObject({ proposalId: candidate.key, actor: 'expert', actorId: 'alex', payload: { noteId } })
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auto_accepted', source: { kind: 'proposal', ref: candidate.key }, opId: store.rows[0].id,
    }))
    expect(await restart(UNDO_WINDOW_MS - 1).undoOp(store.rows[0].id)).toMatchObject({ status: 'undone' })
    expect(io.files[path]).toBe(before)
  })

  it('7 天整過期', async () => {
    const { store, deps, restart } = setup()
    await tryAutoAcceptLink(candidate, deps)
    expect(await restart(UNDO_WINDOW_MS).undoOp(store.rows[0].id)).toEqual({ status: 'expired' })
  })

  it('關閉開關時交回人工審核', async () => {
    const { deps, io } = setup()
    expect(await tryAutoAcceptLink(candidate, { ...deps, enabled: false })).toBe(false)
    expect(deps.applyOps).not.toHaveBeenCalled()
    expect(io.files[path]).toBe(before)
  })

  it('Scott 指定的位置交回人工審核', async () => {
    const { deps } = setup()
    deps.isScottPinned.mockResolvedValue(true)
    expect(await tryAutoAcceptLink(candidate, deps)).toBe(false)
    expect(deps.isScottPinned).toHaveBeenCalledWith(changes[0])
    expect(deps.applyOps).not.toHaveBeenCalled()
  })

  it.each(CARD_VERBS)('動作 %s 若更改正文，一律交回人工審核', async verb => {
    const { deps } = setup()
    expect(await tryAutoAcceptLink({ ...candidate, verb, changes: [{ ...changes[0], after: after.replace('減少', '增加') }] }, deps)).toBe(false)
    expect(deps.applyOps).not.toHaveBeenCalled()
  })

  it.each(CARD_VERBS.filter(verb => verb !== 'supplement' && verb !== 'modify'))('其他動作 %s 即使帶連結差異也不自動接受', async verb => {
    const { deps } = setup()
    expect(await tryAutoAcceptLink({ ...candidate, verb }, deps)).toBe(false)
    expect(deps.applyOps).not.toHaveBeenCalled()
  })

  it('過期版本交回人工審核，保留後續編輯', async () => {
    const { io, store, deps } = setup()
    io.files[path] = before + 'Scott 的補充\n'
    expect(await tryAutoAcceptLink(candidate, deps)).toBe(false)
    expect(io.files[path]).toBe(before + 'Scott 的補充\n')
    expect(store.rows).toEqual([])
  })

  it('無法保存復原紀錄時還原剛剛的寫入，交回人工審核', async () => {
    const { io, store, deps, activity } = setup()
    const service = createOpsService({
      ...io, store: { ...store, insert: async () => { throw new Error('database unavailable') } }, onRecorded: activity,
    })
    expect(await tryAutoAcceptLink(candidate, { ...deps, applyOps: service.applyOps })).toBe(false)
    expect(io.files[path]).toBe(before)
    expect(activity).not.toHaveBeenCalled()
  })

  it('活動紀錄寫入失敗時撤回變更，並使對應的復原紀錄失效', async () => {
    const { io, store, deps } = setup()
    const service = createOpsService({
      ...io, store, onRecorded: async () => { throw new Error('activity log unavailable') },
    })
    expect(await tryAutoAcceptLink(candidate, { ...deps, applyOps: service.applyOps })).toBe(false)
    expect(io.files[path]).toBe(before)
    expect(store.rows[0].undoneAt).not.toBeNull()
  })
})

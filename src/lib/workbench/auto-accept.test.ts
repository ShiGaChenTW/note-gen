import { describe, expect, it, vi } from 'vitest'
import { CARD_VERBS } from './cards'
import { tryAutoAcceptLink } from './auto-accept'
import { createOpsService } from '@/lib/ops/service'
import { createMemoryOpsIo, createMemoryOpsStore } from '@/lib/ops/testing'
import { UNDO_WINDOW_MS } from '@/lib/ops/types'
import { opActivityEntry } from '@/lib/ops/runtime'
import { changesPinTouches } from '@/lib/moc/scott-pin-check'
import type { ScottPin } from '@/lib/moc/scott-pins'

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

// Fork（almanac ALMNC-69.11）：接上真的標記判斷。MOC 改動在 riskOf 本來就是高風險（不自動接受），標記檢查是第二道保護；
// 一般筆記補連結不改任何 MOC 位置，照常自動接受；讀不到標記時交回人工審核。
describe('自動接受遇到 Scott 指定', () => {
  const NOW = 1_000_000_000_000
  const mocPath = '20 領域/專注力.md'
  const mocBefore = '---\nid: M-20261112-060012-VPB3\nkind: domain\ntitle: 專注力\n---\n# 專注力\n\n## ④ 重點結論\n- 番茄鐘可以減少切換。\n\n## ⑤ 待釐清\n- 未解：要多久？\n'
  const mocChange = { target: 'note' as const, path: mocPath, before: mocBefore, after: mocBefore.replace('- 番茄鐘可以減少切換。', '- [[番茄鐘]]可以減少切換。') }
  const pin = (block: ScottPin['block'], age: number): ScottPin => ({ kind: 'block', block, mocPath, mocId: 'M-20261112-060012-VPB3', mocName: '專注力', at: NOW - age })
  const check = (pins: ScottPin[]) => async (change: Parameters<typeof changesPinTouches>[0][number]) => changesPinTouches([change], pins, { now: NOW }).length > 0

  it('MOC 上有標記的區塊被改到：判斷為 Scott 指定，不自動接受', async () => {
    expect(await check([pin('conclusions', 1000)])(mocChange)).toBe(true)
    expect(await check([pin('open', 1000)])(mocChange)).toBe(false)
    expect(await check([pin('conclusions', 90 * 24 * 60 * 60 * 1000)])(mocChange)).toBe(false)
    const { deps } = setup()
    expect(await tryAutoAcceptLink({ ...candidate, changes: [mocChange] }, { ...deps, isScottPinned: check([pin('conclusions', 1000)]) })).toBe(false)
    expect(deps.applyOps).not.toHaveBeenCalled()
  })

  it('一般筆記補連結不碰 MOC 位置：照常自動接受', async () => {
    const { io, deps } = setup()
    expect(await tryAutoAcceptLink(candidate, { ...deps, isScottPinned: check([pin('conclusions', 1000)]) })).toBe(true)
    expect(io.files[path]).toBe(after)
  })

  it('讀不到標記時交回人工審核', async () => {
    const { io, deps } = setup()
    expect(await tryAutoAcceptLink(candidate, { ...deps, isScottPinned: async () => { throw new Error('db') } })).toBe(false)
    expect(deps.applyOps).not.toHaveBeenCalled()
    expect(io.files[path]).toBe(before)
  })
})

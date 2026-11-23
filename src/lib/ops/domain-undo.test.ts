// Fork（almanac ALMNC-72）：撤回成立領域提案——要不要問、新建的專家能不能安全撤回、問答後的流程。
import { describe, expect, it, vi } from 'vitest'
import { expertKeepReasons, needsDomainUndoChoice, runDomainUndo, type ExpertSnapshot, type ProposalExpert } from './domain-undo'

const expert: ProposalExpert = { batchId: 'b1', proposalId: 'domain:投資', agentId: 'agent-ivy', name: 'Ivy', domain: '投資', at: 1000 }

const snapshot = (partial: Partial<ExpertSnapshot> = {}): ExpertSnapshot => ({
  agent: { id: 'agent-ivy', role: 'expert', domain: '投資', updatedAt: 900 },
  memory: [{ kind: 'soul', updatedAt: 990 }, { kind: 'rules', updatedAt: 995 }],
  activityCount: 0,
  taskCount: 0,
  domainNames: ['料理'],
  ...partial,
})

describe('needsDomainUndoChoice', () => {
  it('只在這批有尚未復原的成立領域、而且登記了還沒撤回的新建專家時才問', () => {
    const records = [{ kind: 'domain.create' as const, undoneAt: null }]
    expect(needsDomainUndoChoice(records, expert)).toBe(true)
    expect(needsDomainUndoChoice(records, null)).toBe(false)
    expect(needsDomainUndoChoice(records, { ...expert, removedAt: 5 })).toBe(false)
    expect(needsDomainUndoChoice([{ kind: 'domain.create', undoneAt: 3 }], expert)).toBe(false)
    expect(needsDomainUndoChoice([{ kind: 'note.create', undoneAt: null }], expert)).toBe(false)
  })
})

describe('expertKeepReasons', () => {
  it('剛建好、沒人用過的專家可以撤回', () => {
    expect(expertKeepReasons(expert, snapshot())).toEqual([])
  })

  it('專家已經不在（或變成別的角色）就不動', () => {
    expect(expertKeepReasons(expert, snapshot({ agent: null }))).toEqual(['missing'])
    expect(expertKeepReasons(expert, snapshot({ agent: { id: 'agent-ivy', role: 'commander', updatedAt: 900 } }))).toEqual(['missing'])
  })

  it('改負責別的領域，或撤回後還有同名領域在用，都保留', () => {
    expect(expertKeepReasons(expert, snapshot({ agent: { id: 'agent-ivy', role: 'expert', domain: '理財', updatedAt: 900 } }))).toEqual(['domain-changed'])
    expect(expertKeepReasons(expert, snapshot({ domainNames: ['料理', ' 投資 '] }))).toEqual(['domain-in-use'])
  })

  it('接受之後改過設定或記憶、有工作筆記、有活動紀錄或任務，都保留並列出原因', () => {
    expect(expertKeepReasons(expert, snapshot({ agent: { id: 'agent-ivy', role: 'expert', domain: '投資', updatedAt: 2000 } }))).toEqual(['edited'])
    expect(expertKeepReasons(expert, snapshot({ memory: [{ kind: 'soul', updatedAt: 1500 }] }))).toEqual(['edited'])
    expect(expertKeepReasons(expert, snapshot({ memory: [{ kind: 'work_notes', updatedAt: 900 }] }))).toEqual(['edited'])
    expect(expertKeepReasons(expert, snapshot({ activityCount: 1 }))).toEqual(['activity'])
    expect(expertKeepReasons(expert, snapshot({ taskCount: 2, memory: [{ kind: 'rules', updatedAt: 1001 }] }))).toEqual(['edited', 'activity'])
  })
})

describe('runDomainUndo', () => {
  const deps = (choice: 'moc-only' | 'with-expert' | null) => ({
    expert,
    ask: vi.fn(async () => choice),
    undo: vi.fn(async () => true),
    succeeded: (done: boolean) => done,
    removeExpert: vi.fn(async () => ({ status: 'removed' as const, expert })),
  })

  it('選「只撤回 MOC」：撤回 MOC，專家不動', async () => {
    const d = deps('moc-only')
    expect(await runDomainUndo(d)).toEqual({ status: 'done', choice: 'moc-only', result: true })
    expect(d.ask).toHaveBeenCalledWith(expert)
    expect(d.undo).toHaveBeenCalledTimes(1)
    expect(d.removeExpert).not.toHaveBeenCalled()
  })

  it('選「一起撤回」：撤回 MOC 成功後才移除專家', async () => {
    const d = deps('with-expert')
    expect(await runDomainUndo(d)).toEqual({ status: 'done', choice: 'with-expert', result: true, expert: { status: 'removed', expert } })
    expect(d.removeExpert).toHaveBeenCalledWith(expert)
    const failed = { ...deps('with-expert'), undo: vi.fn(async () => false) }
    expect(await runDomainUndo(failed)).toEqual({ status: 'done', choice: 'with-expert', result: false })
    expect(failed.removeExpert).not.toHaveBeenCalled()
  })

  it('取消：什麼都不動；沒有新建專家就不問；已經問過（比較卡再跑）沿用選擇', async () => {
    const cancelled = deps(null)
    expect(await runDomainUndo(cancelled)).toEqual({ status: 'cancelled' })
    expect(cancelled.undo).not.toHaveBeenCalled()
    const none = { ...deps('with-expert'), expert: null }
    expect(await runDomainUndo(none)).toEqual({ status: 'done', choice: 'moc-only', result: true })
    expect(none.ask).not.toHaveBeenCalled()
    const retry = { ...deps(null), choice: 'with-expert' as const }
    expect((await runDomainUndo(retry)).status).toBe('done')
    expect(retry.ask).not.toHaveBeenCalled()
    expect(retry.removeExpert).toHaveBeenCalledTimes(1)
  })
})

// @vitest-environment jsdom
// Fork（almanac ALMNC-54.3）：Agent 設定區——Scott 在設定頁查看與修改個別記憶、目前脈絡、偏好；活動紀錄唯讀、最新在前。
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { AgentSettings as SavedAgent } from '@/lib/agents/settings'
import type { ActivityEntry } from '@/lib/agent-memory'
import en from '../../../../../messages/en.json'

const db = vi.hoisted(() => ({
  getAgentMemory: vi.fn(),
  writeAgentMemory: vi.fn(async () => ({ status: 'saved' })),
  getSharedContext: vi.fn(),
  saveSharedContext: vi.fn(async () => {}),
  listActivity: vi.fn(),
  getScottPreferences: vi.fn(),
  saveScottPreferences: vi.fn(async () => {}),
}))
vi.mock('@/db/agent-memory', () => db)

// ALMNC-69.9：活動紀錄對應的操作（7 天內可復原）。
const ops = vi.hoisted(() => ({
  opUiStates: vi.fn(async (): Promise<Map<string, unknown>> => new Map()),
  undoOp: vi.fn(),
  undoBatch: vi.fn(),
}))
vi.mock('@/lib/ops/runtime', () => ops)

vi.mock('next-intl', async importOriginal => {
  const intl = await importOriginal<typeof import('next-intl')>()
  return {
    ...intl,
    useTranslations: (namespace?: string) =>
      intl.createTranslator({ locale: 'en', messages: { agents: en.agents, ops: en.ops }, namespace: (namespace ?? 'agents') as 'agents' }),
  }
})

import { AgentMemorySettings } from './agent-memory-settings'

const agents: SavedAgent[] = [
  { id: 'mia', name: 'Mia', role: 'commander', enabled: true, allowedTools: [], createdAt: 1, updatedAt: 1 },
  { id: 'leo', name: 'Leo', role: 'secretary', enabled: true, allowedTools: [], createdAt: 2, updatedAt: 2 },
]
const doc = (content: string, isTemplate = false) => ({ content, updatedAt: isTemplate ? null : 1, updatedBy: isTemplate ? null : 'scott', isTemplate })
const activity: ActivityEntry[] = [
  { id: 2, at: 2000, actorId: 'leo', actorRole: 'secretary', action: 'corrected', targetLink: 'task:9',
    source: { kind: 'conversation', ref: 'c1' }, note: 'time fixed', correctsId: 1, archivedAt: null },
  { id: 1, at: 1000, actorId: 'scott', actorRole: 'scott', action: 'instructed', targetLink: 'task:9',
    source: { kind: 'proposal', ref: 'p1' }, note: '', correctsId: null, archivedAt: null },
]

function setValue(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

it('lets Scott view and edit memory, context and preferences, and shows the activity log read-only', async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  db.getAgentMemory.mockImplementation(async (agent: SavedAgent) => ({
    soul: doc(`# soul.md\n- 本名：${agent.name}`, true), rules: doc('rules'), workNotes: doc(''),
  }))
  db.getSharedContext.mockResolvedValue({ projects: [{ title: 'Almanac', link: '[[Almanac]]' }], weeklyFocus: [], people: [], updatedAt: 1, updatedBy: 'agent:mia' })
  db.listActivity.mockResolvedValue(activity)
  db.getScottPreferences.mockResolvedValue({ content: 'Reply in zh-TW', updatedAt: 1 })

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const area = (label: string) => container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!
  const save = (label: string) => [...container.querySelectorAll('button')].find(btn => btn.textContent === `${en.agents.memory.save} ${label}`)!
  const m = en.agents.memory

  try {
    await act(async () => root.render(React.createElement(AgentMemorySettings, { agents })))
    expect(area(m.soul).value).toContain('本名：Mia')
    expect(container.textContent).toContain(m.template)
    expect(area(m.rules).value).toBe('rules')
    expect(area(m.projects).value).toBe('Almanac | [[Almanac]]')
    expect(area(m.preferences).value).toBe('Reply in zh-TW')
    expect(db.listActivity).toHaveBeenCalledWith({ limit: 50 })

    // 活動紀錄：最新在前、唯讀（沒有輸入框或按鈕）。
    const log = container.querySelector(`ol[aria-label="${m.activity}"]`)!
    const items = [...log.querySelectorAll('li')]
    expect(items.map(item => item.textContent)).toEqual([
      expect.stringContaining('Leo'), expect.stringContaining('Scott'),
    ])
    expect(items[0].textContent).toContain('corrects #1')
    expect(items[0].textContent).toContain('conversation c1 · time fixed')
    expect(items[1].textContent).toContain('proposal p1')
    expect(log.querySelectorAll('input, textarea, button')).toHaveLength(0)

    // ALMNC-69.2：依發起的夥伴篩選（全部／出現過的發起者）。
    const filter = [...container.querySelectorAll('select')].find(el => el.closest('label')?.textContent?.includes(m.activityFilter))!
    expect([...filter.options].map(option => option.textContent)).toEqual([m.activityFilterAll, 'Leo · Secretary', 'Scott'])
    await act(async () => {
      filter.value = 'leo'
      filter.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect([...container.querySelectorAll(`ol[aria-label="${m.activity}"] li`)].map(item => item.textContent)).toEqual([expect.stringContaining('Leo')])
    await act(async () => {
      filter.value = ''
      filter.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.querySelectorAll(`ol[aria-label="${m.activity}"] li`)).toHaveLength(2)

    // soul.md：Scott 直接存。
    await act(async () => setValue(area(m.soul), 'new soul'))
    await act(async () => save(m.soul).click())
    expect(db.writeAgentMemory).toHaveBeenCalledWith('scott', agents[0], 'soul', 'new soul')
    expect(container.textContent).toContain(m.saved)

    // 換角色會載入那個角色的記憶。
    const select = container.querySelector('select')!
    await act(async () => {
      select.value = 'leo'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(area(m.soul).value).toContain('本名：Leo')
    await act(async () => setValue(area(m.workNotes), 'no morning meetings'))
    await act(async () => save(m.workNotes).click())
    expect(db.writeAgentMemory).toHaveBeenLastCalledWith('scott', agents[1], 'work_notes', 'no morning meetings')

    // 目前脈絡：超過上限在畫面上就擋下。
    await act(async () => setValue(area(m.weeklyFocus), 'a\nb\nc\nd\ne\nf'))
    await act(async () => save(m.context).click())
    expect(db.saveSharedContext).not.toHaveBeenCalled()
    expect(container.textContent).toContain(m.tooManyFocus)
    await act(async () => setValue(area(m.weeklyFocus), 'V3 | [[V3]]'))
    await act(async () => save(m.context).click())
    expect(db.saveSharedContext).toHaveBeenCalledWith('scott', {
      projects: [{ title: 'Almanac', link: '[[Almanac]]' }], weeklyFocus: [{ title: 'V3', link: '[[V3]]' }], people: [],
    })

    // Scott 的偏好。
    await act(async () => setValue(area(m.preferences), 'Short summaries'))
    await act(async () => save(m.preferences).click())
    expect(db.saveScottPreferences).toHaveBeenCalledWith('scott', 'Short summaries')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

// Fork（almanac ALMNC-69.9）：每筆有對應操作的紀錄附「復原」（同一批 2 筆以上是「撤回這次整理」）；有後續變更時出比較卡，
// 選「仍要復原」才帶 force 再做一次；復原後重新讀紀錄（新的一筆 undone）。
it('shows undo buttons for recent ops, the compare card on a later change, and batch undo', async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  const m = en.agents.memory
  const c = en.ops.compare
  const entry = (id: number, opId: string | null, over: Partial<ActivityEntry> = {}): ActivityEntry => ({
    id, at: id * 1000, actorId: 'scott', actorRole: 'scott', action: 'linked', targetLink: 'note:20%20領域/時間管理.md',
    source: { kind: 'proposal', ref: opId ? `op:${opId}` : 'p1' }, note: `entry ${id}`, correctsId: null, archivedAt: null, opId, ...over,
  })
  const log = [
    entry(4, 'op-batch', { actorId: 'mia', actorRole: 'commander', action: 'accepted', source: { kind: 'proposal', ref: 'collect:1:2' } }),
    entry(3, 'op-single'),
    entry(2, 'op-old'),
    entry(1, null),
  ]
  db.getAgentMemory.mockImplementation(async () => ({ soul: doc('s'), rules: doc('r'), workNotes: doc('') }))
  db.getSharedContext.mockResolvedValue({ projects: [], weeklyFocus: [], people: [], updatedAt: 1, updatedBy: 'scott' })
  db.listActivity.mockResolvedValue(log)
  db.getScottPreferences.mockResolvedValue({ content: '', updatedAt: 1 })
  ops.opUiStates.mockResolvedValue(new Map<string, unknown>([
    ['op-batch', { state: 'undoable', batchId: 'batch-1', batchSize: 3 }],
    ['op-single', { state: 'undoable', batchSize: 1 }],
    ['op-old', { state: 'expired', batchSize: 0 }],
  ]))
  const current = '- [[後來加的]]\n- [[新筆記]]'
  const restored = '- [[後來加的]]'
  ops.undoOp.mockResolvedValueOnce({ status: 'conflict', ops: [], files: [{ path: '20 領域/時間管理.md', restored, current, changed: true }] })
  ops.undoBatch.mockResolvedValueOnce({ status: 'undone', ops: [] })

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const items = () => [...container.querySelectorAll(`ol[aria-label="${m.activity}"] li`)]
  const button = (li: Element, label: string) => [...li.querySelectorAll('button')].find(btn => btn.textContent === label)
  try {
    await act(async () => root.render(React.createElement(AgentMemorySettings, { agents })))
    expect(ops.opUiStates).toHaveBeenCalledWith(['op-batch', 'op-single', 'op-old'])
    const [batchRow, singleRow, oldRow, plainRow] = items()
    expect(button(batchRow, m.undoBatch)).toBeTruthy()
    expect(button(batchRow, m.undo)).toBeUndefined()
    expect(button(singleRow, m.undo)).toBeTruthy()
    expect(singleRow.textContent).toContain(m.sourceDirect)
    expect(oldRow.querySelector('button')).toBeNull()
    expect(plainRow.querySelector('button')).toBeNull()

    // 有後續變更：不覆蓋，出比較卡（還原後／目前並排）。
    await act(async () => button(singleRow, m.undo)!.click())
    expect(ops.undoOp).toHaveBeenLastCalledWith('op-single', { force: false })
    const card = container.querySelector(`[role="dialog"][aria-label="${c.title}"]`)!
    expect(card).toBeTruthy()
    expect(card.querySelector('[data-side="restored"]')!.textContent).toBe('- [[後來加的]]')
    expect(card.querySelector('[data-side="current"]')!.textContent).toBe('- [[後來加的]]- [[新筆記]]')
    expect(card.querySelector('[data-side="current"] [data-changed]')!.textContent).toBe('- [[新筆記]]')
    expect(card.textContent).toContain(c.changed)

    // 取消：比較卡收起，什麼都沒寫。
    await act(async () => button(card, c.cancel)!.click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    // 再按一次、選「仍要復原」→ force。
    ops.undoOp.mockResolvedValueOnce({ status: 'conflict', ops: [], files: [{ path: '20 領域/時間管理.md', restored, current, changed: true }] })
    ops.undoOp.mockResolvedValueOnce({ status: 'undone', ops: [] })
    await act(async () => button(items()[1], m.undo)!.click())
    db.listActivity.mockClear()
    await act(async () => button(container.querySelector('[role="dialog"]')!, c.confirm)!.click())
    expect(ops.undoOp).toHaveBeenLastCalledWith('op-single', { force: true })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain(m.undoDone)
    expect(db.listActivity).toHaveBeenCalled()

    // 撤回這次整理：整批。
    await act(async () => button(items()[0], m.undoBatch)!.click())
    expect(ops.undoBatch).toHaveBeenCalledWith('batch-1', { force: false })
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

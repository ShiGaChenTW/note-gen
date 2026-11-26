// Fork（almanac ALMNC-84.7）：設定頁活動紀錄顯示外部 MCP 顧問操作、客戶端名稱、來源與發起者篩選（純 ARIA + renderV3）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderV3 } from '@/test/render-v3'
import type { ActivityActor, ActivityEntry } from '@/lib/agent-memory'
import type { AgentSettings as SavedAgent } from '@/lib/agents/settings'

const db = vi.hoisted(() => ({
  getAgentMemory: vi.fn(),
  writeAgentMemory: vi.fn(async () => ({ status: 'saved' as const })),
  getSharedContext: vi.fn(),
  saveSharedContext: vi.fn(async () => {}),
  listActivity: vi.fn(),
  listActivityActors: vi.fn<() => Promise<ActivityActor[]>>(async () => []),
  getScottPreferences: vi.fn(),
  saveScottPreferences: vi.fn(async () => {}),
}))

vi.mock('@/db/agent-memory', () => db)

vi.mock('@/lib/ops/runtime', () => ({
  opUiStates: vi.fn(async () => new Map()),
  undoOp: vi.fn(),
  undoBatch: vi.fn(),
}))

vi.mock('@/lib/ops/domain-undo-runtime', () => ({
  proposalExpertForTarget: vi.fn(async () => null),
  removeProposalExpert: vi.fn(),
}))

const { AgentMemorySettings } = await import('./agent-memory-settings')

const agents: SavedAgent[] = [
  { id: 'leo', name: 'Leo', role: 'secretary', enabled: true, allowedTools: [], createdAt: 1, updatedAt: 1 },
]

describe('AgentMemorySettings advisor activity (ALMNC-84.7)', () => {
  const entries = [
    {
      id: 10,
      at: 5000,
      actorId: 'mcp:Claude Code',
      actorRole: 'advisor',
      action: 'deleted',
      targetLink: 'note:Projects/draft.md',
      source: { kind: 'mcp', ref: 'note_delete' },
      note: '',
      correctsId: null,
      archivedAt: null,
    },
    {
      id: 9,
      at: 4000,
      actorId: 'mcp:Claude Code',
      actorRole: 'advisor',
      action: 'updated',
      targetLink: 'note:Projects/spec.md',
      source: { kind: 'mcp', ref: 'note_update' },
      note: '',
      correctsId: null,
      archivedAt: null,
    },
    {
      id: 8,
      at: 3000,
      actorId: 'leo',
      actorRole: 'secretary',
      action: 'created',
      targetLink: 'task:9',
      source: { kind: 'conversation', ref: 'c1' },
      note: '新增會議',
      correctsId: null,
      archivedAt: null,
    },
  ] as unknown as ActivityEntry[]

  beforeEach(() => {
    vi.clearAllMocks()
    db.getAgentMemory.mockResolvedValue({
      soul: { content: 'soul', updatedAt: 1, updatedBy: 'scott', isTemplate: false },
      rules: { content: 'rules', updatedAt: 1, updatedBy: 'scott', isTemplate: false },
      workNotes: { content: '', updatedAt: null, updatedBy: null, isTemplate: false },
    })
    db.getSharedContext.mockResolvedValue({ projects: [], weeklyFocus: [], people: [], updatedAt: 1, updatedBy: 'scott' })
    db.getScottPreferences.mockResolvedValue({ content: '', updatedAt: 1 })
    db.listActivityActors.mockResolvedValue([
      { actorId: 'mcp:Claude Code', actorRole: 'advisor' as ActivityActor['actorRole'] },
      { actorId: 'leo', actorRole: 'secretary' },
    ])
    db.listActivity.mockImplementation(async (options?: { actorId?: string }) =>
      options?.actorId ? entries.filter(item => item.actorId === options.actorId) : entries)
  })

  it('顯示外部 MCP 顧問操作與來源，並可依顧問篩選活動紀錄', async () => {
    const { user } = renderV3(<AgentMemorySettings agents={agents} />)

    const list = await screen.findByRole('list', { name: '活動紀錄' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)

    expect(items[0]).toHaveTextContent('Claude Code')
    expect(items[0]).toHaveTextContent('顧問')
    expect(items[0]).toHaveTextContent('刪除')
    expect(items[0]).toHaveTextContent('note:Projects/draft.md')
    expect(items[0]).toHaveTextContent('外部 MCP note_delete')

    expect(items[1]).toHaveTextContent('Claude Code')
    expect(items[1]).toHaveTextContent('修改')
    expect(items[1]).toHaveTextContent('note:Projects/spec.md')
    expect(items[1]).toHaveTextContent('外部 MCP note_update')

    const filter = screen.getByRole('combobox', { name: /發起的夥伴/ })
    expect(within(filter).getByRole('option', { name: 'Claude Code · 顧問' })).toBeInTheDocument()

    await user.selectOptions(filter, 'mcp:Claude Code')
    expect(db.listActivity).toHaveBeenLastCalledWith({ limit: 50, actorId: 'mcp:Claude Code' })

    const filteredItems = within(screen.getByRole('list', { name: '活動紀錄' })).getAllByRole('listitem')
    expect(filteredItems).toHaveLength(2)
    expect(filteredItems.every(item => item.textContent?.includes('Claude Code'))).toBe(true)
  })
})

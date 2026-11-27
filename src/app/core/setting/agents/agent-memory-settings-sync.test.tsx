// Fork（almanac ALMNC-85.3）：活動紀錄跨裝置——標出另一台寫的紀錄（5A：每筆標裝置）、另一台還沒同步的對話、
// 另一台的操作在這台還找不到時提示「等同步完成再復原」（85.3 #3），找得到就能直接復原。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderV3 } from '@/test/render-v3'
import type { ActivityEntry } from '@/lib/agent-memory'
import type { AgentSettings as SavedAgent } from '@/lib/agents/settings'

const db = vi.hoisted(() => ({
  getAgentMemory: vi.fn(),
  writeAgentMemory: vi.fn(async () => ({ status: 'saved' as const })),
  getSharedContext: vi.fn(),
  saveSharedContext: vi.fn(async () => {}),
  listActivity: vi.fn(),
  listActivityActors: vi.fn(async () => []),
  getScottPreferences: vi.fn(),
  saveScottPreferences: vi.fn(async () => {}),
}))
const ops = vi.hoisted(() => ({ opUiStates: vi.fn(), undoOp: vi.fn(), undoBatch: vi.fn() }))

vi.mock('@/db/agent-memory', () => db)
vi.mock('@/lib/ops/runtime', () => ops)
vi.mock('@/lib/ops/domain-undo-runtime', () => ({ proposalExpertForTarget: vi.fn(async () => null), removeProposalExpert: vi.fn() }))
vi.mock('@/lib/almanac-sync/runtime', () => ({
  getAlmanacSyncStatus: vi.fn(async () => ({
    enabled: true,
    deviceId: 'dev-a',
    devices: { devices: { 'dev-a': { name: 'Mac Studio', lastSeenAt: 1 }, 'dev-b': { name: 'MacBook', lastSeenAt: 1 } } },
  })),
}))

const { AgentMemorySettings } = await import('./agent-memory-settings')

const agents: SavedAgent[] = [{ id: 'mia', name: 'Mia', role: 'commander', enabled: true, allowedTools: [], createdAt: 1, updatedAt: 1 }]

const entry = (id: number, extra: Partial<ActivityEntry>): ActivityEntry => ({
  id, at: 1000 * id, actorId: 'scott', actorRole: 'scott', action: 'updated', targetLink: 'note:a.md',
  source: { kind: 'proposal', ref: 'op:x' }, note: '', correctsId: null, archivedAt: null, ...extra,
} as ActivityEntry)

describe('AgentMemorySettings 活動紀錄跨裝置（ALMNC-85.3）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.getAgentMemory.mockResolvedValue({
      soul: { content: '', updatedAt: null, updatedBy: null, isTemplate: true },
      rules: { content: '', updatedAt: null, updatedBy: null, isTemplate: true },
      workNotes: { content: '', updatedAt: null, updatedBy: null, isTemplate: false },
    })
    db.getSharedContext.mockResolvedValue({ projects: [], weeklyFocus: [], people: [], updatedAt: null, updatedBy: null })
    db.getScottPreferences.mockResolvedValue({ content: '', updatedAt: null })
    db.listActivity.mockResolvedValue([
      entry(4, { opId: 'op-b-ready', originDevice: 'dev-b', note: 'B 改的（操作已到）' }),
      entry(3, { opId: 'op-b-missing', originDevice: 'dev-b', note: 'B 改的（操作還沒到）' }),
      entry(2, { action: 'instructed', source: { kind: 'conversation', ref: 'conv:sync-8' }, originDevice: 'dev-b' }),
      entry(1, { opId: 'op-a', originDevice: 'dev-a', note: '這台改的' }),
    ])
    ops.opUiStates.mockResolvedValue(new Map([
      ['op-b-ready', { state: 'undoable', batchSize: 1 }],
      ['op-a', { state: 'undoable', batchSize: 1 }],
    ]))
    ops.undoOp.mockResolvedValue({ status: 'undone', ops: [] })
  })

  it('另一台的紀錄標出裝置名稱；這台的不標', async () => {
    renderV3(<AgentMemorySettings agents={agents} />)
    const items = within(await screen.findByRole('list', { name: '活動紀錄' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('來自 MacBook')
    expect(items[3]).not.toHaveTextContent('來自')
  })

  it('另一台還沒同步到這台的對話：顯示「另一台的對話（尚未同步）」', async () => {
    renderV3(<AgentMemorySettings agents={agents} />)
    const items = within(await screen.findByRole('list', { name: '活動紀錄' })).getAllByRole('listitem')
    expect(items[2]).toHaveTextContent('另一台的對話（尚未同步）')
    expect(items[2]).not.toHaveTextContent('conv:sync-8')
  })

  it('另一台的操作已到：可以在這台復原；還沒到：提示等同步完成再復原、沒有復原按鈕', async () => {
    const { user } = renderV3(<AgentMemorySettings agents={agents} />)
    const items = within(await screen.findByRole('list', { name: '活動紀錄' })).getAllByRole('listitem')
    expect(within(items[1]).queryByRole('button', { name: '復原' })).not.toBeInTheDocument()
    expect(await within(items[1]).findByText('另一台的操作，等同步完成再復原')).toBeInTheDocument()
    await user.click(await within(items[0]).findByRole('button', { name: '復原' }))
    expect(ops.undoOp).toHaveBeenCalledWith('op-b-ready', { force: false })
  })
})

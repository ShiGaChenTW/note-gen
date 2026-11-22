/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  v3: true,
  mobile: false,
  getMemory: vi.fn(async () => ({ rules: { content: 'Original' } })),
  appendNotes: vi.fn(async () => {}),
  mergeContext: vi.fn(async () => {}),
  writeMemory: vi.fn(async () => {}),
  addProposals: vi.fn(),
  hydrate: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
}))

vi.mock('@/lib/fork-ui', () => ({ isUiV3: () => fake.v3 }))
vi.mock('@/lib/check', () => ({ isMobileDevice: () => fake.mobile }))
vi.mock('@/db/agent-memory', () => ({
  getAgentMemory: fake.getMemory, appendAgentWorkNotes: fake.appendNotes, mergeSharedContext: fake.mergeContext, writeAgentMemory: fake.writeMemory,
}))
vi.mock('@/stores/collect', () => ({ default: { getState: () => fake } }))

import { rememberCompletedRoleWork } from './runtime'

const expert = { id: 'e', role: 'expert', name: 'Alex' } as const
const work = { request: 'Keep citations short', result: 'Summary and citations', reference: 'conversation:1#2', conversationId: 1, fromScott: true }

beforeEach(() => {
  fake.v3 = true
  fake.mobile = false
  vi.clearAllMocks()
})

afterEach(() => vi.unstubAllGlobals())

describe('completed work in the app', () => {
  it.each([
    ['zh-TW', '修改 Alex 的 rules.md'], ['zh', '修改 Alex 的 rules.md'], ['en', 'Update Alex’s rules.md'],
  ])('publishes a localized rules proposal to the workbench in %s without writing rules', async (locale, title) => {
    vi.stubGlobal('localStorage', { getItem: () => locale })
    await rememberCompletedRoleWork(expert, work, async () => JSON.stringify({
      workNotes: ['Keep citations short'], rulesProposal: 'Keep citations short.',
    }))
    expect(fake.appendNotes).toHaveBeenCalledWith({ agentId: 'e', role: 'expert' }, expert, ['Keep citations short'])
    expect(fake.hydrate).toHaveBeenCalled()
    expect(fake.addProposals).toHaveBeenCalledWith('rules:e:conversation:1#2', 'Alex', [
      expect.objectContaining({
        title, memoryEdits: [{ target: 'rules', agent: expert, baseContent: 'Original', content: 'Keep citations short.', summary: title }],
      }),
    ], { conversationId: 1 })
    expect(fake.persist).toHaveBeenCalled()
    expect(fake.writeMemory).not.toHaveBeenCalled()
  })

  it.each(['classic', 'mobile'])('skips memory extraction in %s', async mode => {
    fake.v3 = mode !== 'classic'
    fake.mobile = mode === 'mobile'
    const ask = vi.fn(async () => '{}')
    await rememberCompletedRoleWork(expert, work, ask)
    expect(ask).not.toHaveBeenCalled()
    expect(fake.getMemory).not.toHaveBeenCalled()
  })
})

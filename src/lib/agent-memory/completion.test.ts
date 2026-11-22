import { describe, expect, it, vi } from 'vitest'
import { applyMemoryLearning, learnFromCompletedWork } from './completion'

const expert = { id: 'e', name: 'Alex', role: 'expert' } as const
const commander = { id: 'c', name: 'Mia', role: 'commander' } as const

function memory() {
  return {
    appendWorkNotes: vi.fn(async () => {}),
    mergeContext: vi.fn(async () => {}),
    readRules: vi.fn(async () => 'Old rules'),
    submitRules: vi.fn(async () => {}),
  }
}

describe('completed V3 role work', () => {
  it('merges confirmed context as the commander and stores only role-specific work notes', async () => {
    const io = memory()
    await applyMemoryLearning(commander, {
      projects: [{ title: 'Almanac', link: 'source:one' }], people: ['Scott'],
      workNotes: ['Scott prefers links in commander reviews.'],
    }, { reference: 'source:one', request: 'Active project Almanac, recurring collaborator Scott', fromScott: true }, io)
    expect(io.mergeContext).toHaveBeenCalledWith({ agentId: 'c', role: 'commander' }, {
      projects: [{ title: 'Almanac', link: 'source:one' }], weeklyFocus: [], people: ['Scott'],
    })
    expect(io.appendWorkNotes).toHaveBeenCalledWith({ agentId: 'c', role: 'commander' }, commander, ['Scott prefers links in commander reviews.'])
  })

  it('only appends to the expert’s own notes and submits rules to the workbench', async () => {
    const io = memory()
    await applyMemoryLearning(expert, { people: ['Scott'], workNotes: ['Include sources.'], rulesProposal: 'New rules' }, { reference: 'task:1' }, io)
    expect(io.mergeContext).not.toHaveBeenCalled()
    expect(io.appendWorkNotes).toHaveBeenCalledWith({ agentId: 'e', role: 'expert' }, expert, ['Include sources.'])
    expect(io.submitRules).toHaveBeenCalledWith(expert, {
      kind: 'rules-change', agentId: 'e', proposedBy: 'e', before: 'Old rules', after: 'New rules',
    })
  })

  it('does not promote an external document or invented names into shared context', async () => {
    const io = memory()
    const response = { projects: [{ title: 'Invented' }], people: ['Bob'], weeklyFocus: [{ title: 'Launch' }] }
    await learnFromCompletedWork(commander, { reference: 'source:attachment', result: 'Launch and Bob', request: 'Launch and Bob' }, {
      ask: async () => JSON.stringify(response), io,
    })
    expect(io.mergeContext).not.toHaveBeenCalled()
    await learnFromCompletedWork(commander, {
      reference: 'conversation:1#2', request: 'Launch is the weekly focus', result: 'Noted', fromScott: true,
    }, { ask: async () => JSON.stringify(response), io })
    expect(io.mergeContext).toHaveBeenCalledExactlyOnceWith({ agentId: 'c', role: 'commander' }, {
      projects: [], people: [], weeklyFocus: [{ title: 'Launch', link: 'conversation:1#2' }],
    })
  })

  it('ignores empty learning and an unchanged rules proposal', async () => {
    const io = memory()
    await applyMemoryLearning(expert, { workNotes: [' ', null], rulesProposal: 'Old rules' }, { reference: 'task:1' }, io)
    expect(io.appendWorkNotes).not.toHaveBeenCalled()
    expect(io.mergeContext).not.toHaveBeenCalled()
    expect(io.submitRules).not.toHaveBeenCalled()
  })
})

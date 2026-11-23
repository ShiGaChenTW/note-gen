// Fork（almanac ALMNC-54.12）：三種發現時機（新筆記寫入、親手寫的筆記、定期檢查）＋確認卡「交給指揮官」的重新確認。
// 所有觀察進佇列，等每週依 MOC 整理。
import { describe, expect, it, vi } from 'vitest'
import type { ProposalBatch } from '@/lib/commander/types'
import { createV3Note, parseV3Note } from '@/lib/v3-model/note'
import { checkNote, periodicCheck, recheckNote, type CheckDeps } from './check'
import type { CleanupLabels } from './plan'
import { memoryQueue } from './queue'
import type { ConflictDetector, ConflictObservation } from './types'

const labels: CleanupLabels = {
  action: action => action,
  bundleTitle: ({ domain, count }) => `整理「${domain}」：${count} 項`,
  singleTitle: ({ action, title }) => `${action}：${title}`,
  item: ({ action, evidence }) => `- ${action}：${evidence}`,
  origin: ({ agent }) => `${agent} 整理的清理提案`,
  confirmTitle: ({ title }) => `仍然有效：${title}`,
  confirmBody: ({ evidence }) => `沒問題 ${evidence}`,
}

const files = new Map<string, string>([
  ['k/new.md', createV3Note({ title: '節拍 45 秒', type: 'knowledge', domains: ['ie'], status: 'valid' }, '節拍時間是 45 秒。\n')],
  ['k/old.md', createV3Note({ title: '節拍 60 秒', type: 'knowledge', domains: ['ie'], status: 'valid', lastConfirmed: '2025-01-01' }, '節拍時間是 60 秒。\n')],
  ['k/dup.md', createV3Note({ title: '節拍定義', type: 'knowledge', domains: ['ie'], status: 'valid' }, '節拍＝可用時間÷需求。\n')],
  ['k/gone.md', createV3Note({ title: '舊的', type: 'knowledge', status: 'archived' }, '舊\n')],
  ['inbox/hand.md', createV3Note({ title: '親手寫的', tags: ['親手寫的'] }, '節拍時間是 50 秒。\n')],
])

function setup(found: (note: string) => ConflictObservation[], extra: Partial<CheckDeps> = {}) {
  const submitted: ProposalBatch[] = []
  const queue = memoryQueue()
  const similar = vi.fn<CheckDeps['similar']>(async (_domain, _query, exclude) =>
    ['k/old.md', 'k/dup.md', 'k/new.md'].filter(path => !exclude.includes(path)).map(path => ({ path, title: path })))
  const detect = vi.fn<ConflictDetector>(async (note, _candidates, options) => found(note.path).map(observation => ({ ...observation, trigger: options.trigger, domainId: options.domainId })))
  const deps: CheckDeps = {
    readNote: async path => files.get(path) ?? null,
    similar,
    detect,
    domains: async () => [{ id: 'ie', name: '工業工程', overview: '# 工業工程\n' }],
    expertFor: async domainId => (domainId === 'ie' ? { agentId: 'exp_ie', prompt: '# 工業工程專家' } : undefined),
    commanderPrompt: async () => '# 指揮官',
    submit: async batch => { submitted.push(batch) },
    queue,
    labels,
    commanderName: 'Mia',
    now: () => new Date(2026, 10, 21, 10),
    ...extra,
  }
  return { deps, submitted, queue, similar, detect }
}

const contradiction: ConflictObservation = { type: 'contradiction', notePaths: ['k/new.md', 'k/old.md'], evidence: '45 秒 vs 60 秒', trigger: 'written' }
const duplicate: ConflictObservation = { type: 'duplicate', notePaths: ['k/dup.md', 'k/new.md'], evidence: '同一件事', trigger: 'written' }

describe('checkNote', () => {
  it('after a note is written: the domain expert compares, all observations wait for the weekly card', async () => {
    const { deps, submitted, queue, detect } = setup(() => [contradiction, { ...contradiction, type: 'outdated' }, duplicate])
    const result = await checkNote('k/new.md', 'written', deps)
    expect(detect.mock.calls[0][1].map(note => note.path)).toEqual(['k/old.md', 'k/dup.md'])
    expect(detect.mock.calls[0][2]).toMatchObject({ trigger: 'written', domainId: 'ie', agentPrompt: '# 工業工程專家', by: { role: 'expert', agentId: 'exp_ie' } })
    expect(result.deferred.map(entry => entry.type)).toEqual(['contradiction', 'outdated', 'duplicate'])
    expect(submitted).toEqual([])
    expect(queue.items()).toEqual(result.deferred)
  })

  it('a hand-written note without a domain is compared across all domains by the commander', async () => {
    const { deps, similar, detect, submitted } = setup(() => [])
    const result = await checkNote('inbox/hand.md', 'handwritten', deps)
    expect(result.status).toBe('checked')
    expect(similar.mock.calls[0][0]).toBeUndefined()
    expect(similar.mock.calls[0][3]).toEqual({ allDomains: true })
    expect(detect.mock.calls[0][2]).toMatchObject({ trigger: 'handwritten', agentPrompt: '# 指揮官', by: { role: 'commander' } })
    expect(submitted).toEqual([])
  })

  it('skips missing, superseded and archived notes', async () => {
    const { deps, detect } = setup(() => [contradiction])
    expect(await checkNote('k/none.md', 'written', deps)).toMatchObject({ status: 'skipped', reason: 'not_found' })
    expect(await checkNote('k/gone.md', 'written', deps)).toMatchObject({ status: 'skipped', reason: 'inactive' })
    expect(detect).not.toHaveBeenCalled()
  })

  it('periodic check runs over the due notes with the periodic trigger, oldest first and limited', async () => {
    const { deps, detect, submitted } = setup(path => (path === 'k/old.md' ? [{ ...contradiction, notePaths: ['k/old.md', 'k/new.md'] }] : []))
    const results = await periodicCheck(['k/old.md', 'k/dup.md', 'k/new.md'], deps, { limit: 2 })
    expect(results).toHaveLength(2)
    expect(detect.mock.calls.map(call => [call[0].path, call[2].trigger])).toEqual([['k/old.md', 'periodic'], ['k/dup.md', 'periodic']])
    expect(results[0].deferred).toHaveLength(1)
    expect(submitted).toEqual([])
  })
})

describe('recheckNote（確認卡「交給指揮官」）', () => {
  it('looks up external evidence and queues observations for weekly review', async () => {
    const lookup = vi.fn(async () => [{ title: '新版標準', url: 'https://example.com', snippet: '45 秒' }])
    const { deps, detect, submitted, queue } = setup(() => [duplicate], { lookup })
    await recheckNote('k/old.md', deps)
    expect(lookup).toHaveBeenCalledWith('節拍 60 秒')
    expect(detect.mock.calls[0][2].external).toHaveLength(1)
    expect(submitted).toEqual([])
    expect(queue.items()).toHaveLength(1)
  })

  it('proposes "still valid" when nothing is wrong, even if the lookup fails', async () => {
    const { deps, submitted } = setup(() => [], { lookup: async () => { throw new Error('web search off') } })
    const result = await recheckNote('k/old.md', deps)
    expect(result.batch?.proposals[0]).toMatchObject({ title: '仍然有效：節拍 60 秒', card: { verb: 'confirm' } })
    expect(parseV3Note(submitted[0].proposals[0].edits![0].content).fields.lastConfirmed).toBe('2026-11-21')
  })
})

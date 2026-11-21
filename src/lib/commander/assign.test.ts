import { describe, expect, it } from 'vitest'
import type { Domain } from '@/lib/v3-model/domain'
import { assign, resolveDomain } from './assign'
import type { Fragment, RosterAgent } from './types'

const roster: RosterAgent[] = [
  { id: 'cmd', name: 'Mia', role: 'commander', enabled: true },
  { id: 'sec', name: 'Leo', role: 'secretary', enabled: true },
  { id: 'ie', name: 'Alex', role: 'expert', domain: '工業工程', enabled: true },
  { id: 'off', name: 'Old', role: 'expert', domain: '園藝', enabled: false },
]
const domains: Domain[] = [
  { id: 'd-eng', name: '工程', overview: '', createdAt: 0, updatedAt: 0 },
  { id: 'd-ie', name: '工業工程', parentId: 'd-eng', overview: '', createdAt: 0, updatedAt: 0 },
  { id: 'd-cook', name: '料理', overview: '', createdAt: 0, updatedAt: 0 },
]
const frag = (partial: Partial<Fragment>): Fragment => ({ index: 0, kind: 'note', title: 't', body: '', people: [], tags: [], ...partial })

describe('assign', () => {
  it('有專家的領域知識 → C1 那位專家', () => {
    const [a] = assign([frag({ noteType: 'knowledge', domainHint: '工業工程' })], roster, domains)
    expect(a).toMatchObject({ lane: 'C1', agentId: 'ie', domainId: 'd-ie' })
  })

  it('領域用完整路徑或不同大小寫、空白也對得到', () => {
    const [a] = assign([frag({ noteType: 'knowledge', domainHint: '工程 > 工業工程' })], roster, domains)
    expect(a).toMatchObject({ lane: 'C1', agentId: 'ie', domainId: 'd-ie' })
  })

  it('領域表還沒建，但專家的領域文字對得上 → 仍交給專家', () => {
    const [a] = assign([frag({ noteType: 'knowledge', domainHint: '工業工程' })], roster, [])
    expect(a).toMatchObject({ lane: 'C1', agentId: 'ie' })
    expect(a.domainId).toBeUndefined()
  })

  it('有領域但沒有專家、沒有領域、專家停用 → C2 指揮官撰寫', () => {
    const out = assign([
      frag({ index: 0, noteType: 'knowledge', domainHint: '料理' }),
      frag({ index: 1, noteType: 'knowledge' }),
      frag({ index: 2, noteType: 'knowledge', domainHint: '園藝' }),
    ], roster, domains)
    expect(out.map(a => [a.lane, a.agentId, a.domainId])).toEqual([
      ['C2', 'cmd', 'd-cook'],
      ['C2', 'cmd', undefined],
      ['C2', 'cmd', undefined],
    ])
  })

  it('紀錄筆記、專案筆記 → C2 指揮官；行程、任務 → C3 秘書；不採用 → 不撰寫', () => {
    const out = assign([
      frag({ index: 0, noteType: 'record', domainHint: '工業工程' }),
      frag({ index: 1, noteType: 'project' }),
      frag({ index: 2, kind: 'event', date: '2026-11-25', time: '10:00' }),
      frag({ index: 3, kind: 'task' }),
      frag({ index: 4, kind: 'reject' }),
    ], roster, domains)
    expect(out.map(a => [a.lane, a.agentId])).toEqual([
      ['C2', 'cmd'], ['C2', 'cmd'], ['C3', 'sec'], ['C3', 'sec'], ['reject', undefined],
    ])
  })

  it('名單裡沒有秘書時仍分到 C3（照 lane 撰寫）', () => {
    const [a] = assign([frag({ kind: 'task' })], roster.filter(r => r.role !== 'secretary'), domains)
    expect(a).toMatchObject({ lane: 'C3' })
    expect(a.agentId).toBeUndefined()
  })
})

describe('resolveDomain', () => {
  it('比 id、名稱、路徑', () => {
    expect(resolveDomain('d-cook', domains)?.id).toBe('d-cook')
    expect(resolveDomain('  料理 ', domains)?.id).toBe('d-cook')
    expect(resolveDomain('工程 › 工業工程', domains)?.id).toBe('d-ie')
    expect(resolveDomain('不存在', domains)).toBeUndefined()
    expect(resolveDomain(undefined, domains)).toBeUndefined()
  })
})

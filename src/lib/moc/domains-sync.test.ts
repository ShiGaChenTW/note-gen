import { describe, expect, it } from 'vitest'
import { planDomainsTableSync } from './domains-sync'

const PARENT = 'M-20261104-014500-A57V'
const CHILD = 'M-20261112-060012-VPB3'

describe('planDomainsTableSync', () => {
  it('inserts MOCs missing from the table (id = M id), parents first', () => {
    const plan = planDomainsTableSync([
      { id: CHILD, name: '時間管理', parent: PARENT },
      { id: PARENT, name: '個人效能' },
    ], [])
    expect(plan.inserts).toEqual([{ id: PARENT, name: '個人效能' }, { id: CHILD, name: '時間管理', parentId: PARENT }])
    expect(plan.updates).toEqual([])
  })

  it('matches old dom_ rows by name, syncs parent and keeps rows without a MOC as orphans', () => {
    const plan = planDomainsTableSync([
      { id: PARENT, name: '個人效能' },
      { id: CHILD, name: '時間管理', parent: PARENT },
    ], [
      { id: 'dom_p', name: '個人效能' },
      { id: 'dom_c', name: '時間管理', parentId: null },
      { id: 'dom_old', name: '還沒遷移' },
    ])
    expect(plan.inserts).toEqual([])
    expect(plan.updates).toEqual([{ id: 'dom_c', parentId: 'dom_p' }])
    expect(plan.orphans).toEqual([{ id: 'dom_old', name: '還沒遷移' }])
  })

  it('renames a row matched by M id, and skips MOCs without an M id yet', () => {
    const plan = planDomainsTableSync([{ id: PARENT, name: '效能' }, { name: '沒編號', path: '20 領域/沒編號.md' }], [{ id: PARENT, name: '個人效能' }])
    expect(plan.updates).toEqual([{ id: PARENT, name: '效能' }])
    expect(plan.skipped).toEqual(['20 領域/沒編號.md'])
  })
})

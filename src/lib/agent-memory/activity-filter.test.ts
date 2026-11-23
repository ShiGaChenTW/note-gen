// Fork（almanac ALMNC-69.2）：活動紀錄依發起的夥伴篩選。
import { describe, expect, it } from 'vitest'
import { activityActors, filterActivityByActor } from './activity-filter'

const entries = [
  { id: 4, actorId: 's-1', actorRole: 'secretary' as const },
  { id: 3, actorId: 'scott', actorRole: 'scott' as const },
  { id: 2, actorId: 'c-1', actorRole: 'commander' as const },
  { id: 1, actorId: 's-1', actorRole: 'secretary' as const },
]

describe('activity filter by actor', () => {
  it('lists each actor once, newest first', () => {
    expect(activityActors(entries)).toEqual([
      { actorId: 's-1', actorRole: 'secretary' },
      { actorId: 'scott', actorRole: 'scott' },
      { actorId: 'c-1', actorRole: 'commander' },
    ])
    expect(activityActors([])).toEqual([])
  })

  it('keeps only the chosen actor; an empty choice keeps everything', () => {
    expect(filterActivityByActor(entries, 's-1').map(entry => entry.id)).toEqual([4, 1])
    expect(filterActivityByActor(entries, '').map(entry => entry.id)).toEqual([4, 3, 2, 1])
    expect(filterActivityByActor(entries, 'nobody')).toEqual([])
  })
})

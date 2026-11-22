// Fork（almanac ALMNC-54.1，AC#6）：不採用的資料源滿 30 天自動封存，絕不刪除。
// 時鐘、讀取、寫回、計時器全是假的；邊界是「剛好 30 天」。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARCHIVE_SWEEP_INTERVAL_MS, createArchiveScheduler, sweepRejectedSources, type ArchiveSweepDeps } from './archive-sweep'
import { createSource, REJECTED_ARCHIVE_AFTER_MS, searchSources, transitionSource, type Source } from './source'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 9, 1)

function rejected(id: string, rejectedAt: number, content = id): Source {
  const created = createSource({ id, sourceType: 'external', kind: 'text', content, collector: 'scott' }, rejectedAt - DAY)
  return transitionSource(created, 'rejected', rejectedAt)
}

function harness(initial: Source[], now: number) {
  const rows = new Map(initial.map(source => [source.id, source]))
  const saves: Source[] = []
  const clock = { now }
  const deps: ArchiveSweepDeps = {
    now: () => clock.now,
    listRejected: async () => [...rows.values()].filter(source => source.status === 'rejected' && source.archivedAt === undefined),
    save: async source => {
      saves.push(source)
      rows.set(source.id, source)
    },
  }
  return { rows, saves, clock, deps }
}

afterEach(() => vi.restoreAllMocks())

describe('不採用滿 30 天自動封存', () => {
  it('30 天的長度是 30 × 24 小時', () => {
    expect(REJECTED_ARCHIVE_AFTER_MS).toBe(30 * DAY)
  })

  it('邊界：差 1 毫秒滿 30 天還不封存，剛好 30 天就封存', async () => {
    const { rows, deps, clock } = harness([rejected('a', T0)], T0 + 30 * DAY - 1)
    expect(await sweepRejectedSources(deps)).toEqual([])
    expect(rows.get('a')?.archivedAt).toBeUndefined()
    clock.now = T0 + 30 * DAY
    expect(await sweepRejectedSources(deps)).toEqual(['a'])
    expect(rows.get('a')?.archivedAt).toBe(T0 + 30 * DAY)
  })

  it('封存只設 archivedAt：狀態、內容、版本都不變', async () => {
    const original = rejected('a', T0, '原文不能變')
    const { rows, deps } = harness([original], T0 + 31 * DAY)
    await sweepRejectedSources(deps)
    const after = rows.get('a')!
    expect(after).toMatchObject({ status: 'rejected', content: '原文不能變', version: 1, statusChangedAt: T0 })
    expect(after.archivedAt).toBe(T0 + 31 * DAY)
  })

  it('只封存不採用的：待分析、已分析、等你決定都不動', async () => {
    const waiting = createSource({ id: 'w', sourceType: 'external', kind: 'text', content: 'w', collector: 'scott' }, T0)
    const pending = createSource({ id: 'p', sourceType: 'self', kind: 'text', content: 'p', collector: 'scott' }, T0)
    const analyzed = transitionSource(transitionSource(pending, 'analyzing', T0), 'analyzed', T0)
    const { rows, saves, deps } = harness([waiting, pending, analyzed, rejected('r', T0)], T0 + 90 * DAY)
    // 假的 listRejected 只回不採用的；就算誤傳進其他狀態，掃描也不會封存它們
    deps.listRejected = async () => [waiting, pending, { ...analyzed, id: 'z' }, rows.get('r')!]
    expect(await sweepRejectedSources(deps)).toEqual(['r'])
    expect(saves.map(source => source.id)).toEqual(['r'])
  })

  it('不採用的時間從「進入不採用」那一刻算，不是收集時間', async () => {
    const created = createSource({ id: 'a', sourceType: 'external', kind: 'text', content: 'a', collector: 'scott' }, T0)
    const later = transitionSource(created, 'rejected', T0 + 40 * DAY)
    const { rows, deps } = harness([later], T0 + 60 * DAY)
    expect(await sweepRejectedSources(deps)).toEqual([])
    expect(rows.get('a')?.archivedAt).toBeUndefined()
  })

  it('冪等：已封存的不再被選中，封存時間不會被改', async () => {
    const { rows, saves, deps, clock } = harness([rejected('a', T0), rejected('b', T0 + 10 * DAY)], T0 + 30 * DAY)
    expect(await sweepRejectedSources(deps)).toEqual(['a'])
    clock.now = T0 + 35 * DAY
    expect(await sweepRejectedSources(deps)).toEqual([])
    expect(rows.get('a')?.archivedAt).toBe(T0 + 30 * DAY)
    clock.now = T0 + 40 * DAY
    expect(await sweepRejectedSources(deps)).toEqual(['b'])
    expect(saves).toHaveLength(2)
  })

  it('絕不刪除：掃描前後資料源的數量不變（依賴裡根本沒有刪除）', async () => {
    const { rows, deps } = harness([rejected('a', T0), rejected('b', T0), rejected('c', T0 + 20 * DAY)], T0 + 365 * DAY)
    expect(Object.keys(deps).sort()).toEqual(['listRejected', 'now', 'save'])
    await sweepRejectedSources(deps)
    expect([...rows.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect([...rows.values()].every(source => source.archivedAt !== undefined)).toBe(true)
  })

  it('封存後仍搜尋得到（原文、來處、形式）', async () => {
    const { rows, deps } = harness([rejected('a', T0, '報價單 Q4 預算'), rejected('b', T0, '別的東西')], T0 + 31 * DAY)
    await sweepRejectedSources(deps)
    const found = searchSources([...rows.values()], '預算')
    expect(found.map(source => source.id)).toEqual(['a'])
    expect(found[0].archivedAt).toBeDefined()
    expect(searchSources([...rows.values()], '  ')).toHaveLength(2)
  })
})

describe('封存排程：開 App 掃一次，之後每天一次', () => {
  function timers() {
    const registered: Array<{ fn: () => void, ms: number }> = []
    return {
      registered,
      setInterval: (fn: () => void, ms: number) => { registered.push({ fn, ms }); return registered.length },
      clearInterval: vi.fn(),
    }
  }

  it('啟動時馬上掃一次、計時器是一天；重複啟動不會開第二個計時器', async () => {
    const t = timers()
    const sweep = vi.fn(async () => [] as string[])
    const scheduler = createArchiveScheduler({ sweep, ...t })
    await scheduler.start()
    await scheduler.start()
    expect(sweep).toHaveBeenCalledTimes(1)
    expect(t.registered).toHaveLength(1)
    expect(t.registered[0].ms).toBe(ARCHIVE_SWEEP_INTERVAL_MS)
    expect(ARCHIVE_SWEEP_INTERVAL_MS).toBe(DAY)
  })

  it('每天到點再掃一次；封存了東西才通知畫面重讀', async () => {
    const t = timers()
    const sweep = vi.fn(async () => [] as string[])
    const onArchived = vi.fn()
    const scheduler = createArchiveScheduler({ sweep, onArchived, ...t })
    await scheduler.start()
    sweep.mockResolvedValueOnce(['a'])
    t.registered[0].fn()
    await vi.waitFor(() => expect(onArchived).toHaveBeenCalledWith(['a']))
    expect(sweep).toHaveBeenCalledTimes(2)
    t.registered[0].fn()
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(3))
    expect(onArchived).toHaveBeenCalledTimes(1)
  })

  it('掃描失敗只記一筆、不丟錯，下一輪照常；停止後可以重新啟動', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const t = timers()
    const sweep = vi.fn(async () => [] as string[])
    sweep.mockRejectedValueOnce(new Error('db locked'))
    const scheduler = createArchiveScheduler({ sweep, ...t })
    await expect(scheduler.start()).resolves.toEqual([])
    t.registered[0].fn()
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(2))
    scheduler.stop()
    expect(t.clearInterval).toHaveBeenCalledTimes(1)
    expect(scheduler.started).toBe(false)
    await scheduler.start()
    expect(t.registered).toHaveLength(2)
  })
})

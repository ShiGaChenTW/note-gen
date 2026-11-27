// Fork（almanac ALMNC-85.2）：設計 6 風險 6——「開著的記憶體 store 在下載後把舊值寫回去」。
// V3 同步套用遠端資料時，RSS 訂閱、收集項目、提案紀錄都經過記憶體 store（唯一寫入者）：
// 畫面立即更新，之後本機的存檔帶著同步來的內容，不會把下載前的舊值寫回 store.json。
// 資料源分頁另外讀 note.db，套用後由 installAlmanacSyncReloaders 重讀；主力裝置另外叫指揮官分析。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async (key: string) => structuredClone(disk.get(key))),
      set: vi.fn(async (key: string, value: unknown) => { disk.set(key, structuredClone(value)) }),
      delete: vi.fn(async (key: string) => { disk.delete(key) }),
      save: vi.fn(async () => undefined),
    })),
  },
}))
vi.mock('@/lib/almanac-sync/notify', () => ({ notifyAlmanacLocalChange: vi.fn() }))

const { default: useRssStore } = await import('@/lib/source-import/rss-store')
const { default: useProposalTrailStore } = await import('@/stores/proposals')
const { appFeedsAccess, appProposalsAccess, installAlmanacSyncReloaders } = await import('./app')
const { createFeed } = await import('@/lib/source-import/rss-feeds')
const { default: emitter } = await import('@/lib/emitter')

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  disk.clear()
})

describe('套用遠端後記憶體 store 立即更新，不會把舊值寫回（風險 6）', () => {
  it('RSS：同步改了 seen 與名稱，之後排程或暫停存檔仍帶著同步的內容', async () => {
    disk.set('almanacRssFeeds', [createFeed({ id: 'rss_1', url: 'https://f.example/feed', name: 'Old', now: 1 })])
    useRssStore.setState({ feeds: [], ready: false })
    await useRssStore.getState().load()

    await appFeedsAccess.update(feeds => feeds.map(feed => ({ ...feed, name: 'Synced', named: true, seen: ['remote-1'] })))
    expect(useRssStore.getState().feeds[0]).toMatchObject({ name: 'Synced', seen: ['remote-1'] })

    // 本機之後的寫入（排程抓完、Scott 按暫停）是在同步後的值上改的。
    await useRssStore.getState().updateFeed('rss_1', feed => ({ ...feed, seen: ['local-2', ...feed.seen] }))
    await useRssStore.getState().setPaused('rss_1', true)
    await flush()
    expect(disk.get('almanacRssFeeds')).toEqual([expect.objectContaining({ name: 'Synced', paused: true, seen: ['local-2', 'remote-1'] })])
  })

  it('RSS：「保留」記下時間（晚於刪除），救回也算一次修改', async () => {
    disk.set('almanacRssFeeds', [createFeed({ id: 'rss_1', url: 'https://f.example/feed', name: 'Blog', now: 1 })])
    useRssStore.setState({ feeds: [], ready: false })
    await useRssStore.getState().load()
    await useRssStore.getState().keep('rss_1')
    expect(useRssStore.getState().feeds[0].keptAt).toBeGreaterThan(1)
    const feed = useRssStore.getState().feeds[0]
    await useRssStore.getState().remove('rss_1')
    await useRssStore.getState().restore({ ...feed, updatedAt: 1 }, 0)
    expect(useRssStore.getState().feeds[0].updatedAt).toBeGreaterThan(1)
  })

  it('提案：同步來的收集項目與提案紀錄直接進記憶體 store，之後本機存檔不會蓋掉', async () => {
    const { default: useCollectStore } = await import('@/stores/collect')
    disk.set('collectItems', [])
    disk.set('proposalTrail', {})
    await appProposalsAccess.apply({
      items: {
        upserts: [{
          id: 'commander:S-1', createdAt: Date.now(), input: { kind: 'text', text: '', name: 'Mia' }, state: 'ready', source: 'ai',
          proposals: [{ id: 'p1', kind: 'note', title: 'From A', body: '', due: '', time: '', tags: [], status: 'wait', sourceIds: ['S-1'] }],
        }],
        deletes: [],
      },
      trail: { upserts: { 'collect:commander:S-1:p1': { conversationSyncId: 'conv-1' } }, deletes: [] },
      weekly: { add: ['moc:M-1:2026-W48'], remove: [] },
      cleanup: { upserts: [], deletes: [] },
    })
    expect(useCollectStore.getState().items.map(item => item.id)).toContain('commander:S-1')
    expect(useProposalTrailStore.getState().trail['collect:commander:S-1:p1']).toEqual({ conversationSyncId: 'conv-1' })

    // 本機放棄另一則、存檔：同步來的項目還在。
    useCollectStore.getState().reject('commander:S-1', 'p1')
    await useCollectStore.getState().persist()
    const saved = disk.get('collectItems') as Array<{ id: string, proposals: Array<{ status: string }> }>
    expect(saved.find(item => item.id === 'commander:S-1')?.proposals[0].status).toBe('no')
    expect(disk.get('almanacWeeklyMocCards')).toEqual(['moc:M-1:2026-W48'])

    const snapshot = await appProposalsAccess.load()
    expect(snapshot.items.find(item => item.id === 'commander:S-1')?.proposals[0]).toMatchObject({ status: 'no', sourceIds: ['S-1'] })
  })
})

describe('installAlmanacSyncReloaders', () => {
  it('資料源有變動：重讀資料源分頁；主力裝置另外叫指揮官分析', async () => {
    const deps = { refreshSources: vi.fn(async () => undefined), isPrimary: vi.fn(async () => true), kickCommander: vi.fn(async () => undefined) }
    const stop = installAlmanacSyncReloaders(deps)
    emitter.emit('almanac-sync-applied', { tables: ['sources', 'feeds'] })
    await flush()
    expect(deps.refreshSources).toHaveBeenCalledTimes(1)
    expect(deps.kickCommander).toHaveBeenCalledTimes(1)
    stop()
  })

  it('不是主力裝置：只重讀，不叫指揮官；只有 RSS／提案變動時不必重讀資料源', async () => {
    const deps = { refreshSources: vi.fn(async () => undefined), isPrimary: vi.fn(async () => false), kickCommander: vi.fn(async () => undefined) }
    const stop = installAlmanacSyncReloaders(deps)
    emitter.emit('almanac-sync-applied', { tables: ['feeds', 'proposals'] })
    await flush()
    expect(deps.refreshSources).not.toHaveBeenCalled()
    emitter.emit('almanac-sync-applied', { tables: ['sources'] })
    await flush()
    expect(deps.refreshSources).toHaveBeenCalledTimes(1)
    expect(deps.kickCommander).not.toHaveBeenCalled()
    stop()
  })
})

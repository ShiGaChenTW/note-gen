// Fork（almanac ALMNC-85.2）：把資料源群組的同步表接進 App（note.db、useRssStore、useCollectStore、useProposalTrailStore、store.json）。
// 註冊順序就是同步順序（設計 2.2）：先資料源桶、再 feeds.json、最後 proposals.json——文章先到、seen 後到；提案指向的資料源先到。
// 套用遠端後：記憶體 store 已經由 access 直接更新（唯一寫入者）；資料源分頁另外重讀，主力裝置再叫指揮官分析新到的待分析資料源。
'use client'

import emitter from '@/lib/emitter'
import { registerAlmanacSyncTable } from './registry'
import { createSourcesTable, SOURCES_SYNC_TABLE } from './sources'
import { createFeedsTable, type FeedsAccess } from './feeds'
import { createProposalsTable, type PortableAwaiting, type ProposalsAccess, type SyncAsideEntry, type SyncAwaitingEntry, type SyncCollectItem } from './proposals'
import { createCrewTable } from './crew'
import { createActivityTable } from './activity'
import { createOpsTable } from './ops'
import { createMocTables, SCOTT_PINS_SYNC_TABLE } from './moc'

const WEEKLY_MOC_KEY = 'almanacWeeklyMocCards'
/** 85.4：另一台的等你回話、這台還沒有那段對話時先記在這裡（裝置層級，不經設定同步）。 */
export const AWAITING_REMOTE_KEY = 'almanacAwaitingRemote'

async function appStore() {
  const { Store } = await import('@tauri-apps/plugin-store')
  const store = await Store.load('store.json')
  return {
    get: (key: string) => store.get(key),
    set: async (key: string, value: unknown) => {
      await store.set(key, value)
      await store.save()
    },
  }
}

export const appFeedsAccess: FeedsAccess = {
  async load() {
    const { default: useRssStore } = await import('@/lib/source-import/rss-store')
    await useRssStore.getState().load()
    return useRssStore.getState().feeds
  },
  async update(mutator) {
    const { default: useRssStore } = await import('@/lib/source-import/rss-store')
    await useRssStore.getState().applySync(mutator)
  },
  onPendingChanged() {
    emitter.emit('pending-sync-deletions-changed')
  },
}

export const appProposalsAccess: ProposalsAccess = {
  async load() {
    const [{ default: useCollectStore }, { default: useProposalTrailStore }, { serializeItems }, { sanitizeQueued, queuedKey, CLEANUP_QUEUE_KEY }] = await Promise.all([
      import('@/stores/collect'),
      import('@/stores/proposals'),
      import('@/lib/collect/persist'),
      import('@/lib/cleanup/queue'),
    ])
    const [{ default: useWorkbenchStore }, { default: useAwaitingRepliesStore }] = await Promise.all([
      import('@/stores/workbench'),
      import('@/stores/awaiting-replies'),
    ])
    await Promise.all([
      useCollectStore.getState().hydrate(),
      useProposalTrailStore.getState().hydrate(),
      useWorkbenchStore.getState().hydrateAside(),
      useAwaitingRepliesStore.getState().hydrate(),
    ])
    const store = await appStore()
    const weekly = await store.get(WEEKLY_MOC_KEY)
    const awaitingRemote = await store.get(AWAITING_REMOTE_KEY)
    return {
      aside: { ...useWorkbenchStore.getState().aside } as Record<string, SyncAsideEntry>,
      awaiting: { ...useAwaitingRepliesStore.getState().map } as Record<string, SyncAwaitingEntry>,
      awaitingRemote: awaitingRemote && typeof awaitingRemote === 'object' ? awaitingRemote as Record<string, PortableAwaiting> : {},
      items: serializeItems(useCollectStore.getState().items) as unknown as SyncCollectItem[],
      trail: { ...useProposalTrailStore.getState().trail },
      weeklySent: Array.isArray(weekly) ? weekly.filter((key): key is string => typeof key === 'string') : [],
      cleanup: sanitizeQueued(await store.get(CLEANUP_QUEUE_KEY)).map(observation => ({
        key: queuedKey(observation),
        observation: observation as unknown as Record<string, unknown>,
      })),
    }
  },
  async apply(change) {
    const [{ default: useCollectStore }, { default: useProposalTrailStore }, { applySyncedQueue }] = await Promise.all([
      import('@/stores/collect'),
      import('@/stores/proposals'),
      import('@/lib/cleanup/queue'),
    ])
    await useCollectStore.getState().applySync({ upserts: change.items.upserts as never, deletes: change.items.deletes })
    await useProposalTrailStore.getState().applySync(change.trail)
    // 85.4：先放著、等你回話也經記憶體 store 寫（它們的訂閱負責存檔），之後本機存檔不會把同步來的蓋回去（設計 6 風險 6）。
    const [{ default: useWorkbenchStore }, { default: useAwaitingRepliesStore }] = await Promise.all([
      import('@/stores/workbench'),
      import('@/stores/awaiting-replies'),
    ])
    const aside = change.aside ?? { upserts: {}, deletes: [] }
    const awaiting = change.awaiting ?? { upserts: [], deletes: [], remote: {} }
    if (Object.keys(aside.upserts).length || aside.deletes.length) {
      await useWorkbenchStore.getState().hydrateAside()
      useWorkbenchStore.setState(state => {
        const next = { ...state.aside, ...aside.upserts }
        for (const key of aside.deletes) delete next[key]
        return { aside: next }
      })
    }
    if (awaiting.upserts.length || awaiting.deletes.length) {
      await useAwaitingRepliesStore.getState().hydrate()
      useAwaitingRepliesStore.setState(state => {
        const map = { ...state.map }
        for (const entry of awaiting.upserts) map[String(entry.conversationId)] = entry
        for (const id of awaiting.deletes) delete map[String(id)]
        return { map }
      })
    }
    const store = await appStore()
    if (Object.keys(awaiting.remote).length) {
      const current = await store.get(AWAITING_REMOTE_KEY)
      const remote: Record<string, PortableAwaiting> = current && typeof current === 'object' ? { ...current as Record<string, PortableAwaiting> } : {}
      for (const [syncId, value] of Object.entries(awaiting.remote)) {
        if (value) remote[syncId] = value
        else delete remote[syncId]
      }
      await store.set(AWAITING_REMOTE_KEY, remote)
    }
    if (change.weekly.add.length) {
      const current = await store.get(WEEKLY_MOC_KEY)
      const sent = new Set(Array.isArray(current) ? current.filter((key): key is string => typeof key === 'string') : [])
      for (const key of change.weekly.add) sent.add(key)
      await store.set(WEEKLY_MOC_KEY, [...sent])
    }
    await applySyncedQueue(store, {
      upserts: change.cleanup.upserts.map(entry => entry.observation) as never,
      deletes: change.cleanup.deletes,
    })
  },
}

async function ensureAppSourceSchema(): Promise<void> {
  const [{ initV3SourceDb }, { initSourceJudgementDb }, { initLegacyPackDb }] = await Promise.all([
    import('@/db/v3-sources'),
    import('@/db/v3-source-judgements'),
    import('@/db/v3-legacy-packs'),
  ])
  await initV3SourceDb()
  await initSourceJudgementDb()
  await initLegacyPackDb()
}

/** Fork（almanac ALMNC-85.3）：夥伴、記憶、脈絡、偏好與活動紀錄的表——經各自模組的初始化建立（含舊表升級）。 */
async function ensureAppCrewSchema(): Promise<void> {
  const [{ listAgentSettings }, { getSharedContext }] = await Promise.all([import('@/db/agents'), import('@/db/agent-memory')])
  await listAgentSettings()
  await getSharedContext()
}

async function runAppTransaction(statements: Array<{ sql: string; values: Array<string | number | null>; expectedRows?: number }>): Promise<void> {
  const { executeRecordTransaction } = await import('@/db/index')
  await executeRecordTransaction(statements)
}

let registered = false

/**
 * 註冊 85.2 的三張表與 85.3 的三張表（重複呼叫沒事）。runtime 每輪同步前呼叫。
 * 85.3 的順序：夥伴（crew.json）→ 活動紀錄 → ops。活動紀錄的發起者 id 靠夥伴的別名換算；ops 跟著活動紀錄到，畫面才找得到能復原的操作。
 */
export function registerAlmanacAppTables(): void {
  if (registered) return
  registered = true
  registerAlmanacSyncTable(createSourcesTable({ ensureSchema: ensureAppSourceSchema }))
  registerAlmanacSyncTable(createFeedsTable(appFeedsAccess))
  registerAlmanacSyncTable(createProposalsTable(appProposalsAccess))
  registerAlmanacSyncTable(createCrewTable({
    ensureSchema: ensureAppCrewSchema,
    onPendingChanged: () => emitter.emit('pending-sync-deletions-changed'),
    onConflictsChanged: () => emitter.emit('almanac-sync-conflicts-changed', undefined),
  }))
  registerAlmanacSyncTable(createActivityTable({ ensureSchema: ensureAppCrewSchema, runTransaction: runAppTransaction }))
  registerAlmanacSyncTable(createOpsTable())
  // 85.4：MOC 上次已知狀態、版面位置、Scott 指定、提案建立的專家（筆記庫層）。放在 ops 後面：Scott 指定與專家指向的操作先到。
  for (const table of createMocTables()) registerAlmanacSyncTable(table)
}

export interface AlmanacReloadDeps {
  refreshSources(): Promise<void>
  isPrimary(): Promise<boolean>
  kickCommander(): Promise<void>
  /** 85.4：Scott 指定同步進來後，畫面用的快取重讀 */
  reloadScottPins?(): Promise<void>
}

const defaultReloadDeps: AlmanacReloadDeps = {
  refreshSources: async () => (await import('@/lib/workbench/actions')).refreshSources(),
  isPrimary: async () => (await import('../runtime')).isThisDeviceAlmanacPrimary(),
  kickCommander: async () => (await import('@/lib/workbench/actions')).kickCommander({ manual: true }),
  reloadScottPins: async () => { await (await import('@/lib/moc/scott-pins-runtime')).loadScottPins() },
}

/**
 * 套用遠端資料後要重新載入的畫面（設計 6 風險 6）。RSS 訂閱與提案已由 access 直接寫進記憶體 store；
 * 資料源分頁是另外讀 note.db 的快照，這裡重讀。主力裝置另外叫指揮官跑一輪：別台新增的待分析資料源在這裡分析（第 8 節 1A）。
 * 回傳取消訂閱。
 */
export function installAlmanacSyncReloaders(deps: AlmanacReloadDeps = defaultReloadDeps): () => void {
  const handler = (payload: { tables: string[] }) => {
    if (payload.tables.includes(SCOTT_PINS_SYNC_TABLE) && deps.reloadScottPins) {
      void deps.reloadScottPins().catch(error => console.warn('[almanac-sync] reload scott pins failed:', error))
    }
    if (!payload.tables.includes(SOURCES_SYNC_TABLE)) return
    void (async () => {
      await deps.refreshSources()
      if (await deps.isPrimary()) await deps.kickCommander()
    })().catch(error => console.warn('[almanac-sync] reload after sync failed:', error))
  }
  emitter.on('almanac-sync-applied', handler)
  return () => emitter.off('almanac-sync-applied', handler)
}

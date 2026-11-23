// Fork（almanac ALMNC-69.10）：MOC 的「上次已知狀態」（note.db 的 moc_snapshots）。Obsidian 手動編輯 MOC 時，拿它和現在的檔案比對收錄差異。
// 新表，用 create table if not exists 建立（同 ops、id_index 的延遲初始化），對舊資料庫安全、可重跑。
// 以工作區隔離（同 ops）：換了筆記庫就是另一組上次已知狀態。path＝'' 那一列是「已經建過基準」的記號（沒有 MOC 時也要記得）。
// 流程在 src/lib/moc/reconcile-runtime.ts，判斷在 src/lib/moc/reconcile.ts。
import { getDb } from './index'
import type { MocBaseline } from '@/lib/moc/reconcile'

let initialized: Promise<void> | null = null

export function initMocSnapshotsDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists moc_snapshots (
          workspace text not null default '',
          path text not null,
          moc_id text,
          content text not null,
          updated_at integer not null,
          primary key (workspace, path)
        )
      `)
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

async function currentWorkspace(): Promise<string> {
  const { default: useSettingStore } = await import('@/stores/setting')
  return useSettingStore.getState().workspacePath ?? ''
}

export interface MocSnapshotStore {
  /** 全部上次已知狀態；initialized＝這個筆記庫建過基準。 */
  load: () => Promise<{ initialized: boolean, baselines: Map<string, MocBaseline> }>
  /** 寫入（path → 內容；null＝刪掉那一列），並記下已建過基準。 */
  save: (entries: ReadonlyMap<string, MocBaseline | null>) => Promise<void>
}

export function createMocSnapshotStore(workspace: () => Promise<string> | string = currentWorkspace): MocSnapshotStore {
  return {
    load: async () => {
      await initMocSnapshotsDb()
      const db = await getDb()
      const rows = await db.select<Array<{ path: string, mocId: string | null, content: string }>>(
        'select path, moc_id as mocId, content from moc_snapshots where workspace = $1',
        [await workspace()],
      )
      const baselines = new Map<string, MocBaseline>()
      for (const row of rows) if (row.path) baselines.set(row.path, { content: row.content, ...(row.mocId ? { mocId: row.mocId } : {}) })
      return { initialized: rows.length > 0, baselines }
    },
    save: async entries => {
      await initMocSnapshotsDb()
      const db = await getDb()
      const scope = await workspace()
      const now = Date.now()
      const upsert = `insert into moc_snapshots (workspace, path, moc_id, content, updated_at) values ($1, $2, $3, $4, $5)
        on conflict(workspace, path) do update set moc_id = excluded.moc_id, content = excluded.content, updated_at = excluded.updated_at`
      await db.execute(upsert, [scope, '', null, '', now])
      for (const [path, baseline] of entries) {
        if (!path) continue
        if (baseline === null) await db.execute('delete from moc_snapshots where workspace = $1 and path = $2', [scope, path])
        else await db.execute(upsert, [scope, path, baseline.mocId ?? null, baseline.content, now])
      }
    },
  }
}

export const mocSnapshotStore = createMocSnapshotStore()

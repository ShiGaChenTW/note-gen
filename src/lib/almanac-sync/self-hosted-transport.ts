// Fork（almanac ALMNC-85.5）：把 self-hosted-remote.ts 接到 App 裡真的自架同步（Tauri、note.db、自架 runtime）。
// 帳號層 → 個人資料工作區（account-data）；筆記庫層 → 綁定到目前筆記庫的 library 工作區（設計 1.1）。
// 沒有對應的綁定（還沒連線、目前筆記庫沒綁 library）時回 null，engine 跳過該層的表並記在報告裡。
//
// 讀：自架 runtime 收件時，所有收到的物件連同 revision 都會存進 self_hosted_remote_objects（runtime.ts applyRemoteEventRaw），
//     almanac 物件不會被 applyStructuredPayload 套用（不認得的 domain 直接略過），只留在快取。
// 寫：直接送 upsert-object（不經 outbox），因為 engine 需要同步拿到「成功／被搶先」的結果才能決定重合併。
import type { AlmanacRemote } from './remote'
import { createSelfHostedAlmanacRemote, isNewerOrSameRevision, type AlmanacSelfHostedWorkspace } from './self-hosted-remote'

interface BindingRow {
  workspaceId: string
  profileId: string
  workspaceType: 'account-data' | 'library'
  localRoot: string | null
  syncEpoch: string | null
  appliedSequence: string
}

function normalizeRoot(value: string) {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

async function findBinding(workspaceType: 'account-data' | 'library'): Promise<BindingRow | null> {
  const { getDb } = await import('@/db/index')
  const database = await getDb()
  const rows = await database.select<BindingRow[]>(
    `select b.workspace_id as workspaceId, b.profile_id as profileId, b.workspace_type as workspaceType,
       b.local_root as localRoot, b.sync_epoch as syncEpoch, coalesce(c.applied_sequence, '0') as appliedSequence
     from self_hosted_workspace_bindings b
     join self_hosted_sync_profiles p on p.id = b.profile_id and p.state = 'connected'
     left join self_hosted_cursors c on c.workspace_id = b.workspace_id
     where b.workspace_type = $1 and b.binding_state = 'bound'
     order by b.created_at`,
    [workspaceType],
  )
  if (workspaceType === 'account-data') return rows[0] ?? null
  const { getCurrentWorkspaceRoot } = await import('@/lib/self-hosted-sync/workspaces')
  const root = normalizeRoot(await getCurrentWorkspaceRoot())
  return rows.find(row => row.localRoot && normalizeRoot(row.localRoot) === root) ?? null
}

function workspaceFor(binding: BindingRow): AlmanacSelfHostedWorkspace {
  return {
    workspaceId: binding.workspaceId,
    cache: {
      async get(objectId) {
        const { getDb } = await import('@/db/index')
        const rows = await (await getDb()).select<Array<{ revision: string; payload: string }>>(
          'select revision, payload from self_hosted_remote_objects where workspace_id = $1 and object_id = $2 limit 1',
          [binding.workspaceId, objectId],
        )
        if (!rows[0]) return null
        return { revision: String(rows[0].revision), payload: JSON.parse(rows[0].payload) as Record<string, unknown> }
      },
      async put(objectId, revision, payload) {
        const { getDb } = await import('@/db/index')
        const database = await getDb()
        const current = await database.select<Array<{ revision: string }>>(
          'select revision from self_hosted_remote_objects where workspace_id = $1 and object_id = $2 limit 1',
          [binding.workspaceId, objectId],
        )
        if (!isNewerOrSameRevision(revision, current[0]?.revision)) return
        await database.execute(
          `insert into self_hosted_remote_objects(workspace_id, object_id, kind, revision, payload, updated_at)
           values ($1, $2, 'setting', $3, $4, $5)
           on conflict(workspace_id, object_id) do update set
             kind = excluded.kind, revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at`,
          [binding.workspaceId, objectId, revision, JSON.stringify(payload), Date.now()],
        )
      },
    },
    async objectIdFor(localKey) {
      const { structuredObjectId } = await import('@/lib/self-hosted-sync/crypto')
      return structuredObjectId(binding.workspaceId, 'setting', localKey)
    },
    async writeSession() {
      const [{ authenticatedClient }, { ensureManagedWorkspaceKeys }, { encryptJson, loadWorkspaceKey }] = await Promise.all([
        import('@/lib/self-hosted-sync/profile'),
        import('@/lib/self-hosted-sync/workspaces'),
        import('@/lib/self-hosted-sync/crypto'),
      ])
      const { client } = await authenticatedClient(binding.profileId)
      const session = await client.syncSession(binding.workspaceId, binding.appliedSequence, binding.syncEpoch ?? undefined)
      if (!session.protocol.compatible) throw new Error('SELF_HOSTED_PROTOCOL_INCOMPATIBLE: almanac')
      const keyVersions = session.keyVersions.map(key => key.keyVersion)
      await ensureManagedWorkspaceKeys(binding.profileId, binding.workspaceId, keyVersions)
      const keyVersion = Math.max(1, ...keyVersions)
      const key = await loadWorkspaceKey(binding.workspaceId, keyVersion)
      return {
        client,
        syncEpoch: session.syncEpoch,
        keyVersion,
        encrypt: async (payload, associatedData) => encryptJson(key, payload, associatedData),
      }
    },
    async refresh() {
      await refreshSelfHostedRemoteObjects()
    },
  }
}

/** 喚醒自架 runtime 收件，等它跑完（別台寫的 almanac 物件就會在快取裡） */
export async function refreshSelfHostedRemoteObjects(): Promise<void> {
  const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
  await getSelfHostedSyncRuntime().wake('almanac-sync')
}

export interface SelfHostedAlmanacRemotes {
  account: AlmanacRemote | null
  library: AlmanacRemote | null
}

export async function createSelfHostedAlmanacRemotes(): Promise<SelfHostedAlmanacRemotes> {
  const [account, library] = await Promise.all([findBinding('account-data'), findBinding('library')])
  return {
    account: account ? createSelfHostedAlmanacRemote(workspaceFor(account)) : null,
    library: library ? createSelfHostedAlmanacRemote(workspaceFor(library)) : null,
  }
}

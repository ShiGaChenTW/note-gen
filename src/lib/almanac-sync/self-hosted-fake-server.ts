// Fork（almanac ALMNC-85.5）：假的自架同步伺服器（note-gen-server 的最小契約），給契約測試與雙裝置模擬用。App 不會 import。
//
// 依 client（src/lib/self-hosted-sync/client.ts、protocol.ts、runtime.ts 的 pushOutbox／收件）實際用到的行為實作：
//   - POST /sync/commands：expectedSyncEpoch 要對；upsert-object 的欄位要齊；種類只收既有的 SyncObjectKind（未知種類 rejected）；
//     baseRevision 跟目前 revision 不同 → { status: 'conflict', code: 'revision_conflict' }；同一個 commandId 重送回同一個結果（duplicate）。
//   - GET /sync/events：依 sequence 往後翻頁，事件帶 sourceDeviceId、ciphertext、metadata.kind／revision。
// 加密用可逆的假加密，但會檢查 AAD（物件 id＋種類），送錯物件 id 或種類會解不開。
import type { SyncCommandResult, SyncEvent, SyncEventsPage, SyncObjectKind } from '@/lib/self-hosted-sync/protocol'
import type {
  CachedSelfHostedObject, EncryptedObjectPayload, SelfHostedCommandClient, SelfHostedObjectCache,
} from './self-hosted-remote'
import { isNewerOrSameRevision } from './self-hosted-remote'
import { isAlmanacSelfHostedPayload } from './self-hosted'
import { hashString } from './hash'

const KNOWN_KINDS: SyncObjectKind[] = [
  'note', 'folder', 'asset', 'canvas', 'tag', 'mark', 'conversation', 'message', 'memory', 'setting', 'yjs-checkpoint', 'yjs-update',
]

export function fakeEncrypt(payload: Record<string, unknown>, associatedData: string): EncryptedObjectPayload {
  const packedCiphertext = Buffer.from(JSON.stringify({ aad: associatedData, payload }), 'utf8').toString('base64url')
  return { packedCiphertext, packedCiphertextHash: hashString(packedCiphertext) }
}

export function fakeDecrypt(packedCiphertext: string, associatedData: string): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(packedCiphertext, 'base64url').toString('utf8')) as { aad: string; payload: Record<string, unknown> }
  if (parsed.aad !== associatedData) throw new Error('fake decrypt: associated data mismatch')
  return parsed.payload
}

interface ServerObject {
  kind: SyncObjectKind
  revision: number
  ciphertext: string
  keyVersion: number
}

interface FakeWorkspace {
  syncEpoch: string
  objects: Map<string, ServerObject>
  events: SyncEvent[]
  results: Map<string, SyncCommandResult>
}

export interface FakeSelfHostedServer {
  createWorkspace(workspaceId: string, syncEpoch?: string): void
  /** 某台裝置的連線（伺服器從 access token 知道是哪台；這裡直接指定） */
  clientFor(deviceId: string): SelfHostedCommandClient & {
    events(workspaceId: string, after: string, limit: number, expectedSyncEpoch: string): Promise<SyncEventsPage>
  }
  object(workspaceId: string, objectId: string): ServerObject | undefined
  commandLog: Array<{ deviceId: string; workspaceId: string; command: Record<string, unknown>; result: SyncCommandResult }>
  /** 下一個送到這個物件的指令被處理前先執行（模擬另一台搶先寫入） */
  beforeNextCommand(objectId: string, action: () => Promise<void>): void
}

function epochMismatch(): Error {
  const error = new Error('SELF_HOSTED_API_ERROR: HTTP 409 sync_epoch_mismatch') as Error & { status: number; code: string }
  error.status = 409
  error.code = 'sync_epoch_mismatch'
  return error
}

function invalidCommand(command: Record<string, unknown>): string | null {
  if (typeof command.commandId !== 'string' || !command.commandId) return 'invalid_command_id'
  if (command.type !== 'upsert-object') return 'unsupported_command'
  if (typeof command.objectId !== 'string' || !command.objectId) return 'invalid_object_id'
  if (!KNOWN_KINDS.includes(command.kind as SyncObjectKind)) return 'unsupported_kind'
  if (command.baseRevision !== null && typeof command.baseRevision !== 'string') return 'invalid_base_revision'
  if (!Number.isSafeInteger(command.keyVersion) || (command.keyVersion as number) < 1) return 'invalid_key_version'
  if (typeof command.ciphertext !== 'string' || typeof command.ciphertextHash !== 'string') return 'invalid_ciphertext'
  if (!Array.isArray(command.blobRefs)) return 'invalid_blob_refs'
  if (command.parentObjectId !== null && command.parentObjectId !== undefined && typeof command.parentObjectId !== 'string') return 'invalid_parent'
  return null
}

export function createFakeSelfHostedServer(): FakeSelfHostedServer {
  const workspaces = new Map<string, FakeWorkspace>()
  const hooks = new Map<string, () => Promise<void>>()
  let sequence = 0
  const commandLog: FakeSelfHostedServer['commandLog'] = []
  const workspaceOf = (id: string) => {
    const workspace = workspaces.get(id)
    if (!workspace) throw new Error(`SELF_HOSTED_API_ERROR: HTTP 404 workspace ${id}`)
    return workspace
  }

  return {
    commandLog,
    createWorkspace(workspaceId, syncEpoch = 'epoch-1') {
      workspaces.set(workspaceId, { syncEpoch, objects: new Map(), events: [], results: new Map() })
    },
    object(workspaceId, objectId) {
      return workspaceOf(workspaceId).objects.get(objectId)
    },
    beforeNextCommand(objectId, action) {
      hooks.set(objectId, action)
    },
    clientFor(deviceId) {
      return {
        async pushCommands(workspaceId, commands, expectedSyncEpoch) {
          const workspace = workspaceOf(workspaceId)
          if (expectedSyncEpoch !== workspace.syncEpoch) throw epochMismatch()
          const results: SyncCommandResult[] = []
          for (const raw of commands as Array<Record<string, unknown>>) {
            const objectId = typeof raw.objectId === 'string' ? raw.objectId : ''
            const hook = hooks.get(objectId)
            if (hook) {
              hooks.delete(objectId)
              await hook()
            }
            const commandId = String(raw.commandId ?? '')
            const previous = workspace.results.get(commandId)
            if (previous) {
              results.push({ ...previous, duplicate: true })
              continue
            }
            const invalid = invalidCommand(raw)
            let result: SyncCommandResult
            const current = workspace.objects.get(objectId)
            if (invalid) {
              result = { commandId, status: 'rejected', duplicate: false, code: invalid, retryable: false }
            } else if ((current ? String(current.revision) : null) !== raw.baseRevision) {
              result = { commandId, status: 'conflict', duplicate: false, code: 'revision_conflict', retryable: false, ...(current ? { revision: String(current.revision) } : {}) }
            } else {
              const revision = (current?.revision ?? 0) + 1
              const kind = raw.kind as SyncObjectKind
              workspace.objects.set(objectId, { kind, revision, ciphertext: raw.ciphertext as string, keyVersion: raw.keyVersion as number })
              const eventSequence = String(++sequence)
              workspace.events.push({
                eventId: `event-${eventSequence}`,
                sequence: eventSequence,
                commandId,
                sourceDeviceId: deviceId,
                type: 'object.upserted',
                objectId,
                documentId: null,
                documentSequence: null,
                keyVersion: raw.keyVersion as number,
                ciphertext: raw.ciphertext as string,
                ciphertextHash: raw.ciphertextHash as string,
                metadata: { kind, revision: String(revision) },
                createdAt: new Date(0).toISOString(),
              })
              result = { commandId, status: 'applied', duplicate: false, revision: String(revision), sequence: eventSequence }
            }
            workspace.results.set(commandId, result)
            commandLog.push({ deviceId, workspaceId, command: raw, result })
            results.push(result)
          }
          return { results, syncEpoch: workspace.syncEpoch }
        },
        async events(workspaceId, after, limit, expectedSyncEpoch) {
          const workspace = workspaceOf(workspaceId)
          if (expectedSyncEpoch !== workspace.syncEpoch) throw epochMismatch()
          const pending = workspace.events.filter(event => Number(event.sequence) > Number(after))
          const events = pending.slice(0, limit)
          const latest = workspace.events.at(-1)?.sequence ?? '0'
          return {
            events,
            nextCursor: events.at(-1)?.sequence ?? after,
            latestSequence: latest,
            hasMore: pending.length > events.length,
            syncEpoch: workspace.syncEpoch,
          }
        },
      }
    },
  }
}

/** 記憶體版的遠端物件快取（同 self_hosted_remote_objects 的「只往前」規則） */
export function createMemoryObjectCache(): SelfHostedObjectCache & { entries: Map<string, CachedSelfHostedObject> } {
  const entries = new Map<string, CachedSelfHostedObject>()
  return {
    entries,
    async get(objectId) {
      return entries.get(objectId) ?? null
    },
    async put(objectId, revision, payload) {
      if (!isNewerOrSameRevision(revision, entries.get(objectId)?.revision)) return
      entries.set(objectId, { revision, payload })
    },
  }
}

/**
 * 模擬一台裝置的自架 runtime 收件（runtime.ts applyRemoteEventRaw）：拉事件、略過本機裝置自己的事件、
 * 解密後 domain = 'almanac' 的物件連同 revision 放進快取。回傳這次收到幾個 almanac 物件（App 收到就排一輪 V3 同步）。
 */
export function createFakeInbox(input: {
  server: FakeSelfHostedServer
  deviceId: string
  workspaceId: string
  cache: SelfHostedObjectCache
  syncEpoch?: string
}) {
  let cursor = '0'
  const client = input.server.clientFor(input.deviceId)
  return {
    async pull(): Promise<number> {
      let received = 0
      let hasMore = true
      while (hasMore) {
        const page = await client.events(input.workspaceId, cursor, 50, input.syncEpoch ?? 'epoch-1')
        for (const event of page.events) {
          if (event.sourceDeviceId === input.deviceId || event.type !== 'object.upserted' || !event.objectId || !event.ciphertext) continue
          const kind = String(event.metadata.kind)
          const payload = fakeDecrypt(event.ciphertext, `notegen:sync:v1:${input.workspaceId}:${event.objectId}:${kind}`)
          if (!isAlmanacSelfHostedPayload(payload)) continue
          await input.cache.put(event.objectId, String(event.metadata.revision), payload)
          received += 1
        }
        cursor = page.nextCursor
        hasMore = page.hasMore
      }
      return received
    },
  }
}

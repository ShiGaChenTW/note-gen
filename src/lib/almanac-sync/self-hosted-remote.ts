// Fork（almanac ALMNC-85.5）：自架同步的 V3 遠端轉接（設計 1.1、5.1 自架段）。
// engine 只認 AlmanacRemote（read／條件 write），這裡把它接到自架同步的物件模型：
//   - 一個同步檔＝一個物件，種類用既有的 `setting`，加密 payload 的 domain = 'almanac'（self-hosted.ts）。
//   - 讀：自架 runtime 收件時會把每個收到的物件連同 revision 存進本機快取（self_hosted_remote_objects），直接讀快取。
//   - 寫：送一個 upsert-object 指令，baseRevision＝上次讀到的 revision，伺服器比對不符回 revision_conflict
//     → 先拉一次（runtime 收件更新快取）再丟 AlmanacRemoteConflictError，engine 重拉、重合併、再推。
// 不綁 Tauri：伺服器、快取、加密、拉取都由呼叫端注入，契約測試用假伺服器跑同一份程式（self-hosted-fake-server.ts）。
import type { SyncCommandResult } from '@/lib/self-hosted-sync/protocol'
import { AlmanacRemoteConflictError, type AlmanacRemote } from './remote'
import {
  ALMANAC_SELF_HOSTED_KIND, almanacSelfHostedFileLocalKey, decodeAlmanacSelfHostedFilePayload,
  encodeAlmanacSelfHostedFilePayload,
} from './self-hosted'

export interface SelfHostedCommandClient {
  pushCommands(workspaceId: string, commands: unknown[], expectedSyncEpoch: string): Promise<{ results: SyncCommandResult[]; syncEpoch: string }>
}

export interface CachedSelfHostedObject {
  revision: string
  payload: Record<string, unknown>
}

/** 本機的遠端物件快取（正式 App：self_hosted_remote_objects）。put 不能把較新的 revision 蓋回較舊的。 */
export interface SelfHostedObjectCache {
  get(objectId: string): Promise<CachedSelfHostedObject | null>
  put(objectId: string, revision: string, payload: Record<string, unknown>): Promise<void>
}

export interface EncryptedObjectPayload {
  packedCiphertext: string
  packedCiphertextHash: string
}

/** 寫入時才需要的連線資訊（正式 App 要先問伺服器 sync session 才拿得到），所以用 lazy 的方式取得 */
export interface SelfHostedWriteSession {
  client: SelfHostedCommandClient
  syncEpoch: string
  keyVersion: number
  encrypt(payload: Record<string, unknown>, associatedData: string): Promise<EncryptedObjectPayload>
}

export interface AlmanacSelfHostedWorkspace {
  workspaceId: string
  cache: SelfHostedObjectCache
  /** 依工作區與 localKey 算出物件 id（正式 App：structuredObjectId，UUIDv5） */
  objectIdFor(localKey: string): Promise<string>
  writeSession(): Promise<SelfHostedWriteSession>
  /** 衝突後拉一次遠端最新狀態，讓快取裡有別台剛寫的版本（正式 App：喚醒自架 runtime 收件） */
  refresh(): Promise<void>
  newCommandId?: () => string
}

/** 跟 crypto.ts 的 objectAssociatedData 同一格式（物件 id 與種類綁進 AAD，搬到別的物件解不開） */
export function almanacObjectAssociatedData(workspaceId: string, objectId: string): string {
  return `notegen:sync:v1:${workspaceId}:${objectId}:${ALMANAC_SELF_HOSTED_KIND}`
}

export async function buildAlmanacUpsertCommand(input: {
  workspaceId: string
  objectId: string
  payload: Record<string, unknown>
  baseRevision: string | null
  session: SelfHostedWriteSession
  commandId: string
}) {
  const encrypted = await input.session.encrypt(input.payload, almanacObjectAssociatedData(input.workspaceId, input.objectId))
  return {
    commandId: input.commandId,
    type: 'upsert-object' as const,
    objectId: input.objectId,
    kind: ALMANAC_SELF_HOSTED_KIND,
    parentObjectId: null,
    nameCiphertext: null,
    nameBlindIndex: null,
    baseRevision: input.baseRevision,
    blobRefs: [] as string[],
    keyVersion: input.session.keyVersion,
    ciphertext: encrypted.packedCiphertext,
    ciphertextHash: encrypted.packedCiphertextHash,
  }
}

export type AlmanacCommandOutcome = { status: 'applied'; revision: string } | { status: 'conflict' }

/** 伺服器的回應：applied＋revision 才算寫入；任何 conflict（revision_conflict 或伺服器另建衝突物件）都當成被別台搶先 */
export function interpretAlmanacCommandResult(result: SyncCommandResult | undefined, commandId: string): AlmanacCommandOutcome {
  if (!result || result.commandId !== commandId) throw new Error('SELF_HOSTED_API_INVALID_RESPONSE: almanac command result missing')
  if (result.status === 'applied') {
    if (typeof result.revision !== 'string' || !result.revision) throw new Error('SELF_HOSTED_API_INVALID_RESPONSE: almanac revision missing')
    return { status: 'applied', revision: result.revision }
  }
  if (result.status === 'conflict') return { status: 'conflict' }
  throw new Error(`SELF_HOSTED_COMMAND_REJECTED: almanac ${result.code ?? 'unknown'}`)
}

export function createSelfHostedAlmanacRemote(workspace: AlmanacSelfHostedWorkspace): AlmanacRemote {
  const newCommandId = workspace.newCommandId ?? (() => crypto.randomUUID())
  const objectIds = new Map<string, Promise<string>>()
  const objectIdFor = (path: string) => {
    let id = objectIds.get(path)
    if (!id) {
      id = workspace.objectIdFor(almanacSelfHostedFileLocalKey(path))
      objectIds.set(path, id)
    }
    return id
  }
  let session: Promise<SelfHostedWriteSession> | null = null

  return {
    async read(path) {
      const cached = await workspace.cache.get(await objectIdFor(path))
      if (!cached) return null
      const file = decodeAlmanacSelfHostedFilePayload(cached.payload, path)
      if (!file) throw new Error(`SYNC_DATA_INVALID_SCHEMA: almanac self-hosted ${path}`)
      return { content: file.content, version: cached.revision }
    },
    async write(path, content, guard) {
      const objectId = await objectIdFor(path)
      session ??= workspace.writeSession()
      let current: SelfHostedWriteSession
      try {
        current = await session
      } catch (error) {
        session = null
        throw error
      }
      const payload = encodeAlmanacSelfHostedFilePayload(path, content) as unknown as Record<string, unknown>
      const command = await buildAlmanacUpsertCommand({
        workspaceId: workspace.workspaceId, objectId, payload, baseRevision: guard.version, session: current, commandId: newCommandId(),
      })
      const response = await current.client.pushCommands(workspace.workspaceId, [command], current.syncEpoch)
      const outcome = interpretAlmanacCommandResult(response.results.find(item => item.commandId === command.commandId), command.commandId)
      if (outcome.status === 'conflict') {
        await workspace.refresh()
        throw new AlmanacRemoteConflictError(path)
      }
      // 自己寫的物件，runtime 收件時會因為是本機裝置的事件而略過，所以這裡直接把被接受的版本放進快取。
      await workspace.cache.put(objectId, outcome.revision, payload)
      return { version: outcome.revision }
    },
  }
}

/** revision 是伺服器遞增的整數字串；快取只往前，不被延遲到的舊回應蓋回去 */
export function isNewerOrSameRevision(next: string, current: string | null | undefined): boolean {
  if (current == null) return true
  const left = Number(next)
  const right = Number(current)
  if (Number.isFinite(left) && Number.isFinite(right)) return left >= right
  return next >= current
}

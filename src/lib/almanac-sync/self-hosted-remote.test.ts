// Fork（almanac ALMNC-85.5 #1）：自架同步模式下的 V3 同步。
// 契約測試：self-hosted-remote.ts 送出的指令、對回應的解讀，對著假伺服器（self-hosted-fake-server.ts，照 client／runtime 實際用到的契約）跑。
// 雙裝置模擬：兩份 node:sqlite＋各自的快取與收件，共用一台假伺服器，用同一套 engine 驗證上傳、下載、合併與條件寫入衝突。
import { describe, expect, it, vi } from 'vitest'
import { runAlmanacSync, type AlmanacSyncContext } from './engine'
import { hashString } from './hash'
import {
  almanacObjectAssociatedData, buildAlmanacUpsertCommand, createSelfHostedAlmanacRemote, interpretAlmanacCommandResult,
  type AlmanacSelfHostedWorkspace,
} from './self-hosted-remote'
import { createFakeInbox, createFakeSelfHostedServer, createMemoryObjectCache, fakeDecrypt, fakeEncrypt, type FakeSelfHostedServer } from './self-hosted-fake-server'
import { almanacSelfHostedFileLocalKey } from './self-hosted'
import { AlmanacRemoteConflictError } from './remote'
import { createDevice, demoItemsTable, demoLogTable, type Device } from './test-devices'

const ACCOUNT_WS = 'ws-account'
const LIBRARY_WS = 'ws-library'

/** 測試版的 structuredObjectId：同一個工作區＋localKey 一定算出同一個 id（正式版是 UUIDv5） */
const fakeObjectId = async (workspaceId: string, localKey: string) => `obj-${hashString(`${workspaceId}/setting/${localKey}`).slice(0, 16)}`

function workspaceFor(server: FakeSelfHostedServer, deviceId: string, workspaceId: string) {
  const cache = createMemoryObjectCache()
  const inbox = createFakeInbox({ server, deviceId, workspaceId, cache })
  const refresh = vi.fn(async () => { await inbox.pull() })
  let counter = 0
  const workspace: AlmanacSelfHostedWorkspace = {
    workspaceId,
    cache,
    objectIdFor: localKey => fakeObjectId(workspaceId, localKey),
    writeSession: async () => ({
      client: server.clientFor(deviceId),
      syncEpoch: 'epoch-1',
      keyVersion: 1,
      encrypt: async (payload, aad) => fakeEncrypt(payload, aad),
    }),
    refresh,
    newCommandId: () => `${deviceId}-${workspaceId}-${++counter}`,
  }
  return { workspace, cache, inbox, refresh, remote: createSelfHostedAlmanacRemote(workspace) }
}

function serverWithWorkspaces() {
  const server = createFakeSelfHostedServer()
  server.createWorkspace(ACCOUNT_WS)
  server.createWorkspace(LIBRARY_WS)
  return server
}

describe('自架 V3 同步：對假伺服器的契約', () => {
  it('第一次寫：用既有的 setting 種類、baseRevision＝null 建立；payload 加密且 AAD 綁物件 id，domain＝almanac', async () => {
    const server = serverWithWorkspaces()
    const { remote } = workspaceFor(server, 'dev-a', ACCOUNT_WS)
    const written = await remote.write('.data/almanac/demo.json', '{"x":1}', { version: null })
    expect(written.version).toBe('1')
    const [entry] = server.commandLog
    expect(entry.result.status).toBe('applied')
    expect(entry.command).toMatchObject({ type: 'upsert-object', kind: 'setting', baseRevision: null, keyVersion: 1, blobRefs: [], parentObjectId: null })
    const objectId = await fakeObjectId(ACCOUNT_WS, almanacSelfHostedFileLocalKey('.data/almanac/demo.json'))
    expect(entry.command.objectId).toBe(objectId)
    const payload = fakeDecrypt(entry.command.ciphertext as string, almanacObjectAssociatedData(ACCOUNT_WS, objectId))
    expect(payload).toEqual({ domain: 'almanac', objectType: 'almanac-file', path: '.data/almanac/demo.json', content: '{"x":1}' })
  })

  it('自己寫的版本直接進快取，下一次讀拿到內容與 revision；再寫時帶上這個 revision', async () => {
    const server = serverWithWorkspaces()
    const { remote } = workspaceFor(server, 'dev-a', ACCOUNT_WS)
    await remote.write('.data/almanac/demo.json', 'v1', { version: null })
    const read = await remote.read('.data/almanac/demo.json')
    expect(read).toEqual({ content: 'v1', version: '1' })
    await remote.write('.data/almanac/demo.json', 'v2', { version: read!.version })
    expect(server.commandLog[1].command.baseRevision).toBe('1')
    expect(server.commandLog[1].result).toMatchObject({ status: 'applied', revision: '2' })
  })

  it('別台已經寫過（revision 不符）→ 伺服器回 revision_conflict：先拉一次再丟衝突，拉完讀得到別台的版本', async () => {
    const server = serverWithWorkspaces()
    const a = workspaceFor(server, 'dev-a', ACCOUNT_WS)
    const b = workspaceFor(server, 'dev-b', ACCOUNT_WS)
    await a.remote.write('.data/almanac/demo.json', 'from A', { version: null })
    await expect(b.remote.write('.data/almanac/demo.json', 'from B', { version: null })).rejects.toBeInstanceOf(AlmanacRemoteConflictError)
    expect(server.commandLog[1].result).toMatchObject({ status: 'conflict', code: 'revision_conflict' })
    expect(b.refresh).toHaveBeenCalledOnce()
    await expect(b.remote.read('.data/almanac/demo.json')).resolves.toEqual({ content: 'from A', version: '1' })
  })

  it('伺服器不收未知的物件種類（所以不新增 almanac-source 等種類，外層用 setting）', async () => {
    const server = serverWithWorkspaces()
    const command = await buildAlmanacUpsertCommand({
      workspaceId: ACCOUNT_WS, objectId: 'obj-1', payload: { domain: 'almanac' }, baseRevision: null, commandId: 'c1',
      session: { client: server.clientFor('dev-a'), syncEpoch: 'epoch-1', keyVersion: 1, encrypt: async (payload, aad) => fakeEncrypt(payload, aad) },
    })
    const response = await server.clientFor('dev-a').pushCommands(ACCOUNT_WS, [{ ...command, kind: 'almanac-source' }], 'epoch-1')
    expect(() => interpretAlmanacCommandResult(response.results[0], 'c1')).toThrow(/SELF_HOSTED_COMMAND_REJECTED: almanac unsupported_kind/)
  })

  it('sync epoch 換了（伺服器重建）→ 寫入失敗丟錯，不當成成功', async () => {
    const server = createFakeSelfHostedServer()
    server.createWorkspace(ACCOUNT_WS, 'epoch-2')
    const { remote } = workspaceFor(server, 'dev-a', ACCOUNT_WS)
    await expect(remote.write('.data/almanac/demo.json', 'x', { version: null })).rejects.toThrow(/sync_epoch_mismatch/)
  })

  it('快取裡的物件不是 almanac 同步檔 → 丟格式錯誤，不當成遠端是空的', async () => {
    const server = serverWithWorkspaces()
    const { remote, cache } = workspaceFor(server, 'dev-a', ACCOUNT_WS)
    const objectId = await fakeObjectId(ACCOUNT_WS, almanacSelfHostedFileLocalKey('.data/almanac/demo.json'))
    await cache.put(objectId, '3', { domain: 'almanac', objectType: 'almanac-file', path: '.data/almanac/other.json', content: 'x' })
    await expect(remote.read('.data/almanac/demo.json')).rejects.toThrow(/SYNC_DATA_INVALID_SCHEMA/)
    await expect(remote.read('.data/almanac/missing.json')).resolves.toBeNull()
  })

  it('收件只收 almanac 物件、略過本機自己的事件', async () => {
    const server = serverWithWorkspaces()
    const a = workspaceFor(server, 'dev-a', ACCOUNT_WS)
    const b = workspaceFor(server, 'dev-b', ACCOUNT_WS)
    await a.remote.write('.data/almanac/demo.json', 'from A', { version: null })
    await server.clientFor('dev-a').pushCommands(ACCOUNT_WS, [{
      commandId: 'setting-1', type: 'upsert-object', objectId: 'settings-snapshot', kind: 'setting', parentObjectId: null,
      baseRevision: null, blobRefs: [], keyVersion: 1, ...(() => {
        const encrypted = fakeEncrypt({ domain: 'setting', value: {} }, `notegen:sync:v1:${ACCOUNT_WS}:settings-snapshot:setting`)
        return { ciphertext: encrypted.packedCiphertext, ciphertextHash: encrypted.packedCiphertextHash }
      })(),
    }], 'epoch-1')
    await expect(a.inbox.pull()).resolves.toBe(0)
    await expect(b.inbox.pull()).resolves.toBe(1)
    expect([...b.cache.entries.keys()]).toHaveLength(1)
  })
})

function harness(tables: AlmanacSyncContext['tables']) {
  const server = serverWithWorkspaces()
  let clock = 1_000
  const make = (deviceId: string) => {
    const device = createDevice(deviceId)
    const account = workspaceFor(server, deviceId, ACCOUNT_WS)
    const library = workspaceFor(server, deviceId, LIBRARY_WS)
    return { device, account, library }
  }
  const a = make('dev-a')
  const b = make('dev-b')
  /** 一輪＝先收件（runtime 喚醒），再跑 engine（同 runAlmanacSyncTask 在自架模式的做法） */
  const sync = async (side: typeof a, extra: Partial<AlmanacSyncContext> = {}) => {
    await side.account.inbox.pull()
    await side.library.inbox.pull()
    return runAlmanacSync({
      db: side.device.db,
      deviceId: side.device.deviceId,
      deviceName: side.device.deviceId.toUpperCase(),
      now: () => ++clock,
      remotes: { account: side.account.remote, library: side.library.remote },
      libraryScope: '/vault',
      tables,
      ...extra,
    })
  }
  return { server, a, b, sync, tick: () => ++clock }
}

const items = (device: Device) => device.items()

describe('自架 V3 同步：雙裝置模擬（假伺服器）', () => {
  it('A 新增 → A 同步（上傳）→ B 同步（下載）；再同步一次不會重複上傳', async () => {
    const { a, b, sync, tick, server } = harness([demoItemsTable()])
    a.device.put('i1', 'first', 'todo', tick())
    const first = await sync(a)
    expect(first.uploadedFiles).toContain('.data/almanac/demo.json')
    const report = await sync(b)
    expect(report.changedLocally).toBe(true)
    expect(items(b.device)).toEqual({ i1: { title: 'first', status: 'todo' } })
    const commands = server.commandLog.length
    const idleA = await sync(a)
    const idleB = await sync(b)
    expect(server.commandLog.length).toBe(commands)
    expect([idleA.uploadedFiles, idleB.uploadedFiles]).toEqual([[], []])
  })

  it('兩台改同一筆的不同欄位 → 合併後兩台一致；狀態欄位只往前', async () => {
    const { a, b, sync, tick } = harness([demoItemsTable()])
    a.device.put('i1', 'first', 'todo', tick())
    await sync(a)
    await sync(b)
    a.device.put('i1', 'renamed on A', 'todo', tick())
    b.device.put('i1', 'first', 'done', tick())
    await sync(a)
    await sync(b)
    await sync(a)
    expect(items(a.device)).toEqual({ i1: { title: 'renamed on A', status: 'done' } })
    expect(items(b.device)).toEqual(items(a.device))
  })

  it('B 讀完、送出前被 A 搶先寫入 → 伺服器回 revision_conflict → B 收件、重合併、再送，兩邊的修改都留下', async () => {
    const { a, b, sync, tick, server } = harness([demoItemsTable()])
    a.device.put('i1', 'first', 'todo', tick())
    await sync(a)
    await sync(b)
    a.device.put('i1', 'edited on A', 'todo', tick())
    b.device.put('i2', 'added on B', 'todo', tick())
    const objectId = await fakeObjectId(ACCOUNT_WS, almanacSelfHostedFileLocalKey('.data/almanac/demo.json'))
    server.beforeNextCommand(objectId, async () => { await sync(a) })
    await sync(b)
    expect(server.commandLog.some(entry => entry.deviceId === 'dev-b' && entry.result.code === 'revision_conflict')).toBe(true)
    expect(b.account.refresh).toHaveBeenCalled()
    await sync(a)
    const expected = { i1: { title: 'edited on A', status: 'todo' }, i2: { title: 'added on B', status: 'todo' } }
    expect(items(a.device)).toEqual(expected)
    expect(items(b.device)).toEqual(expected)
  })

  it('刪除跟著同步；只能新增的表（活動紀錄）兩台聯集', async () => {
    const { a, b, sync, tick } = harness([demoItemsTable(), demoLogTable])
    a.device.put('i1', 'one', 'todo', tick())
    a.device.log('A1', tick())
    b.device.log('B1', tick())
    await sync(a)
    await sync(b)
    await sync(a)
    a.device.remove('i1')
    await sync(a)
    await sync(b)
    expect(items(b.device)).toEqual({})
    expect(a.device.logs()).toEqual(['dev-a:1=A1', 'dev-b:1=B1'])
    expect(b.device.logs()).toEqual(a.device.logs())
  })

  it('筆記庫層的表寫進筆記庫工作區，帳號層寫進個人資料工作區；主力裝置經由 devices.json 同步', async () => {
    const libraryTable = { ...demoItemsTable(), name: 'demo_library', layer: 'library' as const, storage: { type: 'file' as const, path: 'library-demo.json' } }
    const { a, b, sync, tick, server } = harness([libraryTable])
    a.device.put('pin', 'pinned', 'todo', tick())
    const first = await sync(a)
    expect(first.devices?.primaryDeviceId).toBe('dev-a')
    const libraryObject = await fakeObjectId(LIBRARY_WS, almanacSelfHostedFileLocalKey('.almanac/v3/library-demo.json'))
    const devicesObject = await fakeObjectId(ACCOUNT_WS, almanacSelfHostedFileLocalKey('.data/almanac/devices.json'))
    expect(server.object(LIBRARY_WS, libraryObject)?.kind).toBe('setting')
    expect(server.object(ACCOUNT_WS, devicesObject)?.kind).toBe('setting')
    const second = await sync(b)
    expect(items(b.device)).toEqual({ pin: { title: 'pinned', status: 'todo' } })
    expect(second.devices?.primaryDeviceId).toBe('dev-a')
    expect(Object.keys(second.devices?.devices ?? {}).sort()).toEqual(['dev-a', 'dev-b'])
  })
})

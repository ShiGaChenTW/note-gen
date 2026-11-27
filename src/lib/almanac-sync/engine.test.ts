// Fork（almanac ALMNC-85.2 骨架）：雙裝置模擬（設計 5.2 第二層）。
// 兩份獨立的 node:sqlite（A、B）＋一個記憶體遠端（條件寫入模擬 Git sha），用同一套 engine 跑「A 改 → A 同步 → B 同步」。
// 表用測試替身（demo_items 有修改的表、demo_log 只能新增的表），驗證骨架流程；正式表由 85.2～85.4 各自加。
import { describe, expect, it } from 'vitest'
import { runAlmanacSync, type AlmanacSyncContext } from './engine'
import { createMemoryRemote, type MemoryRemote } from './remote-memory'
import { isPrimaryDevice } from './devices'
import { createDevice, demoItemsTable, demoLogTable, type Device } from './test-devices'

function harness(tables: AlmanacSyncContext['tables']) {
  const remote = createMemoryRemote()
  let clock = 1_000
  const a = createDevice('dev-a')
  const b = createDevice('dev-b')
  const sync = (device: Device, extra: Partial<AlmanacSyncContext> = {}) => runAlmanacSync({
    db: device.db,
    deviceId: device.deviceId,
    deviceName: device.deviceId.toUpperCase(),
    now: () => ++clock,
    remotes: { account: remote, library: remote },
    libraryScope: '/vault',
    tables,
    ...extra,
  })
  return { remote, a, b, sync, tick: () => ++clock }
}

describe('雙裝置模擬：有修改的表', () => {
  it('A 新增 → A 同步 → B 同步：B 拿到；再同步一次不會重複上傳', async () => {
    const { a, b, sync, tick, remote } = harness([demoItemsTable()])
    a.put('i1', 'first', 'todo', tick())
    await sync(a)
    const report = await sync(b)
    expect(b.items()).toEqual({ i1: { title: 'first', status: 'todo' } })
    expect(report.changedLocally).toBe(true)
    const writesBefore = remote.writes.length
    const idleA = await sync(a)
    const idleB = await sync(b)
    expect(remote.writes.length).toBe(writesBefore)
    // 沒有變動就不算上傳：佇列不更新 meta.json，兩台不會互相觸發同步。
    expect([idleA.uploadedFiles, idleA.devicesWritten, idleB.uploadedFiles, idleB.devicesWritten]).toEqual([[], false, [], false])
  })

  it('兩邊改不同欄位 → 各取各的，兩台收斂', async () => {
    const { a, b, sync, tick } = harness([demoItemsTable()])
    a.put('i1', 'first', 'todo', tick())
    await sync(a)
    await sync(b)
    a.put('i1', 'renamed on A', 'todo', tick())
    b.put('i1', 'first', 'doing', tick())
    await sync(a)
    await sync(b)
    await sync(a)
    expect(a.items()).toEqual({ i1: { title: 'renamed on A', status: 'doing' } })
    expect(b.items()).toEqual(a.items())
  })

  it('兩邊改同一欄位 → 較晚的贏；狀態欄位只往前', async () => {
    const { a, b, sync, tick } = harness([demoItemsTable()])
    a.put('i1', 'first', 'todo', tick())
    await sync(a)
    await sync(b)
    a.put('i1', 'A title', 'done', tick())
    b.put('i1', 'B title (later)', 'doing', tick())
    await sync(a)
    await sync(b)
    await sync(a)
    expect(a.items()).toEqual({ i1: { title: 'B title (later)', status: 'done' } })
    expect(b.items()).toEqual(a.items())
  })

  it('A 刪除 → B 也刪除；B 在刪除之後又改過 → 修改贏', async () => {
    const { a, b, sync, tick } = harness([demoItemsTable()])
    a.put('i1', 'one', 'todo', tick())
    a.put('i2', 'two', 'todo', tick())
    await sync(a)
    await sync(b)
    a.remove('i1')
    a.remove('i2')
    await sync(a)
    b.put('i2', 'two edited after delete', 'todo', tick())
    await sync(b)
    await sync(a)
    expect(b.items()).toEqual({ i2: { title: 'two edited after delete', status: 'todo' } })
    expect(a.items()).toEqual(b.items())
  })

  it('別台刪除要先問：本機保留、不推回遠端', async () => {
    const { a, b, sync, tick, remote } = harness([demoItemsTable({ askOnRemoteDelete: true })])
    a.put('feed', 'feed', 'todo', tick())
    await sync(a)
    await sync(b)
    a.remove('feed')
    await sync(a)
    const report = await sync(b)
    expect(report.tables[0].pendingDeletes).toEqual(['feed'])
    expect(b.items()).toHaveProperty('feed')
    const remoteDoc = JSON.parse(remote.files.get('.data/almanac/demo.json')!.content)
    expect(remoteDoc.rows.feed).toBeUndefined()
    expect(remoteDoc.deleted.feed).toBeDefined()
  })

  it('同鍵兩台各自新增（內容決定的 id）→ 合為一筆', async () => {
    const { a, b, sync, tick } = harness([demoItemsTable()])
    a.put('src_rss:post-1', 'Post 1', 'todo', tick())
    b.put('src_rss:post-1', 'Post 1', 'todo', tick())
    await sync(a)
    await sync(b)
    await sync(a)
    expect(a.items()).toEqual({ 'src_rss:post-1': { title: 'Post 1', status: 'todo' } })
    expect(b.items()).toEqual(a.items())
  })

  it('推送前被別台搶先寫入（條件寫入失敗）→ 重拉重合併，兩邊都留', async () => {
    const { a, b, sync, tick, remote } = harness([demoItemsTable()])
    a.put('i1', 'from A', 'todo', tick())
    b.put('i2', 'from B', 'todo', tick())
    remote.beforeNextWrite('.data/almanac/demo.json', () => {
      // A 寫入前，B 先完成一輪（同步呼叫寫進記憶體遠端）
      remote.files.set('.data/almanac/demo.json', {
        version: 'b-wins',
        content: JSON.stringify({
          format: 'almanac-v3-sync', table: 'demo_items', version: 1, updatedAt: 1, updatedBy: 'dev-b',
          rows: { i2: { v: { title: 'from B', status: 'todo' }, u: 5, d: 'dev-b' } }, deleted: {},
        }),
      })
    })
    await sync(a)
    expect(a.items()).toEqual({ i1: { title: 'from A', status: 'todo' }, i2: { title: 'from B', status: 'todo' } })
    const remoteDoc = JSON.parse(remote.files.get('.data/almanac/demo.json')!.content)
    expect(Object.keys(remoteDoc.rows).sort()).toEqual(['i1', 'i2'])
    await sync(b)
    expect(b.items()).toEqual(a.items())
  })

  it('分桶：只上傳／下載變了的桶，兩台收斂', async () => {
    const { a, b, sync, tick, remote } = harness([demoItemsTable({ buckets: true })])
    for (let index = 0; index < 12; index++) a.put(`k${index}`, `item ${index}`, 'todo', tick())
    await sync(a)
    await sync(b)
    expect(Object.keys(b.items())).toHaveLength(12)
    const writesBefore = remote.writes.length
    a.put('k3', 'only this changed', 'todo', tick())
    await sync(a)
    const newWrites = remote.writes.slice(writesBefore)
    expect(newWrites.filter(path => /demo\/b\d\d\.json$/.test(path))).toHaveLength(1)
    expect(newWrites).toContain('.data/almanac/demo/index.json')
    await sync(b)
    expect(b.items().k3).toEqual({ title: 'only this changed', status: 'todo' })
  })
})

describe('雙裝置模擬：只能新增的表與裝置清單', () => {
  it('兩台各自寫活動紀錄 → 聯集、不重複、依時間排', async () => {
    const { a, b, sync, tick } = harness([demoLogTable])
    a.log('A1', tick())
    b.log('B1', tick())
    a.log('A2', tick())
    await sync(a)
    await sync(b)
    await sync(a)
    await sync(b)
    expect(a.logs()).toEqual(['dev-a:1=A1', 'dev-b:1=B1', 'dev-a:2=A2'])
    expect(b.logs()).toEqual(['dev-a:1=A1', 'dev-b:1=B1', 'dev-a:2=A2'])
  })

  it('第一台開同步的裝置是主力裝置；另一台可以改指定', async () => {
    const { a, b, sync, tick } = harness([])
    const first = await sync(a)
    expect(first.devices?.primaryDeviceId).toBe('dev-a')
    const second = await sync(b)
    expect(isPrimaryDevice(second.devices, 'dev-b')).toBe(false)
    expect(Object.keys(second.devices?.devices ?? {}).sort()).toEqual(['dev-a', 'dev-b'])
    const moved = await sync(b, { primaryRequest: { deviceId: 'dev-b', at: tick() } })
    expect(moved.devices?.primaryDeviceId).toBe('dev-b')
    const seenByA = await sync(a)
    expect(isPrimaryDevice(seenByA.devices, 'dev-a')).toBe(false)
  })

  it('筆記庫層的遠端拿不到時跳過該層的表，不影響帳號層', async () => {
    const remote: MemoryRemote = createMemoryRemote()
    const device = createDevice('dev-a')
    device.put('i1', 'x', 'todo', 1)
    const libraryTable = { ...demoItemsTable(), name: 'demo_library', layer: 'library' as const }
    const report = await runAlmanacSync({
      db: device.db, deviceId: 'dev-a', deviceName: 'A', now: () => 10,
      remotes: { account: remote, library: null }, libraryScope: '/vault',
      tables: [demoItemsTable(), libraryTable],
    })
    expect(report.tables.map(table => table.skipped ?? 'ok')).toEqual(['ok', 'no library remote'])
  })
})

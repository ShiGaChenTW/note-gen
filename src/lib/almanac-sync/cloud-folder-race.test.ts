// Fork（almanac ALMNC-85.5 #4）：雲端資料夾（OneDrive 以外）沒有條件寫入時，兩台在同一輪交錯寫同一檔。
// #191 說「被蓋掉那台下一輪會補回」，#195 說「會丟」。這裡用雙裝置模擬重現：先寫那台已經把基準前進到自己寫的內容，
// 下一輪看到遠端少了自己的修改，會當成別台改回去而採用遠端——不加保護時修改是永久遺失的（#195 對）。
// 修法是 remote.ts 的 withVerifiedWrites（寫前比對＋寫後重讀），不改 Rust。
import { describe, expect, it } from 'vitest'
import { runAlmanacSync, type AlmanacSyncContext } from './engine'
import { createMemoryRemote, type MemoryRemote } from './remote-memory'
import { withVerifiedWrites, type AlmanacRemote } from './remote'
import { createDevice, demoItemsTable, type Device } from './test-devices'

const DEMO = '.data/almanac/demo.json'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

/** 共用一個「雲端資料夾」（不支援條件寫入）；verified＝每台各自包一層 withVerifiedWrites（正式 App 的做法） */
function harness(verified: boolean) {
  const folder: MemoryRemote = createMemoryRemote(new Map(), { conditional: false })
  let clock = 1_000
  const a = createDevice('dev-a')
  const b = createDevice('dev-b')
  const remoteFor = new Map<Device, AlmanacRemote>([
    [a, verified ? withVerifiedWrites(folder, { settleMs: 5 }) : folder],
    [b, verified ? withVerifiedWrites(folder, { settleMs: 5 }) : folder],
  ])
  const sync = (device: Device, extra: Partial<AlmanacSyncContext> = {}) => runAlmanacSync({
    db: device.db,
    deviceId: device.deviceId,
    deviceName: device.deviceId.toUpperCase(),
    now: () => ++clock,
    remotes: { account: remoteFor.get(device)!, library: remoteFor.get(device)! },
    libraryScope: '/vault',
    tables: [demoItemsTable()],
    ...extra,
  })
  return { folder, a, b, sync, tick: () => ++clock }
}

async function pairedWithOneItem(verified: boolean) {
  const h = harness(verified)
  h.a.put('i1', 'first', 'todo', h.tick())
  await h.sync(h.a)
  await h.sync(h.b)
  await h.sync(h.a)
  expect(h.b.items()).toEqual({ i1: { title: 'first', status: 'todo' } })
  return h
}

/** B 讀完遠端之後、寫入之前，A 跑完一整輪（A 也是從舊版合併、寫入）；接著 B 用它讀到的舊版合併結果寫回 */
async function interleaveBOverwritesA(h: Awaited<ReturnType<typeof pairedWithOneItem>>) {
  h.folder.afterNextRead(DEMO, async () => { await h.sync(h.a) })
  await h.sync(h.b)
}

describe('雲端資料夾競態：兩台在同一輪交錯寫同一檔', () => {
  it('重現：不加保護時，被蓋掉那台的修改永久遺失（再同步幾輪也補不回來）', async () => {
    const h = await pairedWithOneItem(false)
    h.a.put('i1', 'edited on A', 'todo', h.tick())
    h.b.put('i2', 'added on B', 'todo', h.tick())
    await interleaveBOverwritesA(h)
    for (let round = 0; round < 3; round++) {
      await h.sync(h.a)
      await h.sync(h.b)
    }
    // A 的修改不見了：A 的基準已經是「edited on A」，遠端是 B 寫的舊標題 → A 以為是別台改回去。
    expect(h.a.items().i1.title).toBe('first')
    expect(h.b.items().i1.title).toBe('first')
  })

  it('寫前比對：B 寫入前發現遠端已被 A 改過 → 重拉重合併，兩邊的修改都留下', async () => {
    const h = await pairedWithOneItem(true)
    h.a.put('i1', 'edited on A', 'todo', h.tick())
    h.b.put('i2', 'added on B', 'todo', h.tick())
    await interleaveBOverwritesA(h)
    await h.sync(h.a)
    await h.sync(h.b)
    const expected = { i1: { title: 'edited on A', status: 'todo' }, i2: { title: 'added on B', status: 'todo' } }
    expect(h.a.items()).toEqual(expected)
    expect(h.b.items()).toEqual(expected)
    expect(Object.keys(JSON.parse(h.folder.files.get(DEMO)!.content).rows).sort()).toEqual(['i1', 'i2'])
  })

  it('寫後重讀：兩台都通過寫前比對、A 寫完緊接著 B 寫入（同一個 100ms 內）→ A 讀回發現被蓋掉，重合併再寫', async () => {
    const h = await pairedWithOneItem(true)
    h.a.put('i1', 'edited on A', 'todo', h.tick())
    h.b.put('i2', 'added on B', 'todo', h.tick())
    const aWrote = deferred()
    const bWrote = deferred()
    let aRound: Promise<unknown> = Promise.resolve()
    // B 已經讀過、也通過寫前比對，真正寫入前：A 開始一整輪，等 A 寫完才放 B 寫。
    h.folder.beforeNextWrite(DEMO, async () => {
      h.folder.afterNextWrite(DEMO, async () => {
        aWrote.resolve()
        await bWrote.promise
      })
      aRound = h.sync(h.a)
      await aWrote.promise
      // B 的寫入在這個 hook 回傳後同步完成；計時器晚一步才放 A 去讀回。
      setTimeout(() => bWrote.resolve(), 0)
    })
    await h.sync(h.b)
    await aRound
    await h.sync(h.b)
    await h.sync(h.a)
    const expected = { i1: { title: 'edited on A', status: 'todo' }, i2: { title: 'added on B', status: 'todo' } }
    expect(h.a.items()).toEqual(expected)
    expect(h.b.items()).toEqual(expected)
  })

  it('沒有競爭時照常寫入，不多出衝突重試', async () => {
    const h = await pairedWithOneItem(true)
    const writesBefore = h.folder.writes.length
    h.a.put('i1', 'edited on A', 'todo', h.tick())
    const report = await h.sync(h.a)
    expect(report.uploadedFiles).toEqual([DEMO])
    expect(h.folder.writes.length - writesBefore).toBe(1)
  })
})

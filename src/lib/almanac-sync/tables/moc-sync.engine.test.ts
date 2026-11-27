// Fork（almanac ALMNC-85.4）：MOC 群組的雙裝置模擬（設計 5.2 第二層）。
// 兩份獨立的 node:sqlite（A、B）＋一個記憶體遠端（條件寫入），表用正式的 createMocTables／createOpsTable／createActivityTable；
// MOC 的比對用正式的 reconcile 純函式（planReconcile、applyAppWrites、adoptSyncedBaselines）與 app-writes（noteSyncWrite）。
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { runAlmanacSync, type AlmanacSyncContext } from '../engine'
import { createMemoryRemote } from '../remote-memory'
import { recordAlias } from '../aliases'
import type { AlmanacSqlDb, SqlValue } from '../sql'
import { AGENT_SCHEMA } from '@/lib/agents/schema'
import { AGENT_MEMORY_SCHEMA, type ActivityMigrationStatement } from '@/lib/agent-memory/schema'
import { createOpsService } from '@/lib/ops/service'
import { createMemoryOpsIo } from '@/lib/ops/testing'
import { UNDO_WINDOW_MS } from '@/lib/ops/types'
import { createOpsDbStore } from '@/db/ops'
import { buildLinkLookup, resolveWikilinkTargetWithLookup } from '@/lib/vault-index/links'
import {
  adoptSyncedBaselines, applyAppWrites, diffToOpSpec, isEffectiveDiff, planReconcile,
  type MocBaseline, type MocFileNow, type SyncedMocBaseline,
} from '@/lib/moc/reconcile'
import { noteSyncWrite, takeAppWrites } from '@/lib/moc/app-writes'
import { parseMoc } from '@/lib/moc/parse'
import { pinKey, pinsFromDiffs, SCOTT_PIN_TTL_MS, type ScottPin } from '@/lib/moc/scott-pins'
import {
  ensureMocPositionsSchema, MOC_POSITIONS_SCHEMA, MOC_POSITIONS_UPDATED_AT, MOC_SNAPSHOTS_SCHEMA, PROPOSAL_EXPERTS_SCHEMA, SCOTT_PINS_SCHEMA,
} from '@/lib/moc/schema'
import { createActivityTable } from './activity'
import { createOpsTable } from './ops'
import { AGENT_ALIAS_TABLE } from './crew'
import { createMocTables, ensureMocSyncSchema, listSyncedMocBaselines } from './moc'

type Bindings = Record<string, SqlValue>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): { all(bindings: Bindings): unknown[]; run(bindings: Bindings): { changes: number; lastInsertRowid: number | bigint } }
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const bind = (values: SqlValue[] = []) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

const VAULT = '/vault'
const MOC_PATH = '20 領域/時間管理.md'
const MOC_ID = 'M-20261112-060012-VPB3'
const C_WHAT = 'C-20261112-060020-N9NR'
const C_WHEN = 'C-20261112-060024-3XSV'
const NOTES = ['筆記A', '筆記B', '筆記C', '筆記D', '筆記E', '筆記F', '筆記G', '筆記H'].map(name => `10 知識/${name}.md`)
const lookup = buildLinkLookup([...NOTES, MOC_PATH])
const resolve = (target: string, mocPath: string) => resolveWikilinkTargetWithLookup(target, lookup, mocPath)
const mocIdOf = (raw: string) => parseMoc(raw).id

function moc(what: string[], when: string[] = ['- [[筆記C]] ── 精力高峰']): string {
  return [
    '---', `id: ${MOC_ID}`, 'kind: domain', '---', '# 時間管理', '',
    '## ③ 章節', '',
    '### 決定做什麼', `<!-- ${C_WHAT} -->`, ...what, '',
    '### 什麼時候做', `<!-- ${C_WHEN} -->`, ...when, '',
  ].join('\n')
}

const OLD = moc(['- [[筆記A]] ── 出發點', '- [[筆記B]] ── 先刪再排'])
/** Scott 在 Obsidian 加了一則收錄。 */
const ADDED = moc(['- [[筆記A]] ── 出發點', '- [[筆記B]] ── 先刪再排', '- [[筆記D]] ── 新想法'])
/** 大量收錄的版本與一次拿掉六則（觸發整批檢查）。 */
const BIG = moc(['- [[筆記A]] ── 1', '- [[筆記B]] ── 2', '- [[筆記D]] ── 3', '- [[筆記E]] ── 4', '- [[筆記F]] ── 5', '- [[筆記G]] ── 6', '- [[筆記H]] ── 7'])
const TRIMMED = moc(['- [[筆記A]] ── 1'], [])

function createDevice(deviceId: string, clock: { now(): number }) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('create table conversations (id integer primary key autoincrement, syncId text unique, title text)')
  for (const sql of [...AGENT_SCHEMA, ...AGENT_MEMORY_SCHEMA, MOC_SNAPSHOTS_SCHEMA, MOC_POSITIONS_SCHEMA, MOC_POSITIONS_UPDATED_AT, SCOTT_PINS_SCHEMA, PROPOSAL_EXPERTS_SCHEMA]) sqlite.exec(sql)
  const db: AlmanacSqlDb & { execute(sql: string, values?: SqlValue[]): Promise<{ rowsAffected: number }> } = {
    async execute(sql, values) {
      return { rowsAffected: sqlite.prepare(sql).run(bind(values)).changes }
    },
    async select<T>(sql: string, values?: SqlValue[]) {
      return sqlite.prepare(sql).all(bind(values)) as T
    },
  }
  const all = <T>(sql: string, ...values: SqlValue[]) => sqlite.prepare(sql).all(bind(values)) as T[]
  const run = (sql: string, ...values: SqlValue[]) => sqlite.prepare(sql).run(bind(values))
  const runTransaction = async (statements: ActivityMigrationStatement[]) => {
    sqlite.exec('begin')
    try {
      for (const statement of statements) sqlite.prepare(statement.sql).run(bind(statement.values))
      sqlite.exec('commit')
    } catch (error) {
      sqlite.exec('rollback')
      throw error
    }
  }
  const tables = [createActivityTable({ runTransaction }), createOpsTable(), ...createMocTables()]
  const files: Record<string, string> = {}
  const io = createMemoryOpsIo(files)
  const opsStore = createOpsDbStore(() => VAULT, async () => db)
  const ops = () => createOpsService({ fs: io.fs, writer: io.writer, store: opsStore, now: () => clock.now() })

  /** 同 db/moc-snapshots 的 load。 */
  async function loadSnapshots(): Promise<{ initialized: boolean; baselines: Map<string, MocBaseline> }> {
    await ensureMocSyncSchema(db)
    const rows = all<{ path: string; mocId: string | null; content: string }>(
      'select path, moc_id as mocId, content from moc_snapshots where workspace = $1', VAULT)
    const baselines = new Map<string, MocBaseline>()
    for (const row of rows) if (row.path) baselines.set(row.path, { content: row.content, ...(row.mocId ? { mocId: row.mocId } : {}) })
    return { initialized: rows.length > 0, baselines }
  }

  /** 同 db/moc-snapshots 的 save。 */
  async function saveSnapshots(entries: ReadonlyMap<string, MocBaseline | null>) {
    await ensureMocSyncSchema(db)
    const upsert = `insert into moc_snapshots (workspace, path, moc_id, content, updated_at) values ($1, $2, $3, $4, $5)
      on conflict(workspace, path) do update set moc_id = excluded.moc_id, content = excluded.content, updated_at = excluded.updated_at`
    const at = clock.now()
    run(upsert, VAULT, '', null, '', at)
    for (const [path, baseline] of entries) {
      if (baseline === null) run('delete from moc_snapshots where workspace = $1 and path = $2', VAULT, path)
      else run(upsert, VAULT, path, baseline.mocId ?? null, baseline.content, at)
    }
  }

  /** 同 db/scott-pins 的 save。 */
  async function savePins(pins: readonly ScottPin[]) {
    await ensureMocSyncSchema(db)
    for (const pin of pins) {
      run(`insert into scott_pins (workspace, pin_key, kind, moc_id, moc_path, moc_name, note_id, note_path, chapter_id, block, op_id, pinned_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        on conflict(workspace, pin_key) do update set pinned_at = max(scott_pins.pinned_at, excluded.pinned_at), op_id = excluded.op_id`,
      VAULT, pinKey(pin), pin.kind, pin.mocId ?? null, pin.mocPath, pin.mocName, pin.noteId ?? null, pin.notePath ?? null,
      pin.chapterId ?? null, pin.block ?? null, pin.opId ?? null, pin.at)
    }
  }

  /** 同 appendActivity：本機另給整數 id，uid 留空（下一輪同步補）。 */
  function log(opId: string) {
    run(`insert into activity_log (at, actor_id, actor_role, action, target_link, source_kind, source_ref, note, corrects_id, op_id)
      values ($1, 'scott', 'scott', 'updated', $2, 'system', $3, '', null, $4)`, clock.now(), `note:${MOC_PATH}`, `op:${opId}`, opId)
  }

  /**
   * 同 reconcile-runtime 的 runMocReconcile（拿掉畫面與寫檔）：先套 App 寫入、再採用同步來的基準，之後比對。
   * 直接生效的差異記 ops（actor＝scott）、活動紀錄、Scott 指定；整批檢查時不動上次已知狀態，回傳 batch。
   */
  async function reconcile(raw: string, events = takeAppWrites()) {
    const files: MocFileNow[] = [{ path: MOC_PATH, raw }]
    const current = await loadSnapshots()
    const dirty = new Map<string, MocBaseline | null>()
    for (const path of applyAppWrites(current.baselines, events, mocIdOf)) dirty.set(path, current.baselines.get(path) ?? null)
    if (current.initialized) {
      const synced: SyncedMocBaseline[] = await listSyncedMocBaselines(db, VAULT)
      for (const [path, baseline] of adoptSyncedBaselines(current.baselines, files, synced, mocIdOf)) dirty.set(path, baseline)
    }
    const plan = planReconcile({ files, baselines: current.baselines, initialized: current.initialized, resolve })
    if (!current.initialized) {
      for (const file of plan.baselineOnly) dirty.set(file.path, { content: file.raw, mocId: mocIdOf(file.raw) })
      await saveSnapshots(dirty)
      return { batch: false, recorded: 0 }
    }
    if (plan.check.required) {
      if (dirty.size) await saveSnapshots(dirty)
      return { batch: true, recorded: 0 }
    }
    let recorded = 0
    for (const item of plan.changed) {
      const effective = item.result.diffs.filter(isEffectiveDiff)
      if (effective.length) {
        const noteRef = (path: string) => ({ noteTitle: path.split('/').pop()!.replace(/\.md$/, '') })
        const records = await ops().recordOps(effective.map(diff => ({ spec: diffToOpSpec(diff, noteRef), after: { [item.path]: item.current } })), { actor: 'scott', actorId: 'scott' })
        for (const record of records) log(record.id)
        await savePins(pinsFromDiffs(effective, clock.now(), { opIds: records.map(record => record.id) }))
        recorded += records.length
      }
      dirty.set(item.path, { content: item.result.effective, mocId: mocIdOf(item.result.effective) })
    }
    if (dirty.size) await saveSnapshots(dirty)
    return { batch: false, recorded }
  }

  return {
    deviceId,
    db,
    tables,
    all,
    run,
    files,
    reconcile,
    loadSnapshots,
    savePins,
    baseline: async () => (await loadSnapshots()).baselines.get(MOC_PATH)?.content ?? null,
    opIds: () => all<{ id: string }>('select id from ops order by at, id').map(row => row.id),
    pinRows: () => all<{ pinKey: string; pinnedAt: number }>('select pin_key as pinKey, pinned_at as pinnedAt from scott_pins order by pin_key'),
    activity: () => all<{ uid: string; opId: string | null }>('select uid, op_id as opId from activity_log order by at, id'),
    positions: () => all<{ mocId: string; positions: string; updatedAt: number }>('select moc_id as mocId, positions, updated_at as updatedAt from moc_positions order by moc_id'),
    savePositions(mocId: string, positions: unknown, at = clock.now()) {
      run(`insert into moc_positions (workspace, moc_id, positions, updated_at) values ($1, $2, $3, $4)
        on conflict(workspace, moc_id) do update set positions = excluded.positions, updated_at = excluded.updated_at`, VAULT, mocId, JSON.stringify(positions), at)
    },
    experts: () => all<{ batchId: string; agentId: string; removedAt: number | null }>('select batch_id as batchId, agent_id as agentId, removed_at as removedAt from proposal_experts order by batch_id'),
    recordExpert(batchId: string, agentId: string, at = clock.now(), removedAt: number | null = null) {
      run(`insert into proposal_experts (batch_id, proposal_id, agent_id, name, domain, created_at, removed_at) values ($1, 'p-1', $2, '時間專家', '時間管理', $3, $4)
        on conflict(batch_id) do update set removed_at = excluded.removed_at`, batchId, agentId, at, removedAt)
    },
  }
}

type Device = ReturnType<typeof createDevice>

function harness() {
  const remote = createMemoryRemote()
  let now = 1_764_000_000_000
  const clock = { now: () => (now += 1_000), peek: () => now }
  const a = createDevice('dev-a', clock)
  const b = createDevice('dev-b', clock)
  const sync = (device: Device, extra: Partial<AlmanacSyncContext> = {}) => runAlmanacSync({
    db: device.db,
    deviceId: device.deviceId,
    deviceName: device.deviceId,
    now: clock.now,
    remotes: { account: remote, library: remote },
    libraryScope: VAULT,
    tables: device.tables,
    ...extra,
  })
  return { remote, a, b, sync, clock }
}

/** 兩台都看過 OLD 版的 MOC（各自建好上次已知狀態），並同步過一輪。 */
async function bothSeeing(raw: string) {
  const h = harness()
  for (const device of [h.a, h.b]) {
    await device.reconcile(raw, [])
    await h.sync(device)
  }
  await h.sync(h.a)
  takeAppWrites()
  return h
}

const doc = (remote: ReturnType<typeof createMemoryRemote>, path: string) => JSON.parse(remote.files.get(`.almanac/v3/${path}`)!.content)

describe('85.4 雙裝置：MOC 上次已知狀態（驗收 #1、#4）', () => {
  it('A 在 Obsidian 改 MOC 收錄 → B 經內建同步寫檔：B 的 MOC 一致、不當成手動編輯，ops／Scott 指定／活動紀錄不重複', async () => {
    const { a, b, sync } = await bothSeeing(OLD)
    // A：Scott 在 Obsidian 加了一則收錄 → 記一筆 ops、一則活動紀錄、一個 Scott 指定。
    expect(await a.reconcile(ADDED, [])).toEqual({ batch: false, recorded: 1 })
    await sync(a)
    // B：內建同步先把 A 的 MOC 檔寫進筆記庫（第一層：記成 App 寫入），這時 B 還沒跑 V3 同步、沒有 A 的基準。
    noteSyncWrite(MOC_PATH, new TextEncoder().encode(ADDED))
    expect(await b.reconcile(ADDED)).toEqual({ batch: false, recorded: 0 })
    expect(await b.baseline()).toBe(ADDED)
    expect(b.opIds()).toEqual([])

    await sync(b)
    await sync(a)
    await sync(b)
    for (const device of [a, b]) {
      expect(device.opIds()).toEqual(a.opIds())
      expect(device.opIds()).toHaveLength(1)
      expect(device.pinRows()).toHaveLength(1)
      expect(device.activity()).toHaveLength(1)
      expect(device.activity()[0].opId).toBe(a.opIds()[0])
    }
  })

  it('A 一次拿掉六則收錄（A 確認過整批檢查）→ B 收到同步來的 MOC 不出「整批檢查」卡；沒有同步標記時才會出', async () => {
    const control = await bothSeeing(BIG)
    // 對照組：B 的檔案被改成 TRIMMED、卻不是同步寫的 → 會出整批檢查卡（確認測試的情境真的會觸發）。
    expect((await control.b.reconcile(TRIMMED, [])).batch).toBe(true)

    const { a, b, sync, clock } = await bothSeeing(BIG)
    expect((await a.reconcile(TRIMMED, [])).batch).toBe(true)
    // A 的 Scott 在卡上按「全部接受」：上次已知狀態換成新內容（settleMocBatch）。
    a.run('update moc_snapshots set content = $1, updated_at = $2 where workspace = $3 and path = $4', TRIMMED, clock.now(), VAULT, MOC_PATH)
    await sync(a)
    noteSyncWrite(MOC_PATH, TRIMMED)
    expect(await b.reconcile(TRIMMED)).toEqual({ batch: false, recorded: 0 })
    expect(await b.baseline()).toBe(TRIMMED)
  })

  it('筆記庫放在 iCloud（第二層）：檔案不是 App 寫的，但內容等於同步來的基準 → 採用、不記 ops，也不再上傳基準', async () => {
    const { a, b, sync, remote } = await bothSeeing(OLD)
    await a.reconcile(ADDED, [])
    await sync(a)
    await sync(b)
    expect(await b.reconcile(ADDED, [])).toEqual({ batch: false, recorded: 0 })
    expect(await b.baseline()).toBe(ADDED)
    expect(b.opIds()).toEqual(a.opIds())
    remote.writes.length = 0
    await sync(b)
    expect(remote.writes.filter(path => path.endsWith('moc-baselines.json'))).toEqual([])
  })

  it('基準比 MOC 檔先到：B 的上次已知狀態不被改掉（不會以為 Scott 改回舊的），也不把舊的推回去', async () => {
    const { a, b, sync, remote } = await bothSeeing(OLD)
    await a.reconcile(ADDED, [])
    await sync(a)
    await sync(b)
    // B 的檔案還是 OLD：比對沒有差異，不記反向操作。
    expect(await b.reconcile(OLD, [])).toEqual({ batch: false, recorded: 0 })
    expect(await b.baseline()).toBe(OLD)
    expect(b.opIds()).toEqual(a.opIds())
    // B 這輪同步不會把舊的基準推回去。
    remote.writes.length = 0
    await sync(b)
    expect(remote.writes.filter(path => path.endsWith('moc-baselines.json'))).toEqual([])
    expect(doc(remote, 'moc-baselines.json').rows[MOC_ID].v.content).toBe(ADDED)
  })

  it('B 在 Obsidian 又改了（晚於 A）：B 的基準較新，推上去；A 收到後內容一致', async () => {
    const { a, b, sync, remote } = await bothSeeing(OLD)
    await a.reconcile(ADDED, [])
    await sync(a)
    await sync(b)
    noteSyncWrite(MOC_PATH, ADDED)
    await b.reconcile(ADDED)
    const later = moc(['- [[筆記A]] ── 出發點', '- [[筆記D]] ── 新想法'])
    expect((await b.reconcile(later, [])).recorded).toBe(1)
    await sync(b)
    expect(doc(remote, 'moc-baselines.json').rows[MOC_ID].v.content).toBe(later)
    await sync(a)
    expect(await listSyncedMocBaselines(a.db, VAULT)).toEqual([{ path: MOC_PATH, mocId: MOC_ID, content: later }])
  })

  it('已建過基準的記號（path＝\'\'）與本機路徑不傳；鍵是 M 編號', async () => {
    const { remote } = await bothSeeing(OLD)
    const file = doc(remote, 'moc-baselines.json')
    expect(Object.keys(file.rows)).toEqual([MOC_ID])
    expect(file.rows[MOC_ID].v).toMatchObject({ path: MOC_PATH, mocId: MOC_ID, content: OLD })
    expect(JSON.stringify(file)).not.toContain(VAULT)
  })
})

describe('85.4 雙裝置：MOC 版面位置、Scott 指定、提案建立的專家（驗收 #1）', () => {
  it('moc_positions：A 存 → B 拿到；兩邊都改時較晚的贏；A 刪掉 → B 也刪', async () => {
    const { a, b, sync, clock } = harness()
    a.savePositions(MOC_ID, { 'N-1': 1 })
    await sync(a)
    await sync(b)
    expect(b.positions().map(row => JSON.parse(row.positions))).toEqual([{ 'N-1': 1 }])

    a.savePositions(MOC_ID, { 'N-1': 2 }, clock.now())
    b.savePositions(MOC_ID, { 'N-1': 3 }, clock.now())
    await sync(a)
    await sync(b)
    await sync(a)
    for (const device of [a, b]) expect(device.positions().map(row => JSON.parse(row.positions))).toEqual([{ 'N-1': 3 }])

    a.run('delete from moc_positions where moc_id = $1', MOC_ID)
    await sync(a)
    await sync(b)
    expect(b.positions()).toEqual([])
  })

  it('M7：舊的 moc_positions 沒有 updated_at → 補上（純加法，原本的列留著）', async () => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec(MOC_POSITIONS_SCHEMA)
    sqlite.prepare("insert into moc_positions (workspace, moc_id, positions) values ('/vault', 'M-1', '{}')").run({})
    const db: AlmanacSqlDb = {
      async execute(sql, values) { return sqlite.prepare(sql).run(bind(values)) },
      async select<T>(sql: string, values?: SqlValue[]) { return sqlite.prepare(sql).all(bind(values)) as T },
    }
    await ensureMocPositionsSchema(db)
    await ensureMocPositionsSchema(db)
    expect(sqlite.prepare('select moc_id as mocId, updated_at as updatedAt from moc_positions').all({})).toEqual([{ mocId: 'M-1', updatedAt: 0 }])
  })

  it('scott_pins：兩台各自標的聯集；同一個位置取較晚的時間', async () => {
    const { a, b, sync, clock } = harness()
    const base = { mocPath: MOC_PATH, mocId: MOC_ID, mocName: '時間管理' }
    const pinA: ScottPin = { ...base, kind: 'position', notePath: NOTES[0], at: clock.now() }
    const pinB: ScottPin = { ...base, kind: 'block', block: 'conclusions', at: clock.now() }
    await a.savePins([pinA])
    await b.savePins([pinB, { ...pinA, at: clock.now() }])
    await sync(a)
    await sync(b)
    await sync(a)
    for (const device of [a, b]) {
      expect(device.pinRows().map(row => row.pinKey).sort()).toEqual([pinKey(pinA), pinKey(pinB)].sort())
      expect(device.pinRows().find(row => row.pinKey === pinKey(pinA))!.pinnedAt).toBe(b.pinRows().find(row => row.pinKey === pinKey(pinA))!.pinnedAt)
    }
  })

  it('scott_pins：過期（90 天）的不上傳、各台自己清，也不發墓碑', async () => {
    const { a, b, sync, clock, remote } = harness()
    const old: ScottPin = { mocPath: MOC_PATH, mocId: MOC_ID, mocName: '時間管理', kind: 'position', notePath: NOTES[1], at: clock.peek() - SCOTT_PIN_TTL_MS - 5_000 }
    const fresh: ScottPin = { ...old, notePath: NOTES[2], at: clock.now() }
    await a.savePins([old, fresh])
    await sync(a)
    expect(Object.keys(doc(remote, 'scott-pins.json').rows)).toEqual([pinKey(fresh)])
    // A 讀取時清掉過期的（同 scottPinStore.active）：不發墓碑。
    a.run('delete from scott_pins where pinned_at <= $1', clock.peek() - SCOTT_PIN_TTL_MS)
    await sync(a)
    await sync(b)
    expect(doc(remote, 'scott-pins.json').deleted).toEqual({})
    expect(b.pinRows().map(row => row.pinKey)).toEqual([pinKey(fresh)])
  })

  it('proposal_experts：removed_at 取最早的非空值；夥伴 id 照別名換成正式 id；超過 30 天的不上傳', async () => {
    const { a, b, sync, clock, remote } = harness()
    a.recordExpert('batch-1', 'expert-b-copy')
    await recordAlias(a.db, AGENT_ALIAS_TABLE, 'expert-b-copy', 'expert-1', clock.now())
    a.recordExpert('batch-old', 'expert-1', clock.peek() - UNDO_WINDOW_MS - 5_000)
    await sync(a)
    await sync(b)
    expect(Object.keys(doc(remote, 'proposal-experts.json').rows)).toEqual(['batch-1'])
    expect(b.experts()).toEqual([{ batchId: 'batch-1', agentId: 'expert-1', removedAt: null }])

    const first = clock.now()
    const second = clock.now()
    b.recordExpert('batch-1', 'expert-1', undefined, second)
    a.run('update proposal_experts set removed_at = $1 where batch_id = $2', first, 'batch-1')
    await sync(b)
    await sync(a)
    await sync(b)
    for (const device of [a, b]) expect(device.experts().find(row => row.batchId === 'batch-1')?.removedAt).toBe(first)
  })
})

describe('adoptSyncedBaselines（設計 2.11 第二層，表格驅動）', () => {
  const synced = (content: string, extra: Partial<SyncedMocBaseline> = {}): SyncedMocBaseline => ({ path: MOC_PATH, mocId: MOC_ID, content, ...extra })
  const cases: Array<{ name: string; baseline: string | null; raw: string; remote: SyncedMocBaseline[]; adopted: boolean }> = [
    { name: '內容等於同步來的基準 → 採用', baseline: OLD, raw: ADDED, remote: [synced(ADDED)], adopted: true },
    { name: '內容跟同步來的不同（Scott 在這台改的）→ 不採用，照常比對', baseline: OLD, raw: ADDED, remote: [synced(BIG)], adopted: false },
    { name: '同步來的基準比檔案新、檔案還是舊的 → 不動', baseline: OLD, raw: OLD, remote: [synced(ADDED)], adopted: false },
    { name: 'M 編號不同 → 不採用', baseline: OLD, raw: ADDED, remote: [synced(ADDED, { mocId: 'M-other' })], adopted: false },
    { name: '這台沒看過這個 MOC、內容等於同步來的 → 採用（不當成整批匯入）', baseline: null, raw: ADDED, remote: [synced(ADDED)], adopted: true },
    { name: '沒有同步來的基準 → 不動', baseline: OLD, raw: ADDED, remote: [], adopted: false },
  ]
  it.each(cases)('$name', ({ baseline, raw, remote, adopted }) => {
    const baselines = new Map<string, MocBaseline>(baseline === null ? [] : [[MOC_PATH, { content: baseline, mocId: MOC_ID }]])
    const dirty = adoptSyncedBaselines(baselines, [{ path: MOC_PATH, raw }], remote, mocIdOf)
    expect(dirty.has(MOC_PATH)).toBe(adopted)
    expect(baselines.get(MOC_PATH)?.content ?? null).toBe(adopted ? raw : baseline)
  })

  it('別台改了 MOC 的路徑（同一個 M 編號）→ 新路徑採用、舊路徑那列拿掉', () => {
    const moved = '20 領域/時間.md'
    const baselines = new Map<string, MocBaseline>([[MOC_PATH, { content: OLD, mocId: MOC_ID }]])
    const dirty = adoptSyncedBaselines(baselines, [{ path: moved, raw: ADDED }], [synced(ADDED, { path: moved })], mocIdOf)
    expect([...dirty]).toEqual([[moved, { content: ADDED, mocId: MOC_ID }], [MOC_PATH, null]])
  })
})

// Fork（almanac ALMNC-85.3）：夥伴、記憶、脈絡、Scott 的偏好、活動紀錄與 ops 的雙裝置模擬（設計 5.2 第二層）。
// 兩份獨立的 node:sqlite（A、B）＋一個記憶體遠端（條件寫入），表用正式的 createCrewTable／createActivityTable／createOpsTable，
// 夥伴與記憶的建表語法用正式的 AGENT_SCHEMA／AGENT_MEMORY_SCHEMA；復原用正式的 ops 服務（檔案換成記憶體版）。
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { runAlmanacSync, type AlmanacSyncContext } from '../engine'
import { createMemoryRemote } from '../remote-memory'
import { resolveAlias } from '../aliases'
import type { AlmanacSqlDb, SqlValue } from '../sql'
import { AGENT_SCHEMA } from '@/lib/agents/schema'
import { DEFAULT_ROSTER, ROLE_TOOLS } from '@/lib/agents/settings'
import { AGENT_MEMORY_SCHEMA, type ActivityMigrationStatement } from '@/lib/agent-memory/schema'
import { createOpsService } from '@/lib/ops/service'
import { createMemoryOpsIo } from '@/lib/ops/testing'
import { UNDO_WINDOW_MS } from '@/lib/ops/types'
import { createOpsDbStore } from '@/db/ops'
import { AGENT_ALIAS_TABLE, createCrewTable } from './crew'
import { createActivityTable } from './activity'
import { createOpsTable } from './ops'
import { listSyncConflicts, resolvedText } from './conflicts'
import { listPendingRecordDeletions } from './pending-records'

type Bindings = Record<string, SqlValue>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): { all(bindings: Bindings): unknown[]; run(bindings: Bindings): { changes: number; lastInsertRowid: number | bigint } }
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const bind = (values: SqlValue[] = []) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

function createDevice(deviceId: string, clock: { now(): number }) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('create table conversations (id integer primary key autoincrement, syncId text unique, title text)')
  for (const sql of [...AGENT_SCHEMA, ...AGENT_MEMORY_SCHEMA]) sqlite.exec(sql)
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
      for (const statement of statements) {
        const result = sqlite.prepare(statement.sql).run(bind(statement.values))
        if (statement.expectedRows !== undefined && result.changes !== statement.expectedRows) throw new Error('row count mismatch')
      }
      sqlite.exec('commit')
    } catch (error) {
      sqlite.exec('rollback')
      throw error
    }
  }
  let pendingNotices = 0
  let conflictNotices = 0
  const tables = [
    createCrewTable({ onPendingChanged: () => pendingNotices++, onConflictsChanged: () => conflictNotices++ }),
    createActivityTable({ runTransaction }),
    createOpsTable(),
  ]

  /** 第一次使用：建預設的指揮官、秘書、研究員（同 ensureDefaultRoster，id 是亂數）。 */
  function seedDefaultRoster() {
    const at = clock.now()
    for (const agent of DEFAULT_ROSTER) {
      run(`insert into agent_settings (id, name, role, domain, enabled, allowed_tools, created_at, updated_at) values ($1, $2, $3, null, 1, $4, $5, $5)`,
        `${deviceId}-${agent.role}`, agent.name, agent.role, JSON.stringify(agent.allowedTools), at)
    }
  }

  const opsFiles: Record<string, string> = {}
  const io = createMemoryOpsIo(opsFiles)
  const opsStore = createOpsDbStore(() => '/vault', async () => db)

  return {
    deviceId,
    db,
    tables,
    all,
    run,
    files: opsFiles,
    get pendingNotices() { return pendingNotices },
    get conflictNotices() { return conflictNotices },
    seedDefaultRoster,
    agents: () => all<{ id: string; name: string; role: string; domain: string | null; createdAt: number }>(
      'select id, name, role, domain, created_at as createdAt from agent_settings order by role, id'),
    agentByRole: (role: string) => all<{ id: string; name: string }>('select id, name from agent_settings where role = $1', role)[0],
    rename(role: string, name: string) {
      run('update agent_settings set name = $1, updated_at = $2 where role = $3', name, clock.now(), role)
    },
    addExpert(id: string, name: string, domain: string) {
      const at = clock.now()
      run(`insert into agent_settings (id, name, role, domain, enabled, allowed_tools, created_at, updated_at) values ($1, $2, 'expert', $3, 1, $4, $5, $5)`,
        id, name, domain, JSON.stringify(ROLE_TOOLS.expert), at)
    },
    writeMemory(agentId: string, kind: string, content: string, by = 'scott') {
      run(`insert into agent_memory (agent_id, kind, content, updated_at, updated_by) values ($1, $2, $3, $4, $5)
        on conflict(agent_id, kind) do update set content = excluded.content, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      agentId, kind, content, clock.now(), by)
    },
    memory: (agentId: string, kind: string) => all<{ content: string; updatedBy: string }>(
      'select content, updated_by as updatedBy from agent_memory where agent_id = $1 and kind = $2', agentId, kind)[0],
    setPreferences(content: string) {
      run(`insert into scott_preferences (id, content, updated_at) values (1, $1, $2)
        on conflict(id) do update set content = excluded.content, updated_at = excluded.updated_at`, content, clock.now())
    },
    preferences: () => all<{ content: string }>('select content from scott_preferences where id = 1')[0]?.content ?? '',
    setContext(context: { projects?: unknown[]; weeklyFocus?: unknown[]; people?: unknown[] }, by = 'commander') {
      const current = all<{ projects: string; weeklyFocus: string; people: string }>(
        'select projects, weekly_focus as weeklyFocus, people from shared_context where id = 1')[0]
      run(`insert into shared_context (id, projects, weekly_focus, people, updated_at, updated_by) values (1, $1, $2, $3, $4, $5)
        on conflict(id) do update set projects = excluded.projects, weekly_focus = excluded.weekly_focus, people = excluded.people,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      JSON.stringify(context.projects ?? JSON.parse(current?.projects ?? '[]')),
      JSON.stringify(context.weeklyFocus ?? JSON.parse(current?.weeklyFocus ?? '[]')),
      JSON.stringify(context.people ?? JSON.parse(current?.people ?? '[]')), clock.now(), by)
    },
    context: () => {
      const row = all<{ projects: string; weeklyFocus: string; people: string }>('select projects, weekly_focus as weeklyFocus, people from shared_context where id = 1')[0]
      return row ? { projects: JSON.parse(row.projects), weeklyFocus: JSON.parse(row.weeklyFocus), people: JSON.parse(row.people) } : null
    },
    /** 同 appendActivity：本機另給整數 id，uid 留空（下一輪同步補）。 */
    log(entry: { action: string; note?: string; correctsId?: number | null; opId?: string | null; actorId?: string; actorRole?: string; at?: number; sourceKind?: string; sourceRef?: string }) {
      const result = run(`insert into activity_log (at, actor_id, actor_role, action, target_link, source_kind, source_ref, note, corrects_id, op_id)
        values ($1, $2, $3, $4, 'note:a.md', $5, $6, $7, $8, $9)`,
      entry.at ?? clock.now(), entry.actorId ?? 'scott', entry.actorRole ?? 'scott', entry.action, entry.sourceKind ?? 'proposal',
      entry.sourceRef ?? 'collect:1:1', entry.note ?? '', entry.correctsId ?? null, entry.opId ?? null)
      return Number(result.lastInsertRowid)
    },
    activity: () => all<{ id: number; at: number; action: string; note: string; uid: string; correctsId: number | null; correctsUid: string | null; originDevice: string; opId: string | null; sourceRef: string }>(
      `select id, at, action, note, uid, corrects_id as correctsId, corrects_uid as correctsUid, origin_device as originDevice, op_id as opId,
        source_ref as sourceRef from activity_log order by at, id`),
    ops: () => createOpsService({ fs: io.fs, writer: io.writer, store: opsStore, now: () => clock.now() }),
    opsStore,
  }
}

type Device = ReturnType<typeof createDevice>

function harness() {
  const remote = createMemoryRemote()
  let now = 1_764_000_000_000
  const clock = { now: () => (now += 1_000), set: (value: number) => { now = value }, peek: () => now }
  const a = createDevice('dev-a', clock)
  const b = createDevice('dev-b', clock)
  const sync = (device: Device, extra: Partial<AlmanacSyncContext> = {}) => runAlmanacSync({
    db: device.db,
    deviceId: device.deviceId,
    deviceName: device.deviceId,
    now: clock.now,
    remotes: { account: remote, library: remote },
    libraryScope: '/vault',
    tables: device.tables,
    ...extra,
  })
  return { remote, a, b, sync, clock }
}

const crewDoc = (remote: ReturnType<typeof createMemoryRemote>) => JSON.parse(remote.files.get('.data/almanac/crew.json')!.content)

describe('85.3 雙裝置：夥伴（agent_settings）', () => {
  it('兩台各自建預設夥伴後 A 改名：A 的名字留下，B 的指揮官改用 A 的 id（舊 id 進別名表）', async () => {
    const { a, b, sync, remote } = harness()
    a.seedDefaultRoster()
    await sync(a)
    b.seedDefaultRoster() // B 剛裝好：時間比 A 新，但只是預設值
    a.rename('commander', 'Ava')
    await sync(a)
    await sync(b, { firstSync: true })
    await sync(a)

    for (const device of [a, b]) {
      expect(device.agentByRole('commander')).toEqual({ id: 'dev-a-commander', name: 'Ava' })
      expect(device.agents().map(agent => agent.role).sort()).toEqual(['commander', 'researcher', 'secretary'])
    }
    expect(await resolveAlias(b.db, AGENT_ALIAS_TABLE, 'dev-b-commander')).toBe('dev-a-commander')
    expect(crewDoc(remote).rows['agent:role:commander'].v).toMatchObject({ id: 'dev-a-commander', name: 'Ava' })
  })

  it('B 先同步上傳預設、A 之後改名才第一次同步：A 的名字留下，id 取建立較早的', async () => {
    const { a, b, sync } = harness()
    a.seedDefaultRoster()
    b.seedDefaultRoster()
    await sync(b)
    a.rename('secretary', 'Lena')
    await sync(a, { firstSync: true })
    await sync(b)
    for (const device of [a, b]) expect(device.agentByRole('secretary')).toEqual({ id: 'dev-a-secretary', name: 'Lena' })
  })

  it('B 改了秘書的記憶：指揮官 id 換成正式 id 後，記憶跟著那位夥伴，不會變成孤兒', async () => {
    const { a, b, sync } = harness()
    a.seedDefaultRoster()
    b.seedDefaultRoster()
    b.writeMemory('dev-b-commander', 'soul', '我是 Mia（B 台寫的）')
    await sync(a)
    await sync(b)
    expect(b.agentByRole('commander').id).toBe('dev-a-commander')
    expect(b.memory('dev-a-commander', 'soul')?.content).toBe('我是 Mia（B 台寫的）')
    await sync(a)
    expect(a.memory('dev-a-commander', 'soul')?.content).toBe('我是 Mia（B 台寫的）')
  })

  it('兩台各自新增同名同領域的專家：視為同一位（建立較早的 id）；同領域不同名就兩位都留', async () => {
    const { a, b, sync } = harness()
    a.addExpert('exp-a', 'Iris', '工業工程')
    b.addExpert('exp-b', 'Iris', '工業工程')
    b.addExpert('exp-b2', 'Owen', '工業工程')
    await sync(a)
    await sync(b)
    await sync(a)
    await sync(b)
    for (const device of [a, b]) {
      expect(device.agents().filter(agent => agent.role === 'expert').map(agent => agent.id).sort()).toEqual(['exp-a', 'exp-b2'])
    }
    expect(await listPendingRecordDeletions(a.db)).toEqual([])
    expect(await listPendingRecordDeletions(b.db)).toEqual([])
  })

  it('B 刪了專家：A 進待確認清單（設定與夥伴），本機先保留、也不推回遠端', async () => {
    const { a, b, sync, remote } = harness()
    a.addExpert('exp-1', 'Iris', '工業工程')
    a.writeMemory('exp-1', 'soul', 'Iris 的 soul')
    await sync(a)
    await sync(b)
    b.run('delete from agent_memory where agent_id = $1', 'exp-1')
    b.run('delete from agent_settings where id = $1', 'exp-1')
    await sync(b)
    await sync(a)

    expect(a.agents().map(agent => agent.id)).toEqual(['exp-1'])
    expect(await listPendingRecordDeletions(a.db)).toMatchObject([{ tableName: 'crew', syncKey: 'agent:exp-1', title: 'Iris（工業工程）', status: 'pending' }])
    expect(a.pendingNotices).toBe(1)
    const doc = JSON.parse(remote.files.get('.data/almanac/crew.json')!.content)
    expect(doc.rows['agent:exp-1']).toBeUndefined()
    expect(doc.deleted['agent:exp-1']).toBeDefined()
  })
})

describe('85.3 雙裝置：記憶、目前脈絡、Scott 的偏好', () => {
  it('A、B 都改 Scott 偏好的同一段：出確認卡、兩版都在；這台的版本先留著', async () => {
    const { a, b, sync } = harness()
    a.setPreferences('# 偏好\n回覆用繁體中文\n先講結論')
    await sync(a)
    await sync(b)
    a.setPreferences('# 偏好\n回覆用繁體中文，語氣輕鬆\n先講結論')
    b.setPreferences('# 偏好\n回覆用繁體中文，條列為主\n先講結論')
    await sync(a)
    await sync(b)

    const conflicts = await listSyncConflicts(b.db)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ subject: 'preferences', status: 'open' })
    expect(conflicts[0].local).toContain('條列為主')
    expect(conflicts[0].remote).toContain('語氣輕鬆')
    expect(b.preferences()).toContain('條列為主')
    expect(b.conflictNotices).toBe(1)
    // 選「用另一台的」：衝突段換成另一台的版本。
    expect(resolvedText(conflicts[0], b.preferences(), { kind: 'remote' })).toBe('# 偏好\n回覆用繁體中文，語氣輕鬆\n先講結論')
    // A 沒有卡片（A 的版本沒被動）；下一輪同步不會重複出卡。
    expect(await listSyncConflicts(a.db)).toEqual([])
    await sync(b)
    expect(await listSyncConflicts(b.db)).toHaveLength(1)
  })

  it('A、B 改 Scott 偏好的不同段：自動合併、不出卡', async () => {
    const { a, b, sync } = harness()
    a.setPreferences('第一段\n\n第二段\n\n第三段')
    await sync(a)
    await sync(b)
    a.setPreferences('第一段（A 改）\n\n第二段\n\n第三段')
    b.setPreferences('第一段\n\n第二段\n\n第三段（B 改）')
    await sync(a)
    await sync(b)
    await sync(a)
    for (const device of [a, b]) expect(device.preferences()).toBe('第一段（A 改）\n\n第二段\n\n第三段（B 改）')
    expect(await listSyncConflicts(a.db)).toEqual([])
    expect(await listSyncConflicts(b.db)).toEqual([])
  })

  it('soul 同段兩種改法 → 出卡（標出哪位夥伴）；工作筆記兩台各加的行都留、不出卡；updated_by 保留原寫入者', async () => {
    const { a, b, sync } = harness()
    a.addExpert('exp-1', 'Iris', '工業工程')
    a.writeMemory('exp-1', 'soul', '語氣：精確')
    a.writeMemory('exp-1', 'work_notes', '- 筆記 1\n')
    await sync(a)
    await sync(b)
    a.writeMemory('exp-1', 'soul', '語氣：精確、簡短')
    b.writeMemory('exp-1', 'soul', '語氣：精確、溫和')
    a.writeMemory('exp-1', 'work_notes', '- 筆記 1\n- A 加的\n', 'exp-1')
    b.writeMemory('exp-1', 'work_notes', '- 筆記 1\n- B 加的\n', 'exp-1')
    await sync(a)
    await sync(b)
    await sync(a)

    expect(await listSyncConflicts(b.db)).toMatchObject([{ subject: 'soul', agentName: 'Iris', agentId: 'exp-1' }])
    for (const device of [a, b]) {
      expect(device.memory('exp-1', 'work_notes')).toEqual({ content: '- 筆記 1\n- B 加的\n- A 加的\n', updatedBy: 'exp-1' })
    }
  })

  it('目前脈絡：兩邊改不同欄各取各的，改同一欄較晚的贏，不出卡', async () => {
    const { a, b, sync } = harness()
    a.setContext({ projects: [{ title: '專案 X' }], weeklyFocus: [], people: ['Amy'] })
    await sync(a)
    await sync(b)
    a.setContext({ projects: [{ title: '專案 Y' }] })
    b.setContext({ people: ['Amy', 'Ben'] })
    b.setContext({ weeklyFocus: [{ title: '本週：寫報告' }] })
    await sync(a)
    await sync(b)
    await sync(a)
    for (const device of [a, b]) {
      expect(device.context()).toEqual({ projects: [{ title: '專案 Y' }], weeklyFocus: [{ title: '本週：寫報告' }], people: ['Amy', 'Ben'] })
    }
    expect(await listSyncConflicts(b.db)).toEqual([])
  })
})

describe('85.3 雙裝置：活動紀錄（只能新增）', () => {
  it('5A：以前的紀錄連同新紀錄全部上傳、每筆標裝置；兩台合併後順序正確、不重複', async () => {
    const { a, b, sync } = harness()
    a.log({ action: 'created', note: 'A1' })
    b.log({ action: 'created', note: 'B1' })
    a.log({ action: 'updated', note: 'A2' })
    await sync(a)
    await sync(b)
    b.log({ action: 'linked', note: 'B2' })
    await sync(b)
    await sync(a)
    await sync(b)
    await sync(a)

    for (const device of [a, b]) {
      expect(device.activity().map(entry => entry.note)).toEqual(['A1', 'B1', 'A2', 'B2'])
      expect(device.activity().map(entry => entry.originDevice)).toEqual(['dev-a', 'dev-b', 'dev-a', 'dev-b'])
      expect(new Set(device.activity().map(entry => entry.uid)).size).toBe(4)
    }
    expect(a.activity().find(entry => entry.note === 'B1')?.uid).toBe('dev-b:1')
  })

  it('更正鏈：更正與被更正的那筆在兩台的檔案裡分開到、晚到也接得起來', async () => {
    const { a, b, sync } = harness()
    const original = a.log({ action: 'created', note: '記錯的' })
    a.log({ action: 'corrected', note: '更正', correctsId: original })
    await sync(a)
    await sync(b)
    const [first, second] = b.activity()
    expect(first.note).toBe('記錯的')
    expect(second).toMatchObject({ note: '更正', correctsUid: 'dev-a:1', correctsId: first.id })
  })

  it('對話來源換成 conv:<syncId>，另一台有那個對話就換回本機編號；沒有就保留 conv:<syncId>', async () => {
    const { a, b, sync } = harness()
    a.run("insert into conversations (id, syncId, title) values (7, 'sync-7', 'x')")
    a.run("insert into conversations (id, syncId, title) values (8, 'sync-8', 'y')")
    b.run("insert into conversations (id, syncId, title) values (3, 'sync-7', 'x')")
    a.log({ action: 'instructed', sourceKind: 'conversation', sourceRef: '7' })
    a.log({ action: 'instructed', sourceKind: 'conversation', sourceRef: '8' })
    await sync(a)
    await sync(b)
    expect(b.activity().map(entry => entry.sourceRef)).toEqual(['3', 'conv:sync-8'])
    expect(a.activity().map(entry => entry.sourceRef)).toEqual(['7', '8'])
  })
})

describe('85.3 雙裝置：跨裝置復原（85.3 #3）', () => {
  const NOTE = '10 知識/a.md'
  async function applyEditOnA(a: Device, b: Device) {
    a.files[NOTE] = '原本'
    const [record] = await a.ops().applyOps([{ kind: 'note.edit', path: NOTE, title: 'a', before: '原本', after: 'A 改過' }], { actor: 'scott', actorId: 'scott' })
    a.log({ action: 'updated', opId: record.id, sourceRef: `op:${record.id}` })
    // 檔案同步（一般筆記同步）把 A 改過的內容帶到 B。
    b.files[NOTE] = a.files[NOTE]
    return record
  }

  it('A 的操作在 B 復原：B 的檔案還原、A 也看到已復原（復原事件記在 B 的檔）', async () => {
    const { a, b, sync, remote } = harness()
    const record = await applyEditOnA(a, b)
    await sync(a)
    await sync(b)
    const activity = b.activity().find(entry => entry.opId === record.id)
    expect(activity).toBeDefined()
    const result = await b.ops().undoOp(record.id)
    expect(result.status).toBe('undone')
    expect(b.files[NOTE]).toBe('原本')
    await sync(b)
    await sync(a)
    expect((await a.opsStore.get(record.id))?.undoneAt).not.toBeNull()
    expect([...remote.files.keys()].filter(path => path.startsWith('.almanac/v3/ops/dev-b/') && !path.endsWith('index.json'))).toHaveLength(1)
    // A 不能再復原一次。
    expect((await a.ops().undoOp(record.id)).status).toBe('already-undone')
  })

  it('B 的檔案還沒同步到：復原前版本檢查擋下（回傳比較卡，不覆蓋）', async () => {
    const { a, b, sync } = harness()
    const record = await applyEditOnA(a, b)
    b.files[NOTE] = '原本' // B 還沒收到 A 改過的版本
    await sync(a)
    await sync(b)
    const result = await b.ops().undoOp(record.id)
    expect(result.status).toBe('conflict')
    expect(b.files[NOTE]).toBe('原本')
  })

  it('超過 30 天的操作：B 不收（不能復原）', async () => {
    const { a, b, sync, clock } = harness()
    const record = await applyEditOnA(a, b)
    clock.set(clock.peek() + UNDO_WINDOW_MS + 60_000)
    await sync(a)
    await sync(b)
    expect(await b.opsStore.get(record.id)).toBeNull()
  })

  it('復原事件比操作先到（第三台先讀到 B 的檔、A 的檔還沒讀）：操作到了再補上已復原', async () => {
    const { a, b, sync } = harness()
    const record = await applyEditOnA(a, b)
    await sync(a)
    await sync(b)
    await b.ops().undoOp(record.id)
    // 第三台 C：依相反順序收到 B 的復原事件與 A 的操作。
    const c = createDevice('dev-c', { now: () => Date.now() })
    const opsTable = createOpsTable()
    const context = { db: c.db, deviceId: 'dev-c', now: () => Date.now(), firstSync: false, libraryScope: '/vault' }
    await opsTable.applyRemote(context, [{ uid: `undo:dev-b:${record.id}`, at: 5, type: 'undo', device: 'dev-b', opId: record.id }])
    const fromA = await opsTable.readOwn({ ...context, db: a.db, deviceId: 'dev-a' })
    await opsTable.applyRemote(context, fromA.filter(entry => entry.type === 'op'))
    expect((await c.opsStore.get(record.id))?.undoneAt).toBe(5)
  })
})

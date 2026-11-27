// Fork（almanac ALMNC-85.4）：proposals.json 新增的兩區（先放著 aside:、等你回話 awaiting:，設計 2.16）與提案起草者的夥伴別名（85.3 留下的一項）。
// 兩份 node:sqlite（對話表、別名表）＋記憶體遠端，表用正式的 createProposalsTable，store 換成記憶體版。
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { runAlmanacSync } from '../engine'
import { createMemoryRemote } from '../remote-memory'
import { recordAlias } from '../aliases'
import type { AlmanacSqlDb, SqlValue } from '../sql'
import { AGENT_ALIAS_TABLE } from './crew'
import {
  createProposalsTable, resolveProposalDrafter,
  type ProposalsAccess, type ProposalsChange, type ProposalsSnapshot, type SyncAwaitingEntry, type SyncCollectItem,
} from './proposals'

type Bindings = Record<string, SqlValue>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): { all(bindings: Bindings): unknown[]; run(bindings: Bindings): { changes: number } }
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const bind = (values: SqlValue[] = []) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

function memoryProposals(): ProposalsAccess & { state: Required<ProposalsSnapshot> } {
  const state: Required<ProposalsSnapshot> = { items: [], trail: {}, weeklySent: [], cleanup: [], aside: {}, awaiting: {}, awaitingRemote: {} }
  return {
    state,
    async load() {
      return JSON.parse(JSON.stringify(state)) as ProposalsSnapshot
    },
    async apply(change: ProposalsChange) {
      const incoming = new Map(change.items.upserts.map(item => [item.id, item]))
      state.items = [
        ...state.items.filter(item => !change.items.deletes.includes(item.id)).map(item => incoming.get(item.id) ?? item),
        ...change.items.upserts.filter(item => !state.items.some(existing => existing.id === item.id)),
      ]
      Object.assign(state.aside, change.aside?.upserts ?? {})
      for (const key of change.aside?.deletes ?? []) delete state.aside[key]
      for (const entry of change.awaiting?.upserts ?? []) state.awaiting[String(entry.conversationId)] = entry
      for (const id of change.awaiting?.deletes ?? []) delete state.awaiting[String(id)]
      for (const [syncId, value] of Object.entries(change.awaiting?.remote ?? {})) {
        if (value) state.awaitingRemote[syncId] = value
        else delete state.awaitingRemote[syncId]
      }
    },
  }
}

function createDevice(deviceId: string) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('create table conversations (id integer primary key autoincrement, syncId text unique, title text)')
  const db: AlmanacSqlDb = {
    async execute(sql, values) { return sqlite.prepare(sql).run(bind(values)) },
    async select<T>(sql: string, values?: SqlValue[]) { return sqlite.prepare(sql).all(bind(values)) as T },
  }
  const proposals = memoryProposals()
  return {
    deviceId,
    db,
    state: proposals.state,
    tables: [createProposalsTable(proposals)],
    addConversation: (id: number, syncId: string) => sqlite.prepare('insert into conversations (id, syncId, title) values ($1, $2, $3)').run(bind([id, syncId, 'chat'])),
  }
}

function harness() {
  const remote = createMemoryRemote()
  let now = 1_764_000_000_000
  const clock = () => (now += 1_000)
  const a = createDevice('dev-a')
  const b = createDevice('dev-b')
  const sync = (device: ReturnType<typeof createDevice>) => runAlmanacSync({
    db: device.db, deviceId: device.deviceId, deviceName: device.deviceId, now: clock,
    remotes: { account: remote, library: remote }, libraryScope: '/vault', tables: device.tables,
  })
  return { a, b, sync, remote, clock }
}

const awaiting = (conversationId: number, question: string, at: number, extra: Partial<SyncAwaitingEntry> = {}): SyncAwaitingEntry => ({
  conversationId, chatId: 90 + conversationId, question, at, via: 'turn', ...extra,
})

describe('85.4 先放著（workbenchAside）逐筆合併', () => {
  it('兩台各自先放著不同卡片 → 兩張都留（整個 key 覆寫會丟一邊）；一台拿回來 → 另一台也拿回來', async () => {
    const { a, b, sync, clock } = harness()
    a.state.aside['source:src_1'] = { at: clock(), title: '資料源一' }
    b.state.aside['reply:7'] = { at: clock(), title: '回話', until: '2026-12-01' }
    await sync(a)
    await sync(b)
    await sync(a)
    for (const device of [a, b]) expect(Object.keys(device.state.aside).sort()).toEqual(['reply:7', 'source:src_1'])
    expect(a.state.aside['reply:7']).toEqual({ at: expect.any(Number), title: '回話', until: '2026-12-01' })

    delete b.state.aside['source:src_1']
    await sync(b)
    await sync(a)
    expect(Object.keys(a.state.aside)).toEqual(['reply:7'])
  })

  it('同一張卡兩台都改了提醒日期 → 較晚的贏', async () => {
    const { a, b, sync, clock } = harness()
    a.state.aside.k = { at: clock(), title: 'T' }
    await sync(a)
    await sync(b)
    a.state.aside.k = { at: clock(), title: 'T', until: '2026-12-01' }
    b.state.aside.k = { at: clock(), title: 'T', until: '2026-12-08' }
    await sync(a)
    await sync(b)
    await sync(a)
    for (const device of [a, b]) expect(device.state.aside.k.until).toBe('2026-12-08')
  })
})

describe('85.4 等你回話（awaitingReplies）逐筆合併，對話編號換成 syncId（M2）', () => {
  it('兩台的對話編號不同：以 syncId 對上，收進來換回本機編號；本機訊息編號不傳', async () => {
    const { a, b, sync, remote, clock } = harness()
    a.addConversation(3, 'conv-shared')
    b.addConversation(11, 'conv-shared')
    a.state.awaiting['3'] = awaiting(3, '下週要不要排出差？', clock())
    await sync(a)
    await sync(b)
    expect(b.state.awaiting['11']).toMatchObject({ conversationId: 11, chatId: 0, question: '下週要不要排出差？', via: 'turn' })
    const file = JSON.parse(remote.files.get('.data/almanac/proposals.json')!.content)
    expect(file.rows['awaiting:conv-shared'].v).toEqual({ question: '下週要不要排出差？', at: expect.any(Number) })

    // B 回話了（拿掉）→ A 也拿掉。
    delete b.state.awaiting['11']
    await sync(b)
    await sync(a)
    expect(a.state.awaiting).toEqual({})
  })

  it('另一台的對話這台還沒有：先記著、不刪別台的，對話同步到之後才放進等你回話', async () => {
    const { a, b, sync, remote, clock } = harness()
    a.addConversation(3, 'conv-new')
    a.state.awaiting['3'] = awaiting(3, '要買哪一台？', clock())
    await sync(a)
    await sync(b)
    expect(b.state.awaiting).toEqual({})
    expect(Object.keys(b.state.awaitingRemote)).toEqual(['conv-new'])
    await sync(b)
    expect(JSON.parse(remote.files.get('.data/almanac/proposals.json')!.content).rows['awaiting:conv-new']).toBeDefined()

    b.addConversation(5, 'conv-new')
    await sync(b)
    expect(b.state.awaiting['5']).toMatchObject({ conversationId: 5, question: '要買哪一台？' })
    expect(b.state.awaitingRemote).toEqual({})
  })

  it('ask_user_question 開著（via＝live）是這台正在跑的執行：不傳，也不被同步來的蓋掉；沒有 syncId 的對話不傳', async () => {
    const { a, b, sync, remote, clock } = harness()
    a.addConversation(3, 'conv-x')
    b.addConversation(4, 'conv-x')
    a.state.awaiting['3'] = awaiting(3, '選哪個？', clock(), { via: 'live', choices: ['A', 'B'] })
    a.state.awaiting['8'] = awaiting(8, '沒有 syncId', clock())
    await sync(a)
    const rows = JSON.parse(remote.files.get('.data/almanac/proposals.json')!.content).rows
    expect(Object.keys(rows).filter(key => key.startsWith('awaiting:'))).toEqual([])

    b.state.awaiting['4'] = awaiting(4, 'B 這邊的問句', clock())
    await sync(b)
    await sync(a)
    expect(a.state.awaiting['3'].via).toBe('live')
  })
})

describe('85.4 提案起草者的夥伴別名（接手 85.3 待確認第 3 題）', () => {
  it('resolveProposalDrafter：舊 id 換成正式 id；不是別名或沒有起草者就原樣', async () => {
    const { a } = harness()
    await recordAlias(a.db, AGENT_ALIAS_TABLE, 'dev-b-secretary', 'dev-a-secretary', 1)
    const cases = [
      { drafter: { role: 'secretary', agentId: 'dev-b-secretary' }, expected: 'dev-a-secretary' },
      { drafter: { role: 'secretary', agentId: 'dev-a-secretary' }, expected: 'dev-a-secretary' },
      { drafter: { role: 'commander' }, expected: undefined },
    ]
    for (const { drafter, expected } of cases) expect((await resolveProposalDrafter(a.db, { drafter })).drafter?.agentId).toBe(expected)
    const plain = { id: 'p' } as { id: string; drafter?: { role: string; agentId?: string } }
    expect(await resolveProposalDrafter(a.db, plain)).toBe(plain)
  })

  it('B 的提案由 B 的秘書起草；秘書併成 A 的那位之後，A、B 的提案都指向正式 id（別名留著，舊 id 仍查得到）', async () => {
    const { a, b, sync, clock } = harness()
    await recordAlias(b.db, AGENT_ALIAS_TABLE, 'dev-b-secretary', 'dev-a-secretary', clock())
    await recordAlias(a.db, AGENT_ALIAS_TABLE, 'dev-b-secretary', 'dev-a-secretary', clock())
    const item: SyncCollectItem = {
      id: 'item-1', createdAt: clock(),
      proposals: [{ id: 'p-1', status: 'wait', drafter: { role: 'secretary', agentId: 'dev-b-secretary' } }],
    }
    b.state.items = [item]
    await sync(b)
    await sync(a)
    await sync(b)
    for (const device of [a, b]) expect(device.state.items[0].proposals[0].drafter).toEqual({ role: 'secretary', agentId: 'dev-a-secretary' })
  })
})

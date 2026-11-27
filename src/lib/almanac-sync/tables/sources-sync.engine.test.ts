// Fork（almanac ALMNC-85.2）：資料源、RSS 訂閱、提案三張表的雙裝置模擬（設計 5.2 第二層）。
// 兩份獨立的 node:sqlite（A、B）＋一個記憶體遠端（條件寫入），表用正式的 createSourcesTable／createFeedsTable／createProposalsTable，
// RSS 匯入用正式的排程邏輯（applyParsedFeed＋planNewItems），只有「存成資料源」與訂閱清單換成記憶體版。
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { runAlmanacSync, type AlmanacSyncContext } from '../engine'
import { createMemoryRemote } from '../remote-memory'
import { resolveAlias } from '../aliases'
import type { AlmanacSqlDb, SqlValue } from '../sql'
import { applyParsedFeed, type RssDeps } from '@/lib/source-import/rss-scheduler'
import { rssSourceInputs, type FeedItem, type ParsedFeed } from '@/lib/source-import/rss'
import { createFeed, type RssFeed } from '@/lib/source-import/rss-feeds'
import { createSource, sourceToValues } from '@/lib/v3-model/source'
import { createSourcesTable, ensureSourceSyncSchema, conflictVersionId } from './sources'
import { createFeedsTable, type FeedsAccess } from './feeds'
import { createProposalsTable, type ProposalsAccess, type ProposalsChange, type ProposalsSnapshot, type SyncCollectItem } from './proposals'
import { listPendingRecordDeletions, markPendingRecordDeletion } from './pending-records'

type Bindings = Record<string, SqlValue>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): { all(bindings: Bindings): unknown[]; run(bindings: Bindings): { changes: number } }
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const bind = (values: SqlValue[] = []) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

function memoryProposals(): ProposalsAccess & { state: ProposalsSnapshot } {
  const state: ProposalsSnapshot = { items: [], trail: {}, weeklySent: [], cleanup: [] }
  return {
    state,
    async load() {
      return JSON.parse(JSON.stringify(state)) as ProposalsSnapshot
    },
    async apply(change: ProposalsChange) {
      const removed = new Set(change.items.deletes)
      const incoming = new Map(change.items.upserts.map(item => [item.id, item]))
      state.items = [
        ...state.items.filter(item => !removed.has(item.id)).map(item => incoming.get(item.id) ?? item),
        ...change.items.upserts.filter(item => !state.items.some(existing => existing.id === item.id)),
      ]
      state.trail = { ...state.trail, ...change.trail.upserts }
      for (const key of change.trail.deletes) delete state.trail[key]
      state.weeklySent = Array.from(new Set([...state.weeklySent, ...change.weekly.add]))
      const cleanupRemoved = new Set(change.cleanup.deletes)
      state.cleanup = [
        ...state.cleanup.filter(entry => !cleanupRemoved.has(entry.key) && !change.cleanup.upserts.some(next => next.key === entry.key)),
        ...change.cleanup.upserts,
      ]
    },
  }
}

function createDevice(deviceId: string, clock: () => number) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('create table conversations (id integer primary key autoincrement, syncId text unique, title text)')
  const db: AlmanacSqlDb = {
    async execute(sql, values) {
      return sqlite.prepare(sql).run(bind(values))
    },
    async select<T>(sql: string, values?: SqlValue[]) {
      return sqlite.prepare(sql).all(bind(values)) as T
    },
  }
  const all = <T>(sql: string, ...values: SqlValue[]) => sqlite.prepare(sql).all(bind(values)) as T[]
  const run = (sql: string, ...values: SqlValue[]) => sqlite.prepare(sql).run(bind(values))

  let feeds: RssFeed[] = []
  let pendingNotices = 0
  const feedsAccess: FeedsAccess = {
    async load() {
      return feeds.map(feed => ({ ...feed, seen: [...feed.seen] }))
    },
    async update(mutator) {
      feeds = mutator(feeds.map(feed => ({ ...feed, seen: [...feed.seen] })))
    },
    onPendingChanged() {
      pendingNotices++
    },
  }
  const proposals = memoryProposals()
  const tables = [createSourcesTable(), createFeedsTable(feedsAccess), createProposalsTable(proposals)]

  async function insertSource(input: Parameters<typeof createSource>[0], at = clock()) {
    await ensureSourceSyncSchema(db)
    const exists = all('select id from sources where id = $1 or legacy_id = $1', input.id)
    if (exists.length) return false
    const source = createSource(input, at)
    run(`insert into sources (id, source_type, kind, content, origin, collected_at, collector, status, status_changed_at,
      version, previous_id, locked_at, archived_at, created_at, updated_at, is_journal) values
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`, ...sourceToValues(source))
    return true
  }

  /** 正式的 RSS 排程邏輯：挑新文章、存成資料源（內容決定的 id）、更新 seen。 */
  function rssDeps(): RssDeps {
    return {
      now: clock,
      fetchText: async () => { throw new Error('not used') },
      getFeeds: () => feeds,
      updateFeed: (id, update) => { feeds = feeds.map(feed => (feed.id === id ? update(feed) : feed)) },
      addItems: async (feed, items) => {
        let added = 0
        for (const input of rssSourceInputs(feed, items)) {
          if (await insertSource({ ...input, sourceType: 'external', collector: 'scott' })) added++
        }
        return added
      },
    }
  }

  return {
    deviceId,
    db,
    tables,
    proposals,
    get feeds() { return feeds },
    set feeds(next: RssFeed[]) { feeds = next },
    get pendingNotices() { return pendingNotices },
    insertSource,
    run,
    all,
    async importFeed(feedId: string, parsed: ParsedFeed) {
      return applyParsedFeed(feedId, parsed, rssDeps())
    },
    async sourceIds(prefix = '') {
      await ensureSourceSyncSchema(db)
      return all<{ id: string }>('select id from sources where id like $1 order by id', `${prefix}%`).map(row => row.id)
    },
    async source(id: string) {
      await ensureSourceSyncSchema(db)
      return all<Record<string, unknown>>('select * from sources where id = $1 or legacy_id = $1', id)[0]
    },
  }
}

type Device = ReturnType<typeof createDevice>

function harness() {
  const remote = createMemoryRemote()
  let now = 1_700_000_000_000
  const clock = () => (now += 1_000)
  const a = createDevice('dev-a', clock)
  const b = createDevice('dev-b', clock)
  const sync = (device: Device, extra: Partial<AlmanacSyncContext> = {}) => runAlmanacSync({
    db: device.db,
    deviceId: device.deviceId,
    deviceName: device.deviceId,
    now: clock,
    remotes: { account: remote, library: remote },
    libraryScope: '/vault',
    tables: device.tables,
    ...extra,
  })
  return { remote, a, b, sync, clock }
}

const FEED_URL = 'https://blog.example/feed.xml'

function feedPage(numbers: number[]): ParsedFeed {
  const items: FeedItem[] = numbers.map(n => ({
    guid: `https://blog.example/p/${n}`,
    link: `https://blog.example/p/${n}`,
    title: `Post ${n}`,
    published: Date.UTC(2026, 10, n),
    summary: `summary ${n}`,
  }))
  return { format: 'rss', title: 'Example blog', items } as ParsedFeed
}

const postIds = (numbers: number[]) => numbers.map(n => `src_rss:https://blog.example/p/${n}`).sort()

describe('85.2 雙裝置：RSS 文章與已讀清單一起同步', () => {
  it('兩台同時開排程匯入同一個 feed：文章不重複、不漏，seen 一致', async () => {
    const { a, b, sync, clock } = harness()
    const feed = createFeed({ id: 'rss_1', url: FEED_URL, name: 'Blog', now: clock() })
    a.feeds = [feed]
    await sync(a)
    await sync(b)
    expect(b.feeds.map(entry => entry.id)).toEqual(['rss_1'])

    // 兩台在同步之前各自抓到同一批文章（第一次只收最新 10 篇，這裡只有 3 篇）。
    await a.importFeed('rss_1', feedPage([1, 2, 3]))
    await b.importFeed('rss_1', feedPage([1, 2, 3]))
    // feed 又出了 4、5：兩台都抓到；6 只有 A 抓到（B 還沒到期）。
    await a.importFeed('rss_1', feedPage([1, 2, 3, 4, 5, 6]))
    await b.importFeed('rss_1', feedPage([1, 2, 3, 4, 5]))

    await sync(a)
    await sync(b)
    await sync(a)

    expect(await a.sourceIds('src_rss:')).toEqual(postIds([1, 2, 3, 4, 5, 6]))
    expect(await b.sourceIds('src_rss:')).toEqual(postIds([1, 2, 3, 4, 5, 6]))
    expect(new Set(a.feeds[0].seen)).toEqual(new Set(b.feeds[0].seen))
    expect(b.feeds[0].seen).toContain('https://blog.example/p/6')

    // B 之後再抓：6 已經看過（文章也已經在），不會重複存；7 是新的。
    const result = await b.importFeed('rss_1', feedPage([1, 2, 3, 4, 5, 6, 7]))
    expect(result.added).toBe(1)
    await sync(b)
    await sync(a)
    expect(await a.sourceIds('src_rss:')).toEqual(postIds([1, 2, 3, 4, 5, 6, 7]))
    expect(await b.sourceIds('src_rss:')).toEqual(await a.sourceIds('src_rss:'))
  })

  it('只收到 seen、文章還沒到（同步被打斷）：下一輪文章補齊，不會永遠拿不到', async () => {
    const { a, b, sync, clock } = harness()
    a.feeds = [createFeed({ id: 'rss_1', url: FEED_URL, name: 'Blog', now: clock() })]
    await sync(a)
    await sync(b)
    await a.importFeed('rss_1', feedPage([1, 2]))
    await sync(a)
    // B 這一輪只同步到 feeds.json（模擬中斷：資料源桶沒套到）。
    const feedsOnly = b.tables.filter(table => table.name === 'feeds')
    await sync(b, { tables: feedsOnly })
    expect(b.feeds[0].seen).toEqual(expect.arrayContaining(['https://blog.example/p/1', 'https://blog.example/p/2']))
    expect(await b.sourceIds('src_rss:')).toEqual([])
    // 這時 B 抓 feed：都看過了，不重複存。
    expect((await b.importFeed('rss_1', feedPage([1, 2]))).added).toBe(0)
    await sync(b)
    expect(await b.sourceIds('src_rss:')).toEqual(postIds([1, 2]))
  })

  it('B 刪 RSS 訂閱：A 進待確認清單、不直接刪，也不推回遠端；A 拒絕＝保留並推回', async () => {
    const { a, b, sync, clock, remote } = harness()
    a.feeds = [createFeed({ id: 'rss_1', url: FEED_URL, name: 'Blog', now: clock() })]
    await sync(a)
    await sync(b)
    b.feeds = []
    await sync(b)
    const report = await sync(a)

    expect(a.feeds.map(feed => feed.id)).toEqual(['rss_1'])
    expect(report.tables.find(table => table.table === 'feeds')?.pendingDeletes).toEqual(['rss_1'])
    const pending = await listPendingRecordDeletions(a.db)
    expect(pending).toMatchObject([{ tableName: 'feeds', syncKey: 'rss_1', title: 'Blog', status: 'pending' }])
    expect(a.pendingNotices).toBe(1)
    const remoteDoc = JSON.parse(remote.files.get('.data/almanac/feeds.json')!.content)
    expect(remoteDoc.rows.rss_1).toBeUndefined()
    expect(remoteDoc.deleted.rss_1).toBeDefined()

    // 再同步一次：還在待確認，不重複提示。
    await sync(a)
    expect(a.pendingNotices).toBe(1)

    // 拒絕：記下「保留」的時間（晚於刪除）→ 推回遠端，B 也拿回訂閱。
    await markPendingRecordDeletion(a.db, 'feeds', 'rss_1', 'rejected', clock())
    const now = clock()
    a.feeds = a.feeds.map(feed => ({ ...feed, keptAt: now, updatedAt: now }))
    await sync(a)
    await sync(b)
    expect(b.feeds.map(feed => feed.id)).toEqual(['rss_1'])
    expect(JSON.parse(remote.files.get('.data/almanac/feeds.json')!.content).deleted.rss_1).toBeUndefined()
  })

  it('A 確認別台的刪除：本機移除後維持刪除，不會再出現', async () => {
    const { a, b, sync, clock } = harness()
    a.feeds = [createFeed({ id: 'rss_1', url: FEED_URL, name: 'Blog', now: clock() })]
    await sync(a)
    await sync(b)
    b.feeds = []
    await sync(b)
    await sync(a)
    await markPendingRecordDeletion(a.db, 'feeds', 'rss_1', 'confirmed', clock())
    a.feeds = []
    await sync(a)
    await sync(b)
    await sync(a)
    expect(a.feeds).toEqual([])
    expect(b.feeds).toEqual([])
    expect(await listPendingRecordDeletions(a.db)).toEqual([])
  })

  it('兩台各自訂閱同一個網址：較早的 id 為正式 id，seen 合併，不出待確認', async () => {
    const { a, b, sync, clock } = harness()
    a.feeds = [createFeed({ id: 'rss_a', url: FEED_URL, name: 'Blog', now: clock() })]
    b.feeds = [createFeed({ id: 'rss_b', url: FEED_URL, name: 'Blog', now: clock() })]
    await a.importFeed('rss_a', feedPage([1]))
    await b.importFeed('rss_b', feedPage([2]))
    for (let round = 0; round < 3; round++) {
      await sync(a)
      await sync(b)
    }
    expect(a.feeds.map(feed => feed.id)).toEqual(['rss_a'])
    expect(b.feeds.map(feed => feed.id)).toEqual(['rss_a'])
    expect(new Set(b.feeds[0].seen)).toEqual(new Set(['https://blog.example/p/1', 'https://blog.example/p/2']))
    expect(await listPendingRecordDeletions(a.db)).toEqual([])
    expect(await listPendingRecordDeletions(b.db)).toEqual([])
    expect(await resolveAlias(b.db, 'feeds', 'rss_b')).toBe('rss_a')
  })

  it('改名較晚的贏；抓取時間取較大的', async () => {
    const { a, b, sync, clock } = harness()
    a.feeds = [createFeed({ id: 'rss_1', url: FEED_URL, name: 'Blog', now: clock() })]
    await sync(a)
    await sync(b)
    a.feeds = a.feeds.map(feed => ({ ...feed, name: 'A name', named: true, updatedAt: clock(), lastFetchedAt: 5 }))
    b.feeds = b.feeds.map(feed => ({ ...feed, name: 'B name (later)', named: true, updatedAt: clock(), lastFetchedAt: 9 }))
    await sync(a)
    await sync(b)
    await sync(a)
    expect(a.feeds[0]).toMatchObject({ name: 'B name (later)', lastFetchedAt: 9 })
    expect(b.feeds[0]).toMatchObject({ name: 'B name (later)', lastFetchedAt: 9 })
  })
})

describe('85.2 雙裝置：資料源表', () => {
  it('A 新增資料源（含初步判斷、產出連結、舊筆記待決定）→ B 看得到', async () => {
    const { a, b, sync, clock } = harness()
    await a.insertSource({ id: 'src_one', sourceType: 'external', kind: 'link', content: 'https://x.example', origin: 'https://x.example', collector: 'scott' })
    a.run(`insert into source_judgements (source_id, status, type, suggestion, follow_suggestion, created_at, updated_at)
      values ('src_one', 'ready', '文章', '存成筆記', 1, $1, $1)`, clock())
    a.run("insert into source_outputs (source_id, target_type, target_ref, created_at) values ('src_one', 'note', 'N-20261127-0900-ABCD', $1)", clock())
    a.run("insert into legacy_undecided (source_id, path, batch_id, created_at) values ('src_one', 'old/note.md', 'batch-1', $1)", clock())
    await sync(a)
    const report = await sync(b)

    expect(report.changedLocally).toBe(true)
    expect(await b.source('src_one')).toMatchObject({ kind: 'link', content: 'https://x.example', status: 'awaiting_decision' })
    expect(b.all('select type, suggestion, follow_suggestion as follow from source_judgements')).toEqual([{ type: '文章', suggestion: '存成筆記', follow: 1 }])
    expect(b.all('select target_ref as ref from source_outputs where source_id = $1', 'src_one')).toEqual([{ ref: 'N-20261127-0900-ABCD' }])
    expect(b.all('select path, batch_id as batch from legacy_undecided')).toEqual([{ path: 'old/note.md', batch: 'batch-1' }])
  })

  it('狀態只往前：A 已分析、B 還在等決定 → 兩台都是已分析；分析中傳出時當待分析，本機的分析中不被蓋掉', async () => {
    const { a, b, sync } = harness()
    await a.insertSource({ id: 'src_s', sourceType: 'self', kind: 'text', content: 'memo', collector: 'scott' })
    await sync(a)
    await sync(b)
    a.run("update sources set status = 'analyzed', status_changed_at = status_changed_at + 10, updated_at = updated_at + 10 where id = 'src_s'")
    b.run("update sources set status = 'analyzing', updated_at = updated_at + 5 where id = 'src_s'")
    b.run("update sources set is_journal = 1, updated_at = updated_at + 1 where id = 'src_s'")
    await sync(b)
    await sync(a)
    await sync(b)
    expect((await a.source('src_s'))).toMatchObject({ status: 'analyzed', is_journal: 1 })
    expect((await b.source('src_s'))).toMatchObject({ status: 'analyzed', is_journal: 1 })

    await b.insertSource({ id: 'src_busy', sourceType: 'self', kind: 'text', content: 'busy', collector: 'scott' })
    b.run("update sources set status = 'analyzing' where id = 'src_busy'")
    await sync(b)
    await sync(a)
    expect((await a.source('src_busy'))?.status).toBe('pending_analysis')
    a.run("update sources set is_journal = 1, updated_at = updated_at + 100 where id = 'src_busy'")
    await sync(a)
    await sync(b)
    expect((await b.source('src_busy'))).toMatchObject({ status: 'analyzing', is_journal: 1 })
  })

  it('A 已遷移成 S 編號、B 還是舊 id：B 改用 S 編號（舊 id 留在 legacy_id、引用跟著改）', async () => {
    const { a, b, sync, clock } = harness()
    await b.insertSource({ id: 'src_rss:k', sourceType: 'external', kind: 'rss', content: 'post', collector: 'scott' })
    b.run("insert into source_outputs (source_id, target_type, target_ref, created_at) values ('src_rss:k', 'note', 'inbox/a.md', $1)", clock())
    await a.insertSource({ id: 'S-20261127-0900-AB12', sourceType: 'external', kind: 'rss', content: 'post', collector: 'scott' })
    a.run("update sources set legacy_id = 'src_rss:k' where id = 'S-20261127-0900-AB12'")
    await sync(a)
    await sync(b)
    await sync(a)
    expect(await b.sourceIds()).toEqual(['S-20261127-0900-AB12'])
    expect(b.all('select legacy_id as legacy from sources')).toEqual([{ legacy: 'src_rss:k' }])
    expect(b.all('select source_id as id, target_ref as ref from source_outputs')).toEqual([{ id: 'S-20261127-0900-AB12', ref: 'inbox/a.md' }])
    expect(a.all('select source_id as id, target_ref as ref from source_outputs')).toEqual([{ id: 'S-20261127-0900-AB12', ref: 'inbox/a.md' }])
  })

  it('兩台各自遷移出不同 S 編號：取字串較小的，另一個進別名表', async () => {
    const { a, b, sync } = harness()
    await a.insertSource({ id: 'S-20261127-0900-AB12', sourceType: 'external', kind: 'rss', content: 'post', collector: 'scott' })
    a.run("update sources set legacy_id = 'src_rss:k'")
    await b.insertSource({ id: 'S-20261127-0900-ZZ90', sourceType: 'external', kind: 'rss', content: 'post', collector: 'scott' })
    b.run("update sources set legacy_id = 'src_rss:k'")
    await sync(a)
    await sync(b)
    await sync(a)
    expect(await a.sourceIds()).toEqual(['S-20261127-0900-AB12'])
    expect(await b.sourceIds()).toEqual(['S-20261127-0900-AB12'])
    expect(await resolveAlias(b.db, 'sources', 'S-20261127-0900-ZZ90')).toBe('S-20261127-0900-AB12')
  })

  it('兩邊都改了草稿內容：兩份都留（較晚的在原列，另一份另存新版本）', async () => {
    const { a, b, sync } = harness()
    await a.insertSource({ id: 'src_d', sourceType: 'external', kind: 'text', content: 'draft', collector: 'scott' })
    await sync(a)
    await sync(b)
    a.run("update sources set content = 'edited on A', updated_at = updated_at + 10 where id = 'src_d'")
    b.run("update sources set content = 'edited on B (later)', updated_at = updated_at + 20 where id = 'src_d'")
    for (let round = 0; round < 3; round++) {
      await sync(a)
      await sync(b)
    }
    const loserId = conflictVersionId('src_d', 'edited on A')
    for (const device of [a, b]) {
      expect((await device.source('src_d'))?.content).toBe('edited on B (later)')
      expect((await device.source(loserId))?.content).toBe('edited on A')
    }
  })

  it('M5：src_conversation:<數字> 換成 syncId 版（找不到對話就加裝置前綴），舊 id 留在 legacy_id', async () => {
    const { a, b, sync } = harness()
    a.run("insert into conversations (id, syncId, title) values (7, 'sync-7', 'chat')")
    await a.insertSource({ id: 'src_conversation:7', sourceType: 'system', kind: 'conversation', content: 'summary', collector: 'commander' })
    await a.insertSource({ id: 'src_conversation:9', sourceType: 'system', kind: 'conversation', content: 'orphan', collector: 'commander' })
    // B 也有一則本機編號 7 的對話資料源（是 B 的另一段對話），不能跟 A 的撞在一起。
    await b.insertSource({ id: 'src_conversation:7', sourceType: 'system', kind: 'conversation', content: 'B chat', collector: 'commander' })
    await sync(a)
    await sync(b)
    await sync(a)
    expect(await a.sourceIds()).toEqual(['src_conversation:dev-a:9', 'src_conversation:dev-b:7', 'src_conversation:sync-7'])
    expect(await b.sourceIds()).toEqual(await a.sourceIds())
    expect((await a.source('src_conversation:7'))?.content).toBe('summary')
    expect((await b.source('src_conversation:7'))?.content).toBe('B chat')
  })
})

describe('85.2 雙裝置：提案與資料源引用', () => {
  function item(id: string, sourceIds: string[], extra: Partial<SyncCollectItem> = {}): SyncCollectItem {
    return {
      id,
      input: { kind: 'text', text: '', name: 'Mia' },
      createdAt: 1_700_000_000_000,
      state: 'ready',
      source: 'ai',
      proposals: [{ id: 'p1', kind: 'note', title: 'T', body: 'B', due: '', time: '', tags: [], status: 'wait', sourceIds }],
      ...extra,
    }
  }

  it('A 的待決定提案指向的資料源，在 B 解析得到（資料源先到、提案後到）', async () => {
    const { a, b, sync } = harness()
    await a.insertSource({ id: 'S-20261127-0901-QQ11', sourceType: 'self', kind: 'text', content: 'memo', collector: 'scott' })
    a.proposals.state.items = [item('commander:S-20261127-0901-QQ11', ['S-20261127-0901-QQ11'])]
    a.proposals.state.trail = { 'collect:commander:S-20261127-0901-QQ11:p1': { supersededBy: 'collect:x:p2' } }
    await sync(a)
    await sync(b)
    const proposal = b.proposals.state.items[0].proposals[0]
    expect(proposal.sourceIds).toEqual(['S-20261127-0901-QQ11'])
    for (const id of proposal.sourceIds ?? []) expect(await b.source(id)).toBeDefined()
    expect(b.proposals.state.trail).toEqual(a.proposals.state.trail)
  })

  it('提案指向的是別名（另一台的 S 編號）：B 收到時換成正式 id；舊 id 指向的資料源也找得到', async () => {
    const { a, b, sync } = harness()
    await a.insertSource({ id: 'S-20261127-0900-ZZ90', sourceType: 'external', kind: 'rss', content: 'post', collector: 'scott' })
    a.run("update sources set legacy_id = 'src_rss:k'")
    await b.insertSource({ id: 'S-20261127-0900-AB12', sourceType: 'external', kind: 'rss', content: 'post', collector: 'scott' })
    b.run("update sources set legacy_id = 'src_rss:k'")
    a.proposals.state.items = [item('commander:k', ['S-20261127-0900-ZZ90'])]
    await sync(b)
    await sync(a)
    await sync(b)
    expect(b.proposals.state.items[0].proposals[0].sourceIds).toEqual(['S-20261127-0900-AB12'])
    // A 本機的提案還記著舊編號也沒關係：別名表解析得到正式那一則（getSource 也認別名）。
    expect(await resolveAlias(a.db, 'sources', a.proposals.state.items[0].proposals[0].sourceIds![0])).toBe('S-20261127-0900-AB12')
    expect(await a.source('S-20261127-0900-AB12')).toBeDefined()
    // 舊引用 src_rss:k 照樣找得到（legacy_id）
    expect((await b.source('src_rss:k'))?.id).toBe('S-20261127-0900-AB12')
  })

  it('提案狀態只往前；對話編號換成 syncId；Inbox 記錄編號留在本機', async () => {
    const { a, b, sync } = harness()
    a.run("insert into conversations (id, syncId, title) values (3, 'conv-shared', 'chat')")
    b.run("insert into conversations (id, syncId, title) values (11, 'conv-shared', 'chat')")
    const base = item('cap-1', [])
    base.proposals[0].conversationId = 3
    a.proposals.state.items = [{ ...base, recordId: 42 }]
    await sync(a)
    await sync(b)
    expect(b.proposals.state.items[0].proposals[0]).toMatchObject({ conversationId: 11, conversationSyncId: 'conv-shared' })
    expect(b.proposals.state.items[0].recordId).toBeUndefined()

    // A 接受、B 同時放棄：以接受為準（筆記已經寫進筆記庫）。
    a.proposals.state.items[0].proposals[0] = { ...a.proposals.state.items[0].proposals[0], status: 'ok', result: { path: 'inbox/T.md' } }
    b.proposals.state.items[0].proposals[0] = { ...b.proposals.state.items[0].proposals[0], status: 'no' }
    await sync(b)
    await sync(a)
    await sync(b)
    for (const device of [a, b]) expect(device.proposals.state.items[0].proposals[0]).toMatchObject({ status: 'ok', result: { path: 'inbox/T.md' } })
    expect(a.proposals.state.items[0].recordId).toBe(42)
    expect(a.proposals.state.items[0].proposals[0].conversationId).toBe(3)
  })

  it('一台先清掉處理完的項目：另一台還有等你決定的提案就不刪，下一輪推回去', async () => {
    const { a, b, sync } = harness()
    a.proposals.state.items = [item('cap-1', [])]
    await sync(a)
    await sync(b)
    a.proposals.state.items = []
    await sync(a)
    await sync(b)
    expect(b.proposals.state.items.map(entry => entry.id)).toEqual(['cap-1'])
    await sync(b)
    await sync(a)
    expect(a.proposals.state.items.map(entry => entry.id)).toEqual(['cap-1'])
  })

  it('每週卡、衝突觀察跟著同步；確認掉的觀察另一台也拿掉', async () => {
    const { a, b, sync } = harness()
    a.proposals.state.weeklySent = ['moc:M-1:2026-W48']
    a.proposals.state.cleanup = [{ key: '["d","k"]', observation: { type: 'duplicate', notePaths: ['a.md', 'b.md'], evidence: 'same', trigger: 'written' } }]
    await sync(a)
    await sync(b)
    expect(b.proposals.state.weeklySent).toEqual(['moc:M-1:2026-W48'])
    expect(b.proposals.state.cleanup.map(entry => entry.key)).toEqual(['["d","k"]'])
    b.proposals.state.cleanup = []
    await sync(b)
    await sync(a)
    expect(a.proposals.state.cleanup).toEqual([])
    expect(a.proposals.state.weeklySent).toEqual(['moc:M-1:2026-W48'])
  })
})

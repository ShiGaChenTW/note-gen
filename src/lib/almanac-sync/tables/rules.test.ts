// Fork（almanac ALMNC-85.2）：資料源、RSS 訂閱、提案三張表的欄位規則（表格驅動，設計 5.2 第一層）。
// 每個案例給「基準、本機、遠端」，斷言合併結果；用骨架的 mergeRow／mergeTable 跑正式的欄位規則。
import { describe, expect, it } from 'vitest'
import { buildRowBase, mergeRow, mergeTable } from '../merge'
import type { SyncRow } from '../envelope'
import { canonicalSourceId, createSourcesTable, resolveSourceStatus, sourceSyncKey, unionOutputs, type SourceSyncValue } from './sources'
import { createFeedsTable, unionSeen, type FeedSyncValue } from './feeds'
import { createProposalsTable, mergeProposal, type SyncProposal } from './proposals'

const sourcesRules = createSourcesTable().rules!
const feedsRules = createFeedsTable({ load: async () => [], update: async () => undefined }).rules!
const proposalRules = createProposalsTable({ load: async () => ({ items: [], trail: {}, weeklySent: [], cleanup: [] }), apply: async () => undefined }).rules!

function source(patch: Partial<SourceSyncValue> = {}): SourceSyncValue {
  return {
    id: 'src_1', sourceType: 'external', kind: 'link', content: 'c', collectedAt: 1, collector: 'scott',
    status: 'awaiting_decision', statusChangedAt: 1, version: 1, createdAt: 1, isJournal: false, ...patch,
  }
}

const row = <V extends Record<string, unknown>>(v: V, u: number, d = 'dev-a'): SyncRow<V> => ({ v, u, d })

describe('資料源欄位規則（設計 2.1）', () => {
  const cases: Array<{ name: string; base: SourceSyncValue | null; local: SourceSyncValue; remote: SourceSyncValue; localU?: number; remoteU?: number; expect: Partial<SourceSyncValue> }> = [
    {
      name: '只有遠端改（本機時間較新也一樣）→ 採用遠端',
      base: source(), local: source(), remote: source({ isJournal: true }), localU: 9, remoteU: 2,
      expect: { isJournal: true },
    },
    {
      name: '兩邊改不同欄位 → 各取各的',
      base: source(), local: source({ isJournal: true }), remote: source({ origin: 'https://x' }),
      expect: { isJournal: true, origin: 'https://x' },
    },
    {
      name: '狀態只往前：analyzed 贏過較晚的 pending_analysis',
      base: source(), local: source({ status: 'analyzed', statusChangedAt: 5 }), remote: source({ status: 'pending_analysis', statusChangedAt: 9 }), localU: 1, remoteU: 9,
      expect: { status: 'analyzed', statusChangedAt: 5 },
    },
    {
      name: 'rejected 對上 awaiting_decision：看 statusChangedAt 較晚的（工作台可以改回等你決定）',
      base: source({ status: 'pending_analysis' }), local: source({ status: 'rejected', statusChangedAt: 5 }), remote: source({ status: 'awaiting_decision', statusChangedAt: 7 }),
      expect: { status: 'awaiting_decision', statusChangedAt: 7 },
    },
    {
      name: 'rejected 贏過 pending_analysis（分析完才會不採用）',
      base: source(), local: source({ status: 'pending_analysis', statusChangedAt: 8 }), remote: source({ status: 'rejected', statusChangedAt: 4 }), localU: 9, remoteU: 1,
      expect: { status: 'rejected' },
    },
    {
      name: '鎖定、封存取較早的非空值',
      base: source(), local: source({ lockedAt: 30, archivedAt: 50 }), remote: source({ lockedAt: 20 }),
      expect: { lockedAt: 20, archivedAt: 50 },
    },
    {
      name: '初步判斷：成功的贏過失敗的；「照建議處理」取 OR',
      base: source(),
      local: source({ judgement: { status: 'capture_failed', error: 'x', followSuggestion: true, createdAt: 1, updatedAt: 9 } }),
      remote: source({ judgement: { status: 'ready', type: '文章', followSuggestion: false, createdAt: 1, updatedAt: 3 } }),
      expect: { judgement: { status: 'ready', type: '文章', followSuggestion: true, createdAt: 1, updatedAt: 3 } },
    },
    {
      name: '產出連結：聯集（同鍵只留一筆）',
      base: source(),
      local: source({ outputs: [{ targetType: 'note', targetRef: 'N-1', createdAt: 2 }] }),
      remote: source({ outputs: [{ targetType: 'note', targetRef: 'N-1', createdAt: 3 }, { targetType: 'task', targetRef: 't#1', createdAt: 4 }] }),
      expect: { outputs: [{ targetType: 'note', targetRef: 'N-1', createdAt: 2 }, { targetType: 'task', targetRef: 't#1', createdAt: 4 }] },
    },
    {
      name: '舊筆記待決定：resolvedAt 取較早的非空值',
      base: source(),
      local: source({ legacyUndecided: { path: 'a.md', batchId: 'b', createdAt: 1, resolvedAt: 40 } }),
      remote: source({ legacyUndecided: { path: 'a.md', batchId: 'b', createdAt: 1, resolvedAt: 30 } }),
      expect: { legacyUndecided: { path: 'a.md', batchId: 'b', createdAt: 1, resolvedAt: 30 } },
    },
    {
      name: '同鍵兩台 id 不同（沒有基準）：S 編號優先、legacyId 有值的贏',
      base: null, local: source({ id: 'src_rss:k' }), remote: source({ id: 'S-20261127-0900-AB12', legacyId: 'src_rss:k' }),
      expect: { id: 'S-20261127-0900-AB12', legacyId: 'src_rss:k' },
    },
  ]

  it.each(cases)('$name', testCase => {
    const merged = mergeRow({
      key: 'k',
      base: testCase.base ? buildRowBase(testCase.base, sourcesRules) : null,
      local: row(testCase.local, testCase.localU ?? 5, 'dev-a'),
      remote: row(testCase.remote, testCase.remoteU ?? 5, 'dev-b'),
      rules: sourcesRules,
    })
    expect(merged.row.v).toMatchObject(testCase.expect)
    expect(merged.conflicts).toEqual([])
  })

  it('同步鍵：legacyId ?? id；舊 id 是本機對話編號時不算', () => {
    expect(sourceSyncKey({ id: 'S-1', legacyId: 'src_rss:k' })).toBe('src_rss:k')
    expect(sourceSyncKey({ id: 'src_x' })).toBe('src_x')
    expect(sourceSyncKey({ id: 'src_conversation:abc', legacyId: 'src_conversation:12' })).toBe('src_conversation:abc')
  })

  it('正式 id：S 編號優先，都是 S 編號取字串較小的（兩台結果一樣）', () => {
    expect(canonicalSourceId('src_a', 'S-2')).toBe('S-2')
    expect(canonicalSourceId('S-9', 'S-2')).toBe('S-2')
    expect(canonicalSourceId('S-2', 'S-9')).toBe('S-2')
  })

  it('狀態決勝：同狀態看誰較晚', () => {
    expect(resolveSourceStatus(source({ status: 'analyzed' }), source({ status: 'analyzed' }), false)).toBe('remote')
    expect(unionOutputs(undefined, undefined)).toBeUndefined()
  })

  it('刪除對修改：別台刪了資料源、本機在那之後又改過 → 修改贏', () => {
    const value = source()
    const result = mergeTable({
      local: { k: row(source({ isJournal: true }), 50) },
      remote: { rows: {}, deleted: { k: { deletedAt: 40, deviceId: 'dev-b' } } },
      bases: { k: buildRowBase(value, sourcesRules) },
      rules: sourcesRules, now: 60, deviceId: 'dev-a',
    })
    expect(result.rows.k.v.isJournal).toBe(true)
    expect(result.localDeletes).toEqual([])
  })
})

describe('RSS 訂閱欄位規則（設計 2.2）', () => {
  const feed = (patch: Partial<FeedSyncValue> = {}): FeedSyncValue => ({ url: 'https://f/x', name: 'F', named: false, paused: false, createdAt: 1, seen: [], ...patch })
  const cases: Array<{ name: string; base: FeedSyncValue; local: FeedSyncValue; remote: FeedSyncValue; localU?: number; remoteU?: number; expect: Partial<FeedSyncValue> }> = [
    {
      name: 'seen 聯集：本機的在前，再接遠端多出來的',
      base: feed({ seen: ['a'] }), local: feed({ seen: ['c', 'a'] }), remote: feed({ seen: ['b', 'a'] }),
      expect: { seen: ['c', 'a', 'b'] },
    },
    {
      name: '改名、暫停：較晚的贏',
      base: feed(), local: feed({ name: 'A', named: true }), remote: feed({ name: 'B', named: true, paused: true }), localU: 3, remoteU: 8,
      expect: { name: 'B', named: true, paused: true },
    },
    {
      name: '抓取時間取較大的；錯誤跟著最近一次抓取',
      base: feed(),
      local: feed({ lastFetchedAt: 10, lastSuccessAt: 10, lastAdded: 2 }),
      remote: feed({ lastFetchedAt: 20, lastSuccessAt: 5, lastError: 'timeout', lastErrorAt: 20 }),
      expect: { lastFetchedAt: 20, lastSuccessAt: 10, lastError: 'timeout', lastErrorAt: 20 },
    },
  ]
  it.each(cases)('$name', testCase => {
    const merged = mergeRow({
      key: 'rss_1',
      base: buildRowBase(testCase.base, feedsRules),
      local: row(testCase.local, testCase.localU ?? 5, 'dev-a'),
      remote: row(testCase.remote, testCase.remoteU ?? 5, 'dev-b'),
      rules: feedsRules,
    })
    expect(merged.row.v).toMatchObject(testCase.expect)
  })

  it('seen 最多留 500 個（至少留住兩邊各自的全部）', () => {
    const local = Array.from({ length: 400 }, (_, index) => `l${index}`)
    const remote = Array.from({ length: 400 }, (_, index) => `r${index}`)
    expect(unionSeen(local, remote)).toHaveLength(500)
    expect(unionSeen(local, remote).slice(0, 400)).toEqual(local)
  })
})

describe('提案欄位規則（設計 2.3）', () => {
  const proposal = (patch: Partial<SyncProposal> = {}): SyncProposal => ({ id: 'p1', status: 'wait', title: 'T', ...patch })
  const cases: Array<{ name: string; local: SyncProposal; remote: SyncProposal; localIsLater: boolean; expect: Partial<SyncProposal> }> = [
    { name: 'ok 贏過較晚的 no', local: proposal({ status: 'ok', result: { path: 'a.md' } }), remote: proposal({ status: 'no' }), localIsLater: false, expect: { status: 'ok', result: { path: 'a.md' } } },
    { name: 'no 贏過 wait', local: proposal({ status: 'wait' }), remote: proposal({ status: 'no' }), localIsLater: true, expect: { status: 'no' } },
    { name: '同狀態：卡片上改的標題較晚的贏', local: proposal({ title: 'A' }), remote: proposal({ title: 'B' }), localIsLater: false, expect: { title: 'B', status: 'wait' } },
  ]
  it.each(cases)('$name', testCase => {
    expect(mergeProposal(testCase.local, testCase.remote, testCase.localIsLater)).toMatchObject(testCase.expect)
  })

  it('同一個項目兩台各自多了不同提案：聯集', () => {
    const base = { createdAt: 1, proposals: [proposal()] }
    const merged = mergeRow({
      key: 'item:x',
      base: buildRowBase(base, proposalRules),
      local: row({ createdAt: 1, proposals: [proposal({ status: 'ok' }), proposal({ id: 'p2' })] }, 5),
      remote: row({ createdAt: 1, proposals: [proposal(), proposal({ id: 'p3' })] }, 6, 'dev-b'),
      rules: proposalRules,
    })
    expect((merged.row.v.proposals as SyncProposal[]).map(entry => `${entry.id}:${entry.status}`)).toEqual(['p1:ok', 'p2:wait', 'p3:wait'])
  })

  it('trail：discussion 較晚的贏；supersededBy 先有值的保留', () => {
    const merged = mergeRow({
      key: 'trail:k',
      base: buildRowBase({}, proposalRules),
      local: row({ discussion: { note: 'A', at: 5 }, supersededBy: 'collect:a:p' }, 5),
      remote: row({ discussion: { note: 'B', at: 9 } }, 9, 'dev-b'),
      rules: proposalRules,
    })
    expect(merged.row.v).toEqual({ discussion: { note: 'B', at: 9 }, supersededBy: 'collect:a:p' })
  })
})

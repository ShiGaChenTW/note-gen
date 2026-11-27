// Fork（almanac ALMNC-85.2 骨架）：A～E 合併純函式的表格驅動測試（設計 5.2 第一層）。
// 每個案例給「基準、本機、遠端」三份，斷言合併結果與是否產生衝突。
import { describe, expect, it } from 'vitest'
import {
  anyTrue, ask, buildRowBase, forward, lww, maxNumber, mergeAppendEntries, mergeRow, mergeSetUnion,
  mergeTable, minNonNull, pickForward, text, unionBy, type FieldRules, type RowBase,
} from './merge'
import { mergeTextLines } from './text-merge'
import { chooseCanonicalId } from './aliases'
import { legacyAwareSyncKey } from './keys'
import type { SyncRow, SyncValue } from './envelope'

const row = <V extends SyncValue>(v: V, u: number, d = 'dev-a'): SyncRow<V> => ({ v, u, d })

type Source = { content: string; status: string; lockedAt: number | null; followSuggestion: boolean; outputs: Array<{ ref: string }> }

const SOURCE_RULES: FieldRules<Source> = {
  status: forward(['awaiting_decision', 'pending_analysis', 'analyzing', 'analyzed']),
  lockedAt: minNonNull(),
  followSuggestion: anyTrue(),
  outputs: unionBy<{ ref: string }>(item => item.ref),
}

const baseSource: Source = { content: 'hello', status: 'pending_analysis', lockedAt: null, followSuggestion: false, outputs: [] }

describe('mergeRow（A 型單筆三方合併）', () => {
  const cases: Array<{
    name: string
    base: Source | null
    local: SyncRow<Source>
    remote: SyncRow<Source>
    expected: Partial<Source>
    conflicts?: number
  }> = [
    {
      name: '只有本機改 → 採用本機',
      base: baseSource,
      local: row({ ...baseSource, content: 'local edit' }, 10),
      remote: row(baseSource, 99, 'dev-b'),
      expected: { content: 'local edit' },
    },
    {
      name: '只有遠端改 → 採用遠端（就算本機時間較新）',
      base: baseSource,
      local: row(baseSource, 99),
      remote: row({ ...baseSource, content: 'remote edit' }, 10, 'dev-b'),
      expected: { content: 'remote edit' },
    },
    {
      name: '兩邊改不同欄位 → 各取各的',
      base: baseSource,
      local: row({ ...baseSource, content: 'local edit' }, 10),
      remote: row({ ...baseSource, followSuggestion: true }, 20, 'dev-b'),
      expected: { content: 'local edit', followSuggestion: true },
    },
    {
      name: '兩邊改同一欄位（預設較晚的贏）',
      base: baseSource,
      local: row({ ...baseSource, content: 'local edit' }, 10),
      remote: row({ ...baseSource, content: 'remote edit' }, 20, 'dev-b'),
      expected: { content: 'remote edit' },
    },
    {
      name: '同一欄位、同時間 → 比裝置字串，結果確定',
      base: baseSource,
      local: row({ ...baseSource, content: 'from a' }, 10, 'dev-a'),
      remote: row({ ...baseSource, content: 'from b' }, 10, 'dev-b'),
      expected: { content: 'from b' },
    },
    {
      name: 'D 型：已分析不會被另一台較晚的「待分析」蓋回去',
      base: { ...baseSource, status: 'awaiting_decision' },
      local: row({ ...baseSource, status: 'analyzed' }, 10),
      remote: row({ ...baseSource, status: 'pending_analysis' }, 20, 'dev-b'),
      expected: { status: 'analyzed' },
    },
    {
      name: '鎖定時間取兩邊較早的非空值',
      base: baseSource,
      local: row({ ...baseSource, lockedAt: 300 }, 10),
      remote: row({ ...baseSource, lockedAt: 200 }, 20, 'dev-b'),
      expected: { lockedAt: 200 },
    },
    {
      name: '產出連結 B 型聯集',
      base: baseSource,
      local: row({ ...baseSource, outputs: [{ ref: 'a.md' }] }, 10),
      remote: row({ ...baseSource, outputs: [{ ref: 'b.md' }] }, 20, 'dev-b'),
      expected: { outputs: [{ ref: 'a.md' }, { ref: 'b.md' }] },
    },
    {
      name: '同鍵兩邊各自新增（沒有基準）→ 欄位規則決定、不出卡',
      base: null,
      local: row({ ...baseSource, content: 'same', status: 'analyzed' }, 10),
      remote: row({ ...baseSource, content: 'same', status: 'awaiting_decision', followSuggestion: true }, 20, 'dev-b'),
      expected: { content: 'same', status: 'analyzed', followSuggestion: true },
    },
  ]

  for (const testCase of cases) {
    it(testCase.name, () => {
      const base: RowBase | null = testCase.base ? buildRowBase(testCase.base, SOURCE_RULES) : null
      const result = mergeRow({ key: 'k', base, local: testCase.local, remote: testCase.remote, rules: SOURCE_RULES })
      expect(result.row.v).toMatchObject(testCase.expected)
      expect(result.conflicts).toHaveLength(testCase.conflicts ?? 0)
    })
  }

  it('混合結果的時間取較晚的一邊，讓其他裝置看得出有新版本', () => {
    const result = mergeRow({
      key: 'k',
      base: buildRowBase(baseSource),
      local: row({ ...baseSource, content: 'x' }, 10, 'dev-a'),
      remote: row({ ...baseSource, followSuggestion: true }, 20, 'dev-b'),
    })
    expect(result.row).toMatchObject({ u: 20, d: 'dev-b' })
  })

  it('本機只是沒改過的預設值 → 一律讓位給遠端（首次同步第一台優先）', () => {
    const result = mergeRow({
      key: 'role:secretary',
      base: null,
      local: row({ name: 'Mia' }, 999),
      remote: row({ name: 'Scott 改過的名字' }, 1, 'dev-b'),
      localPristine: true,
    })
    expect(result.row.v).toEqual({ name: 'Scott 改過的名字' })
  })

  it('ask 規則：兩邊改同一欄 → 保留本機並回報衝突', () => {
    const result = mergeRow({
      key: 'p1',
      base: buildRowBase({ path: null }),
      local: row({ path: 'A.md' }, 10),
      remote: row({ path: 'B.md' }, 20, 'dev-b'),
      rules: { path: ask() },
    })
    expect(result.row.v).toEqual({ path: 'A.md' })
    expect(result.conflicts).toEqual([expect.objectContaining({ key: 'p1', field: 'path', local: 'A.md', remote: 'B.md' })])
  })

  it('maxNumber、lww 規則', () => {
    const result = mergeRow({
      key: 'feed',
      base: buildRowBase({ lastFetchedAt: 1, name: 'a' }),
      local: row({ lastFetchedAt: 50, name: 'local' }, 30),
      remote: row({ lastFetchedAt: 40, name: 'remote' }, 20, 'dev-b'),
      rules: { lastFetchedAt: maxNumber(), name: lww() },
    })
    expect(result.row.v).toEqual({ lastFetchedAt: 50, name: 'local' })
  })
})

describe('E 型文字逐行合併', () => {
  const cases: Array<{ name: string; base: string; local: string; remote: string; expected: string; conflicts: number }> = [
    { name: '只有一邊改', base: 'a\nb', local: 'a\nb', remote: 'a\nB', expected: 'a\nB', conflicts: 0 },
    { name: '兩邊改不同行', base: 'a\nb\nc', local: 'A\nb\nc', remote: 'a\nb\nC', expected: 'A\nb\nC', conflicts: 0 },
    { name: '兩邊在結尾各加一行 → 都留、本機在前', base: 'a', local: 'a\nlocal', remote: 'a\nremote', expected: 'a\nlocal\nremote', conflicts: 0 },
    { name: '只有一邊刪的行刪掉', base: 'a\nb\nc', local: 'a\nc', remote: 'a\nb\nc\nd', expected: 'a\nc\nd', conflicts: 0 },
    { name: '同一行兩邊改法不同 → 衝突，先保留本機', base: 'a\nb\nc', local: 'a\nB1\nc', remote: 'a\nB2\nc', expected: 'a\nB1\nc', conflicts: 1 },
    { name: '兩邊改法一樣 → 不衝突', base: 'a\nb', local: 'a\nX', remote: 'a\nX', expected: 'a\nX', conflicts: 0 },
    { name: '一邊刪、一邊改同一行 → 修改留下', base: 'a\nb\nc', local: 'a\nc', remote: 'a\nB\nc', expected: 'a\nB\nc', conflicts: 0 },
  ]
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = mergeTextLines(testCase.base, testCase.local, testCase.remote)
      expect(result.text).toBe(testCase.expected)
      expect(result.conflicts).toHaveLength(testCase.conflicts)
    })
  }

  it('text("ask") 欄位衝突時回報段落，keep-local 不回報', () => {
    const base = buildRowBase({ body: 'a\nb' }, { body: text() })
    const asked = mergeRow({ key: 'soul', base, local: row({ body: 'a\nL' }, 1), remote: row({ body: 'a\nR' }, 2, 'dev-b'), rules: { body: text('ask') } })
    expect(asked.row.v.body).toBe('a\nL')
    expect(asked.conflicts[0]?.hunks).toEqual([{ base: ['b'], local: ['L'], remote: ['R'] }])
    const quiet = mergeRow({ key: 'notes', base, local: row({ body: 'a\nL' }, 1), remote: row({ body: 'a\nR' }, 2, 'dev-b'), rules: { body: text('keep-local') } })
    expect(quiet.conflicts).toEqual([])
  })
})

describe('mergeTable（刪除與新增）', () => {
  type Feed = { name: string }
  const now = 1_000_000

  it('同鍵兩邊各自新增 → 合為一筆', () => {
    const result = mergeTable<Feed>({
      local: { 'src_rss:x': row({ name: 'A' }, 10) },
      remote: { rows: { 'src_rss:x': row({ name: 'A' }, 12, 'dev-b') }, deleted: {} },
      bases: {},
      now,
      deviceId: 'dev-a',
    })
    expect(Object.keys(result.rows)).toEqual(['src_rss:x'])
    expect(result.localUpserts).toEqual({})
  })

  it('只有遠端有的新列 → 寫回本機；只有本機有的新列 → 上傳', () => {
    const result = mergeTable<Feed>({
      local: { mine: row({ name: 'mine' }, 10) },
      remote: { rows: { theirs: row({ name: 'theirs' }, 12, 'dev-b') }, deleted: {} },
      bases: {},
      now,
      deviceId: 'dev-a',
    })
    expect(Object.keys(result.rows).sort()).toEqual(['mine', 'theirs'])
    expect(result.localUpserts).toEqual({ theirs: { name: 'theirs' } })
  })

  it('別台刪了、本機沒改過 → 本機刪掉；askOnRemoteDelete 時改成待確認', () => {
    const input = {
      local: { f1: row({ name: 'feed' }, 10) },
      remote: { rows: {}, deleted: { f1: { deletedAt: 50, deviceId: 'dev-b' } } },
      bases: { f1: buildRowBase({ name: 'feed' }) },
      now,
      deviceId: 'dev-a',
    }
    const auto = mergeTable<Feed>(input)
    expect(auto.localDeletes).toEqual(['f1'])
    expect(auto.deleted.f1).toEqual({ deletedAt: 50, deviceId: 'dev-b' })
    const asked = mergeTable<Feed>({ ...input, askOnRemoteDelete: true })
    expect(asked.localDeletes).toEqual([])
    expect(asked.pendingDeletes.map(item => item.key)).toEqual(['f1'])
  })

  it('刪除對修改：本機在墓碑之後又改過 → 修改贏、墓碑清掉', () => {
    const result = mergeTable<Feed>({
      local: { f1: row({ name: 'renamed later' }, 80) },
      remote: { rows: {}, deleted: { f1: { deletedAt: 50, deviceId: 'dev-b' } } },
      bases: { f1: buildRowBase({ name: 'feed' }) },
      now,
      deviceId: 'dev-a',
    })
    expect(result.rows.f1?.v).toEqual({ name: 'renamed later' })
    expect(result.deleted.f1).toBeUndefined()
    expect(result.localDeletes).toEqual([])
  })

  it('本機刪了、遠端沒改 → 傳出墓碑；遠端改過 → 救回', () => {
    const deletedLocally = mergeTable<Feed>({
      local: {},
      remote: { rows: { f1: row({ name: 'feed' }, 10, 'dev-b') }, deleted: {} },
      bases: { f1: buildRowBase({ name: 'feed' }) },
      now,
      deviceId: 'dev-a',
    })
    expect(deletedLocally.rows.f1).toBeUndefined()
    expect(deletedLocally.deleted.f1).toEqual({ deletedAt: now, deviceId: 'dev-a' })

    const resurrected = mergeTable<Feed>({
      local: {},
      remote: { rows: { f1: row({ name: 'edited remotely' }, 10, 'dev-b') }, deleted: {} },
      bases: { f1: buildRowBase({ name: 'feed' }) },
      now,
      deviceId: 'dev-a',
    })
    expect(resurrected.localUpserts).toEqual({ f1: { name: 'edited remotely' } })
  })

  it('30 天前的墓碑清掉', () => {
    const result = mergeTable<Feed>({
      local: {},
      remote: { rows: {}, deleted: { old: { deletedAt: 0, deviceId: 'dev-b' } } },
      bases: {},
      now: 31 * 24 * 60 * 60 * 1000,
      deviceId: 'dev-a',
    })
    expect(result.deleted).toEqual({})
  })
})

describe('別名與同步鍵', () => {
  it('遷移換過 id：同步鍵 = legacyId ?? id，兩台算出一樣的鍵', () => {
    expect(legacyAwareSyncKey({ id: 'S-20261101-AB12', legacyId: 'src_rss:x' })).toBe('src_rss:x')
    expect(legacyAwareSyncKey({ id: 'src_rss:x' })).toBe('src_rss:x')
  })

  it('兩台各自遷移出不同編號：字串較小的當正式編號', () => {
    expect(chooseCanonicalId({ id: 'S-1-ZZ90' }, { id: 'S-1-AB12' })).toEqual({ canonical: 'S-1-AB12', alias: 'S-1-ZZ90' })
  })

  it('單例角色：建立時間較早的當正式 id，兩台算出一樣的結果', () => {
    const a = chooseCanonicalId({ id: 'mia-a', createdAt: 200 }, { id: 'mia-b', createdAt: 100 })
    const b = chooseCanonicalId({ id: 'mia-b', createdAt: 100 }, { id: 'mia-a', createdAt: 200 })
    expect(a).toEqual({ canonical: 'mia-b', alias: 'mia-a' })
    expect(b).toEqual(a)
  })

  it('別名對應：合併時以正式 id 為鍵就合成一筆', () => {
    const { canonical } = chooseCanonicalId({ id: 'S-1-ZZ90' }, { id: 'S-1-AB12' })
    const result = mergeTable<{ title: string }>({
      local: { [canonical]: row({ title: 'A' }, 10) },
      remote: { rows: { [canonical]: row({ title: 'A' }, 11, 'dev-b') }, deleted: {} },
      bases: {},
      now: 1,
      deviceId: 'dev-a',
    })
    expect(Object.keys(result.rows)).toEqual(['S-1-AB12'])
  })
})

describe('B、C、D 型', () => {
  it('pickForward：狀態只往前、不看時間', () => {
    const order = ['wait', 'no', 'ok']
    expect(pickForward(order, 'ok', 'wait', false)).toBe('ok')
    expect(pickForward(order, 'wait', 'no', true)).toBe('no')
  })

  it('mergeSetUnion：兩邊都留，同鍵取較晚的，墓碑之前的拿掉', () => {
    const merged = mergeSetUnion(
      { a: { value: 'a1', at: 1 }, b: { value: 'b1', at: 5 } },
      { b: { value: 'b2', at: 9 }, c: { value: 'c', at: 2 } },
      { c: { deletedAt: 3, deviceId: 'dev-b' } },
    )
    expect(merged).toEqual({ a: { value: 'a1', at: 1 }, b: { value: 'b2', at: 9 } })
  })

  it('mergeAppendEntries：聯集、依時間排、uid 去重（亂序與重複）', () => {
    const merged = mergeAppendEntries(
      [{ uid: 'a:2', at: 20 }, { uid: 'a:1', at: 10 }],
      [{ uid: 'b:1', at: 15 }, { uid: 'a:1', at: 10 }, { uid: 'b:0', at: 10 }],
    )
    expect(merged.map(entry => entry.uid)).toEqual(['a:1', 'b:0', 'b:1', 'a:2'])
  })
})

// Fork（almanac ALMNC-69.11）：scott_pins 表用真的 node:sqlite 測（同 lib/ops/db.test.ts）：寫入讀回、同一個位置只留最新時間、
// 90 天後失效並清掉、筆記庫隔離、和 69.10 的 recordScottPins 接上。
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createScottPinStore } from '@/db/scott-pins'
import { recordScottPins, registerScottPinRecorder, SCOTT_PIN_TTL_MS, type ScottPin } from './scott-pins'

type Bindings = Record<string, string | number | null>
interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): { all(bindings: Bindings): unknown[], run(bindings: Bindings): { changes: number, lastInsertRowid: number | bigint } }
  close(): void
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb }
const sqlite = new DatabaseSync(':memory:')
const bind = (values: Array<string | number | null>) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]))

vi.mock('@/db/index', () => ({
  getDb: async () => ({
    execute: async (sql: string, values: Array<string | number | null> = []) => {
      const result = sqlite.prepare(sql).run(bind(values))
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    },
    select: async (sql: string, values: Array<string | number | null> = []) => sqlite.prepare(sql).all(bind(values)),
  }),
}))

afterAll(() => sqlite.close())

const NOW = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1000
const base = { mocPath: '20 領域/時間管理.md', mocId: 'M-1', mocName: '時間管理' }
const entry = (at: number, extra: Partial<ScottPin> = {}): ScottPin => ({ ...base, kind: 'position', notePath: '筆記/a.md', noteId: 'N-1', chapterId: 'C-1', at, ...extra })

describe('scott_pins', () => {
  const store = createScottPinStore(() => '/vault-a')
  const other = createScottPinStore(() => '/vault-b')

  it('每個位置一筆：改說明、搬動同一條收錄只更新時間；區塊、章節各一筆', async () => {
    await store.save([
      entry(NOW - 10 * DAY),
      { ...base, kind: 'block', block: 'conclusions', at: NOW - 5 * DAY },
      { ...base, kind: 'chapter-title', chapterId: 'C-2', at: NOW - 5 * DAY, opId: 'op-1' },
    ])
    await store.save([entry(NOW - DAY, { kind: 'relation', chapterId: 'C-3' })])
    // 較舊的時間不會蓋掉較新的。
    await store.save([entry(NOW - 30 * DAY)])
    const pins = await store.active(NOW)
    expect(pins).toHaveLength(3)
    expect(pins.find(pin => pin.notePath)).toMatchObject({ noteId: 'N-1', at: NOW - DAY })
    expect(pins.find(pin => pin.block)).toMatchObject({ kind: 'block', block: 'conclusions', mocId: 'M-1' })
    expect(pins.find(pin => pin.kind === 'chapter-title')).toMatchObject({ chapterId: 'C-2', opId: 'op-1' })
    expect(await other.active(NOW)).toEqual([])
  })

  it('90 天後失效，讀取時順手刪掉', async () => {
    await store.save([entry(NOW - SCOTT_PIN_TTL_MS, { notePath: '筆記/old.md', noteId: 'N-old' })])
    expect((await store.active(NOW)).some(pin => pin.noteId === 'N-old')).toBe(false)
    const left = sqlite.prepare('select count(*) as n from scott_pins where note_id = $1').all(bind(['N-old'])) as Array<{ n: number }>
    expect(left[0].n).toBe(0)
    // 時間往後 90 天，原本的標記也失效。
    expect(await store.active(NOW + SCOTT_PIN_TTL_MS)).toEqual([])
  })

  it('註冊給 69.10 的 recordScottPins 後真的存下來', async () => {
    const fresh = createScottPinStore(() => '/vault-c')
    registerScottPinRecorder(pins => fresh.save(pins))
    await recordScottPins([entry(NOW, { notePath: '筆記/b.md', noteId: 'N-2' })])
    registerScottPinRecorder(null)
    expect(await fresh.active(NOW)).toMatchObject([{ noteId: 'N-2', notePath: '筆記/b.md' }])
  })

  it('自動接受的檢查（isScottPinnedChange）讀這張表：MOC 上有效標記的區塊被改到才算', async () => {
    const [{ scottPinStore }, { isScottPinnedChange }, { default: useSettingStore }] = await Promise.all([
      import('@/db/scott-pins'), import('./scott-pins-runtime'), import('@/stores/setting'),
    ])
    useSettingStore.setState({ workspacePath: '/vault-d' })
    const mocPath = '20 領域/專注力.md'
    const before = '---\nid: M-20261112-060012-VPB3\nkind: domain\ntitle: 專注力\n---\n# 專注力\n\n## ④ 重點結論\n- 番茄鐘可以減少切換。\n'
    const change = { target: 'note' as const, path: mocPath, before, after: before.replace('- 番茄鐘', '- [[番茄鐘]]') }
    expect(await isScottPinnedChange(change)).toBe(false)
    await scottPinStore.save([{ kind: 'block', block: 'conclusions', mocPath, mocId: 'M-20261112-060012-VPB3', mocName: '專注力', at: Date.now() - DAY }])
    expect(await isScottPinnedChange(change)).toBe(true)
    expect(await isScottPinnedChange({ target: 'note', path: '筆記/a.md', before: '# a\n', after: '# [[a]]\n' })).toBe(false)
  })
})

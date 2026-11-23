import { describe, expect, it } from 'vitest'
import { isId, parseId } from '@/lib/v3-model/identity'
import {
  filenameTime,
  isEmptyPlan,
  noteCreatedAt,
  planIdMigration,
  readFrontmatter,
  renderIdMigrationReport,
  type IdMigrationPlan,
  type IdMigrationSnapshot,
  type MigrationNoteFile,
} from './id-migration'

const TAIPEI = -480
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0)
const UUID_SOURCE = 'src_0b5e7c1a-1111-4222-8333-944455556666'
const EMAIL_SOURCE = 'src_email:<abc@example.com>'
const LEGACY_SOURCE = 'src_legacy:舊/筆記.md'

function fixedRandom() {
  let i = 0
  return () => ((i++ * 7) % 36) / 36
}

function note(path: string, frontmatter: string, body = '內文\n', extra: Partial<MigrationNoteFile> = {}): MigrationNoteFile {
  return { path, raw: frontmatter ? `---\n${frontmatter}\n---\n${body}` : body, ...extra }
}

function baseSnapshot(): IdMigrationSnapshot {
  return {
    notes: [
      note('10 知識/2026-11-20 1430 切換工作.md', `type: knowledge\nsources: [${UUID_SOURCE}]\ndomains: [dom_time, dom_gone]\nstatus: 有效`),
      note('30 日誌/週會.md', `id: N-20261110-063015-B3XR\ntype: record\nsources: ["${EMAIL_SOURCE}"]`),
      note('40 專案/回顧.md', 'type: project\nstatus: valid', '內文\n', { birthtime: Date.UTC(2026, 10, 2, 1, 0, 0), mtime: Date.UTC(2026, 10, 3, 1, 0, 0) }),
      note('Daily/2026-11-20.md', '', '- [ ] 任務\n'),
      note('README.md', 'title: 說明'),
    ],
    sources: [
      { id: UUID_SOURCE, createdAt: Date.UTC(2026, 10, 1, 2, 3, 4) },
      { id: EMAIL_SOURCE, createdAt: Date.UTC(2026, 10, 5, 0, 0, 0), previousId: null },
      { id: 'src_v2', createdAt: Date.UTC(2026, 10, 6, 0, 0, 0), previousId: EMAIL_SOURCE },
      { id: LEGACY_SOURCE, createdAt: Date.UTC(2026, 9, 1, 0, 0, 0) },
      { id: 'S-20261101-000000-AAAA', createdAt: Date.UTC(2026, 10, 1), legacyId: 'src_old' },
    ],
    sourceOutputs: [
      { sourceId: UUID_SOURCE, targetType: 'note', targetRef: '10 知識/2026-11-20 1430 切換工作.md', createdAt: Date.UTC(2026, 10, 20, 6, 31, 0) },
      { sourceId: EMAIL_SOURCE, targetType: 'note', targetRef: '30 日誌/週會.md', createdAt: Date.UTC(2026, 10, 10, 6, 30, 15) },
      { sourceId: EMAIL_SOURCE, targetType: 'action', targetRef: 'Daily/2026-11-20.md#prop-1', createdAt: Date.UTC(2026, 10, 20) },
      { sourceId: EMAIL_SOURCE, targetType: 'action', targetRef: '30 日誌/週會.md#prop-2', createdAt: Date.UTC(2026, 10, 20) },
      { sourceId: 'S-20261101-000000-AAAA', targetType: 'note', targetRef: 'N-20261110-063015-B3XR', createdAt: Date.UTC(2026, 10, 20) },
      { sourceId: UUID_SOURCE, targetType: 'note', targetRef: '已刪除.md', createdAt: Date.UTC(2026, 10, 20) },
    ],
    domains: [
      { id: 'dom_time', name: '時間管理', createdAt: Date.UTC(2026, 10, 12, 6, 0, 12) },
      { id: 'dom_focus', name: '專注力', createdAt: Date.UTC(2026, 10, 12, 6, 2, 40) },
    ],
    idIndex: [],
    judgementSourceIds: [UUID_SOURCE, 'src_unknown'],
    legacyPackSourceIds: [LEGACY_SOURCE],
  }
}

function plan(snapshot: IdMigrationSnapshot): IdMigrationPlan {
  return planIdMigration(snapshot, { now: NOW, timezoneOffsetMinutes: TAIPEI, random: fixedRandom() })
}

/** 把計畫套到快照上（模擬 CLI 套用），用來驗證重跑。 */
function applyToSnapshot(snapshot: IdMigrationSnapshot, result: IdMigrationPlan): IdMigrationSnapshot {
  const notes = snapshot.notes.map(file => {
    const change = result.notes.find(entry => entry.path === file.path)
    return change ? { ...file, raw: change.after } : file
  })
  const renamed = new Map(result.sources.map(change => [change.before.id, change.after]))
  const previous = new Map(result.previousIds.map(change => [change.before, change.after]))
  const sources = snapshot.sources.map(row => {
    const after = renamed.get(row.id)
    const previousId = row.previousId && previous.has(row.previousId) ? previous.get(row.previousId)! : row.previousId
    return after ? { ...row, id: after.id, legacyId: after.legacyId, previousId } : { ...row, previousId }
  })
  const key = (row: { sourceId: string, targetType: string, targetRef: string }) => `${row.sourceId}|${row.targetType}|${row.targetRef}`
  let outputs = [...snapshot.sourceOutputs]
  for (const change of result.outputs) {
    const index = outputs.findIndex(row => key(row) === key(change.before))
    if (index < 0) continue
    if (change.action === 'delete') outputs.splice(index, 1)
    else outputs[index] = { ...outputs[index], ...change.after }
  }
  outputs = outputs.filter((row, index, all) => all.findIndex(other => key(other) === key(row)) === index)
  const idIndex = [...snapshot.idIndex]
  for (const change of result.idIndex) {
    const existing = idIndex.findIndex(row => row.id === change.id)
    if (existing >= 0) idIndex[existing] = { ...idIndex[existing], path: change.path ?? null }
    else idIndex.push({ id: change.id, kind: change.kind, path: change.path ?? null, name: change.name ?? null })
  }
  const refs = (table: string, ids: readonly string[] = []) => ids.map(id => result.sourceRefs.find(change => change.table === table && change.before === id)?.after ?? id)
  return {
    ...snapshot, notes, sources, sourceOutputs: outputs, idIndex,
    judgementSourceIds: refs('source_judgements', snapshot.judgementSourceIds),
    legacyPackSourceIds: refs('legacy_undecided', snapshot.legacyPackSourceIds),
  }
}

describe('planIdMigration', () => {
  it('補 N 編號（用檔名時間）、來源換 S、領域換名稱、中文狀態換英文，id 放第一行', () => {
    const result = plan(baseSnapshot())
    const change = result.notes.find(entry => entry.path === '10 知識/2026-11-20 1430 切換工作.md')!
    expect(change.kinds).toEqual(['id', 'sources', 'domains', 'status'])
    expect(change.createdAtSource).toBe('filename')
    // 檔名 14:30 是台灣時間 → UTC 06:30。
    expect(change.newId).toMatch(/^N-20261120-063000-[A-Z0-9]{4}$/)
    expect(change.after.split('\n')[1]).toBe(`id: ${change.newId}`)
    const fm = readFrontmatter(change.after)!
    const sourceId = result.sources.find(entry => entry.before.id === UUID_SOURCE)!.after.id
    expect(fm.sources).toEqual([sourceId])
    expect(fm.domains).toEqual(['時間管理', 'dom_gone'])
    expect(fm.status).toBe('valid')
    expect(result.warnings.some(warning => warning.includes('dom_gone'))).toBe(true)
  })

  it('日誌筆記 type: record 改成 log；已有 id 的不重產', () => {
    const result = plan(baseSnapshot())
    const change = result.notes.find(entry => entry.path === '30 日誌/週會.md')!
    expect(change.kinds).toEqual(['sources', 'type'])
    expect(change.newId).toBeUndefined()
    const fm = readFrontmatter(change.after)!
    expect(fm.type).toBe('log')
    expect(fm.id).toBe('N-20261110-063015-B3XR')
    expect(result.idIndex).toContainEqual(expect.objectContaining({ action: 'insert', id: 'N-20261110-063015-B3XR', kind: 'N', path: '30 日誌/週會.md' }))
  })

  it('資料源換 S 編號：時間用建立時間，舊 id 存 legacy_id；已是 S 的跳過；版本鏈與其他表一起改', () => {
    const result = plan(baseSnapshot())
    expect(result.sources).toHaveLength(4)
    const uuid = result.sources.find(entry => entry.before.id === UUID_SOURCE)!
    expect(uuid.after.id).toMatch(/^S-20261101-020304-[A-Z0-9]{4}$/)
    expect(uuid.after.legacyId).toBe(UUID_SOURCE)
    expect(result.stats.sourcesAlreadyS).toBe(1)
    const email = result.sources.find(entry => entry.before.id === EMAIL_SOURCE)!.after.id
    expect(result.previousIds).toEqual([{ before: EMAIL_SOURCE, after: email }])
    expect(result.sourceRefs).toEqual([
      { table: 'source_judgements', before: UUID_SOURCE, after: uuid.after.id },
      { table: 'legacy_undecided', before: LEGACY_SOURCE, after: result.sources.find(entry => entry.before.id === LEGACY_SOURCE)!.after.id },
    ])
    for (const change of result.sources) expect(isId(change.after.id, 'S')).toBe(true)
  })

  it('target_ref 改成 N 編號（含「路徑#提案 id」），目標沒有編號的保留路徑，找不到的筆記列警告', () => {
    const result = plan(baseSnapshot())
    const newNoteId = result.notes.find(entry => entry.path === '10 知識/2026-11-20 1430 切換工作.md')!.newId!
    const email = result.sources.find(entry => entry.before.id === EMAIL_SOURCE)!.after.id
    const uuid = result.sources.find(entry => entry.before.id === UUID_SOURCE)!.after.id
    expect(result.outputs).toContainEqual({ action: 'update', before: { sourceId: UUID_SOURCE, targetType: 'note', targetRef: '10 知識/2026-11-20 1430 切換工作.md' }, after: { sourceId: uuid, targetType: 'note', targetRef: newNoteId } })
    expect(result.outputs).toContainEqual(expect.objectContaining({ after: { sourceId: email, targetType: 'action', targetRef: 'N-20261110-063015-B3XR#prop-2' } }))
    // 每日筆記不是 V3 筆記、沒有編號：路徑留著，只換資料源。
    expect(result.outputs).toContainEqual(expect.objectContaining({ after: { sourceId: email, targetType: 'action', targetRef: 'Daily/2026-11-20.md#prop-1' } }))
    expect(result.outputs).toContainEqual(expect.objectContaining({ after: { sourceId: uuid, targetType: 'note', targetRef: '已刪除.md' } }))
    expect(result.warnings.some(warning => warning.includes('已刪除.md'))).toBe(true)
    // 已經是 S＋N 的連結不動。
    expect(result.outputs.some(change => change.before.targetRef === 'N-20261110-063015-B3XR')).toBe(false)
  })

  it('每個領域產生 M 編號（時間用領域建立時間），登記在 id_index 的名稱', () => {
    const result = plan(baseSnapshot())
    expect(result.domainMocs.map(entry => entry.name)).toEqual(['時間管理', '專注力'])
    expect(result.domainMocs[0].mocId).toMatch(/^M-20261112-060012-[A-Z0-9]{4}$/)
    expect(result.idIndex).toContainEqual(expect.objectContaining({ action: 'insert', kind: 'M', name: '時間管理', id: result.domainMocs[0].mocId }))
  })

  it('筆記庫已有同名的 MOC 檔（frontmatter id 是 M）：沿用它的編號並登記路徑', () => {
    const snapshot = baseSnapshot()
    snapshot.notes = [...snapshot.notes, note('20 領域/時間管理.md', 'id: M-20261112-060012-VPB3\nkind: domain')]
    const result = plan(snapshot)
    expect(result.domainMocs.map(entry => entry.name)).toEqual(['專注力'])
    expect(result.idIndex).toContainEqual(expect.objectContaining({ action: 'insert', id: 'M-20261112-060012-VPB3', kind: 'M', name: '時間管理', path: '20 領域/時間管理.md' }))
    expect(isEmptyPlan(plan(applyToSnapshot(snapshot, result)))).toBe(true)
  })

  it('非 V3 的檔案不動；專案筆記沒有檔名時間時用檔案建立時間', () => {
    const result = plan(baseSnapshot())
    expect(result.notes.some(entry => entry.path === 'Daily/2026-11-20.md' || entry.path === 'README.md')).toBe(false)
    const project = result.notes.find(entry => entry.path === '40 專案/回顧.md')!
    expect(project.createdAtSource).toBe('birthtime')
    expect(project.newId).toMatch(/^N-20261102-010000-/)
  })

  it('可重跑：套用後再算一次，沒有任何變更', () => {
    const snapshot = baseSnapshot()
    const first = plan(snapshot)
    expect(isEmptyPlan(first)).toBe(false)
    const second = plan(applyToSnapshot(snapshot, first))
    expect(second.notes).toEqual([])
    expect(second.sources).toEqual([])
    expect(second.outputs).toEqual([])
    expect(second.domainMocs).toEqual([])
    expect(second.idIndex).toEqual([])
    expect(isEmptyPlan(second)).toBe(true)
  })

  it('遷移後才寫進來、還引用舊 id 的筆記：重跑時換成現在的 S 編號', () => {
    const snapshot = baseSnapshot()
    const first = plan(snapshot)
    const after = applyToSnapshot(snapshot, first)
    const late = note('10 知識/後來的.md', `id: N-20261122-000000-ZZZZ\ntype: knowledge\nsources: [${UUID_SOURCE}]`)
    const second = plan({ ...after, notes: [...after.notes, late], idIndex: [...after.idIndex, { id: 'N-20261122-000000-ZZZZ', kind: 'N', path: '10 知識/後來的.md' }] })
    const uuid = first.sources.find(entry => entry.before.id === UUID_SOURCE)!.after.id
    expect(second.notes).toHaveLength(1)
    expect(readFrontmatter(second.notes[0].after)!.sources).toEqual([uuid])
  })

  it('id_index 已有這個路徑的 N 編號（檔案的 id 被刪掉）：沿用，不重產', () => {
    const snapshot = { ...baseSnapshot(), idIndex: [{ id: 'N-20261101-010101-KEEP', kind: 'N', path: '40 專案/回顧.md' }] }
    const result = plan(snapshot)
    const project = result.notes.find(entry => entry.path === '40 專案/回顧.md')!
    expect(project.newId).toBe('N-20261101-010101-KEEP')
    expect(project.createdAtSource).toBe('index')
  })

  it('改寫後和既有的連結重複：刪掉舊列', () => {
    const snapshot = baseSnapshot()
    snapshot.sourceOutputs = [
      { sourceId: 'S-20261101-000000-AAAA', targetType: 'note', targetRef: '30 日誌/週會.md', createdAt: 1 },
      { sourceId: 'S-20261101-000000-AAAA', targetType: 'note', targetRef: 'N-20261110-063015-B3XR', createdAt: 2 },
    ]
    const result = plan(snapshot)
    expect(result.outputs).toEqual([{ action: 'delete', before: { sourceId: 'S-20261101-000000-AAAA', targetType: 'note', targetRef: '30 日誌/週會.md' }, after: { sourceId: 'S-20261101-000000-AAAA', targetType: 'note', targetRef: 'N-20261110-063015-B3XR' } }])
  })

  it('格式不對的 id 與重複的 id 只列警告', () => {
    const snapshot = baseSnapshot()
    snapshot.notes = [
      note('a.md', 'id: 123\ntype: knowledge'),
      note('b.md', 'id: N-20261110-063015-B3XR\ntype: knowledge'),
      note('c.md', 'id: N-20261110-063015-B3XR\ntype: knowledge'),
    ]
    const result = plan(snapshot)
    expect(result.notes.some(entry => entry.kinds.includes('id'))).toBe(false)
    expect(result.warnings.some(warning => warning.startsWith('a.md'))).toBe(true)
    expect(result.warnings.some(warning => warning.startsWith('c.md') && warning.includes('b.md'))).toBe(true)
  })

  it('新編號不撞既有編號', () => {
    const result = plan(baseSnapshot())
    const ids = [...result.sources.map(entry => entry.after.id), ...result.idIndex.map(entry => entry.id)]
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(parseId(id)).not.toBeNull()
  })
})

describe('noteCreatedAt', () => {
  const file = (path: string, extra: Partial<MigrationNoteFile> = {}) => ({ path, raw: '', ...extra })

  it('frontmatter 建立時間優先，其次檔名、追溯連結、birthtime／mtime（取較早）', () => {
    const links = new Map([['x.md', 3_000_000]])
    expect(noteCreatedAt(file('2026-11-20 1430 x.md'), { created: '2026-11-01 08:00' }, links, TAIPEI)).toEqual({ at: Date.UTC(2026, 10, 1, 0, 0), source: 'frontmatter' })
    expect(noteCreatedAt(file('2026-11-20 1430 x.md'), {}, links, TAIPEI)?.source).toBe('filename')
    expect(noteCreatedAt(file('x.md', { birthtime: 5_000_000 }), {}, links, TAIPEI)).toEqual({ at: 3_000_000, source: 'link' })
    expect(noteCreatedAt(file('y.md', { birthtime: 9_000_000, mtime: 4_000_000 }), {}, links, TAIPEI)).toEqual({ at: 4_000_000, source: 'mtime' })
    expect(noteCreatedAt(file('y.md'), {}, links, TAIPEI)).toBeUndefined()
  })

  it('frontmatter 的 date（事件日期）不算建立時間', () => {
    expect(noteCreatedAt(file('y.md', { mtime: 4_000_000 }), { date: '2026-01-01' }, new Map(), TAIPEI)?.source).toBe('mtime')
  })

  it('檔名時間前綴換成 UTC；不存在的日期不算', () => {
    expect(filenameTime('a/2026-11-20 0005 標題.md', TAIPEI)).toBe(Date.UTC(2026, 10, 19, 16, 5))
    expect(filenameTime('2026-02-30 1200 x.md', TAIPEI)).toBeUndefined()
    expect(filenameTime('標題.md', TAIPEI)).toBeUndefined()
  })
})

describe('renderIdMigrationReport', () => {
  it('有統計與逐項清單；空計畫說明沒有需要遷移的項目', () => {
    const result = plan(baseSnapshot())
    const report = renderIdMigrationReport(result, { vault: '/v', db: '/d/note.db', generatedAt: NOW })
    expect(report).toContain('## 統計')
    expect(report).toContain('| 資料源換 S 編號 | 4 |')
    expect(report).toContain('## 筆記檔')
    expect(report).toContain('10 知識/2026-11-20 1430 切換工作.md')
    expect(report).toContain('## 領域 → M 編號')
    const empty = renderIdMigrationReport(plan(applyToSnapshot(baseSnapshot(), result)))
    expect(empty).toContain('沒有需要遷移的項目')
  })
})

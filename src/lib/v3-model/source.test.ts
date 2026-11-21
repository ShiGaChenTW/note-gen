// Fork（almanac ALMNC-54.1）：資料源狀態、鎖定、改版、封存規則（AC1、AC2、AC6）。
import { describe, expect, it } from 'vitest'
import {
  REJECTED_ARCHIVE_AFTER_MS,
  archiveSource,
  canTransition,
  createSource,
  editSourceContent,
  initialStatus,
  latestVersions,
  sourceFromRow,
  sourceToValues,
  sourcesDueForArchive,
  submitSource,
  transitionSource,
  versionChain,
  type Source,
  type SourceRow,
  type SourceStatus,
  type SourceType,
} from './source'

const T0 = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

function make(sourceType: SourceType, overrides: Partial<Source> = {}): Source {
  return {
    ...createSource({ id: 'a', sourceType, kind: 'text', content: '原文', origin: 'https://example.com', collector: 'scott' }, T0),
    ...overrides,
  }
}

describe('資料源欄位與初始狀態（AC1）', () => {
  it('建立時帶齊來源類型、原始內容、來處、收集時間、收集者、狀態', () => {
    const source = createSource({ id: 'x', sourceType: 'external', kind: 'link', content: 'c', origin: 'https://a.b', collector: '指揮官', collectedAt: T0 - 5 }, T0)
    expect(source).toMatchObject({
      id: 'x', sourceType: 'external', kind: 'link', content: 'c', origin: 'https://a.b',
      collectedAt: T0 - 5, collector: '指揮官', status: 'awaiting_decision', version: 1, statusChangedAt: T0,
    })
    expect(source.previousId).toBeUndefined()
    expect(source.archivedAt).toBeUndefined()
  })

  it('只有外部擷取從「等你決定」開始，自己寫的和系統產生的直接待分析', () => {
    expect(initialStatus('external')).toBe('awaiting_decision')
    expect(initialStatus('self')).toBe('pending_analysis')
    expect(initialStatus('system')).toBe('pending_analysis')
  })

  it('收集時間預設等於建立時間', () => {
    expect(make('self').collectedAt).toBe(T0)
  })
})

describe('狀態流轉（AC1）', () => {
  const allowed: [SourceStatus, SourceStatus][] = [
    ['awaiting_decision', 'pending_analysis'],
    ['awaiting_decision', 'rejected'],
    ['pending_analysis', 'analyzing'],
    ['analyzing', 'analyzed'],
    ['analyzing', 'rejected'],
    ['analyzing', 'pending_analysis'],
  ]
  const forbidden: [SourceStatus, SourceStatus][] = [
    ['awaiting_decision', 'analyzing'],
    ['awaiting_decision', 'analyzed'],
    ['pending_analysis', 'analyzed'],
    ['pending_analysis', 'awaiting_decision'],
    ['pending_analysis', 'rejected'],
    ['analyzed', 'pending_analysis'],
    ['analyzed', 'rejected'],
    ['rejected', 'pending_analysis'],
    ['rejected', 'analyzed'],
  ]

  it.each(allowed)('允許 %s → %s', (from, to) => expect(canTransition(from, to)).toBe(true))
  it.each(forbidden)('不允許 %s → %s', (from, to) => expect(canTransition(from, to)).toBe(false))

  it('走完整條外部擷取流程', () => {
    let source = make('external')
    source = transitionSource(source, 'pending_analysis', T0 + 1)
    source = transitionSource(source, 'analyzing', T0 + 2)
    source = transitionSource(source, 'analyzed', T0 + 3)
    expect(source.status).toBe('analyzed')
    expect(source.statusChangedAt).toBe(T0 + 3)
    expect(source.updatedAt).toBe(T0 + 3)
  })

  it('不合法的流轉丟錯，不改原物件', () => {
    const source = make('external')
    expect(() => transitionSource(source, 'analyzed', T0 + 1)).toThrow()
    expect(source.status).toBe('awaiting_decision')
  })

  it('已封存的資料源不能再改狀態', () => {
    const source = make('external', { status: 'rejected', archivedAt: T0 })
    expect(() => transitionSource(source, 'pending_analysis', T0 + 1)).toThrow()
  })
})

describe('送出與鎖定（AC2）', () => {
  it('外部擷取送出前是草稿，送出後鎖定', () => {
    const draft = make('external')
    expect(draft.lockedAt).toBeUndefined()
    const submitted = submitSource(draft, T0 + 10)
    expect(submitted.status).toBe('pending_analysis')
    expect(submitted.lockedAt).toBe(T0 + 10)
  })

  it('自己寫的、系統產生的一進來就送出，所以建立時就鎖定', () => {
    expect(make('self').lockedAt).toBe(T0)
    expect(make('system').lockedAt).toBe(T0)
  })

  it('等你決定時直接不採用不會鎖定', () => {
    expect(transitionSource(make('external'), 'rejected', T0 + 1).lockedAt).toBeUndefined()
  })

  it('鎖定時間在之後的流轉中維持不變', () => {
    const locked = submitSource(make('external'), T0 + 1)
    expect(transitionSource(locked, 'analyzing', T0 + 2).lockedAt).toBe(T0 + 1)
  })
})

describe('修改原始內容（AC2）', () => {
  it('草稿原地修改', () => {
    const result = editSourceContent(make('external'), '改過', T0 + 5, 'b')
    expect(result.kind).toBe('updated')
    expect(result.source.id).toBe('a')
    expect(result.source.content).toBe('改過')
    expect(result.source.version).toBe(1)
  })

  it('鎖定後修改產生新版本，舊版原封不動', () => {
    const old = transitionSource(submitSource(make('external'), T0 + 1), 'analyzing', T0 + 2)
    const snapshot = structuredClone(old)
    const result = editSourceContent(old, '第二版', T0 + 9, 'b')
    expect(result.kind).toBe('versioned')
    if (result.kind !== 'versioned') return
    expect(old).toEqual(snapshot)
    expect(result.previous).toBe(old)
    expect(result.source).toMatchObject({
      id: 'b', content: '第二版', version: 2, previousId: 'a', status: 'pending_analysis',
      lockedAt: T0 + 9, createdAt: T0 + 9, sourceType: 'external', origin: 'https://example.com', collector: 'scott', collectedAt: T0,
    })
  })

  it('新版本必須換 id', () => {
    expect(() => editSourceContent(make('self'), 'x', T0 + 1, 'a')).toThrow()
  })

  it('已封存的資料源不能修改', () => {
    expect(() => editSourceContent(make('external', { status: 'rejected', archivedAt: T0 }), 'x', T0 + 1, 'b')).toThrow()
  })

  it('版本鏈與最新版', () => {
    const v1 = make('self')
    const r2 = editSourceContent(v1, '2', T0 + 1, 'b')
    const v2 = r2.source
    const r3 = editSourceContent(v2, '3', T0 + 2, 'c')
    const v3 = r3.source
    const other = make('self', { id: 'z' })
    const all = [v3, other, v1, v2]
    expect(versionChain(all, 'c').map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(versionChain(all, 'missing')).toEqual([])
    expect(latestVersions(all).map(s => s.id).sort()).toEqual(['c', 'z'])
  })
})

describe('不採用 30 天後封存（AC6）', () => {
  const rejected = (id: string, at: number, extra: Partial<Source> = {}) =>
    make('external', { id, status: 'rejected', statusChangedAt: at, ...extra })

  it('只挑出不採用滿 30 天且還沒封存的', () => {
    const now = T0 + 40 * DAY
    const list = [
      rejected('old', T0),
      rejected('exact', now - REJECTED_ARCHIVE_AFTER_MS),
      rejected('fresh', now - 29 * DAY),
      rejected('done', T0, { archivedAt: T0 + 31 * DAY }),
      make('external', { id: 'analyzed', status: 'analyzed', statusChangedAt: T0 }),
      make('external', { id: 'waiting', status: 'awaiting_decision', statusChangedAt: T0 }),
    ]
    expect(sourcesDueForArchive(list, now)).toEqual(['old', 'exact'])
  })

  it('封存只設 archivedAt，內容與狀態保留', () => {
    const source = rejected('old', T0)
    const archived = archiveSource(source, T0 + 31 * DAY)
    expect(archived).toEqual({ ...source, archivedAt: T0 + 31 * DAY, updatedAt: T0 + 31 * DAY })
  })

  it('重複封存不改時間；非不採用的不能封存', () => {
    const once = archiveSource(rejected('old', T0), T0 + 31 * DAY)
    expect(archiveSource(once, T0 + 60 * DAY)).toBe(once)
    expect(() => archiveSource(make('external'), T0)).toThrow()
  })
})

describe('資料庫列對應', () => {
  it('列 → 模型 → 值，順序與 insert 欄位一致', () => {
    const row: SourceRow = {
      id: 'b', sourceType: 'external', kind: 'link', content: 'c', origin: null, collectedAt: 1, collector: 'scott',
      status: 'rejected', statusChangedAt: 2, version: 2, previousId: 'a', lockedAt: 3, archivedAt: null, createdAt: 4, updatedAt: 5,
    }
    const source = sourceFromRow(row)
    expect(source.origin).toBeUndefined()
    expect(source.archivedAt).toBeUndefined()
    expect(source.previousId).toBe('a')
    expect(sourceToValues(source)).toEqual(['b', 'external', 'link', 'c', null, 1, 'scott', 'rejected', 2, 2, 'a', 3, null, 4, 5])
  })

  it('未知的來源類型或狀態丟錯', () => {
    const base = sourceToValues(make('self'))
    expect(base).toHaveLength(15)
    const row = { ...make('self'), origin: null, previousId: null, lockedAt: null, archivedAt: null } as unknown as SourceRow
    expect(() => sourceFromRow({ ...row, sourceType: 'web' })).toThrow()
    expect(() => sourceFromRow({ ...row, status: 'done' })).toThrow()
  })
})

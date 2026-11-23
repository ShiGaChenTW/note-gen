// Fork（almanac ALMNC-54.8）：資料源分頁——三個來處併成一條清單、狀態篩選、勾選、交給指揮官整理的步驟。
import { describe, expect, it } from 'vitest'
import { createSource, type Source } from '@/lib/v3-model/source'
import type { SourceJudgement } from './judgement'
import {
  bridgeInput, buildSourceRows, canReject, captureSourceId, dayBucket, DEFAULT_SOURCE_FILTER, filterCounts, filterRows, isUserCapture, organisedSummary, pickState,
  planHandToCommander, recordSourceId, restorePicks, sourceDisplayKind, sourceTitle, toggleAll, togglePick, waitingCount, type CaptureLike, type RecordLike,
} from './sources-tab'

const NOW = new Date(2026, 10, 21, 10).getTime()
const H = 3_600_000

function source(id: string, status: Source['status'], extra: Partial<Source> = {}): Source {
  return { ...createSource({ id, sourceType: 'external', kind: 'link', content: `${id} 的標題\n內文第一行`, origin: `https://example.com/${id}`, collector: 'scott' }, NOW - H), status, ...extra }
}

const record = (id: number, extra: Partial<RecordLike> = {}): RecordLike => ({ id, type: 'text', content: `記錄 ${id}\n內容`, desc: '', url: '', createdAt: NOW - 2 * H, ...extra })
const capture = (id: string, extra: Partial<CaptureLike> = {}): CaptureLike => ({ id, input: { kind: 'text', text: `收集 ${id}` }, createdAt: NOW - 3 * H, state: 'ready', proposals: [], ...extra })

describe('buildSourceRows', () => {
  it('maps V3 statuses: 等你決定／未整理（待分析、分析中、改過未送）／已整理（產出數）／不採用', () => {
    const rows = buildSourceRows({
      sources: [source('w', 'awaiting_decision'), source('p', 'pending_analysis'), source('i', 'analyzing'), source('d', 'analyzed'), source('n', 'rejected'), source('e', 'pending_analysis', { version: 2 })],
      outputCounts: new Map([['d', 3]]),
      edited: new Set(['e']),
    })
    const byId = Object.fromEntries(rows.map(row => [row.id, row]))
    expect(byId['src:w'].status).toBe('wait')
    expect(byId['src:p'].status).toBe('todo')
    expect(byId['src:i'].status).toBe('ing')
    expect(byId['src:d']).toMatchObject({ status: 'done', outputs: 3 })
    expect(byId['src:n'].status).toBe('no')
    expect(byId['src:e']).toMatchObject({ status: 'edited', version: 2 })
    expect(byId['src:w']).toMatchObject({ title: 'w 的標題', excerpt: '內文第一行', kind: 'web', from: 'https://example.com/w' })
  })

  it('bridges old inbox records and collect items, without duplicates once they became sources', () => {
    const rows = buildSourceRows({
      sources: [source(recordSourceId(2), 'pending_analysis'), source(captureSourceId('c2'), 'analyzed')],
      records: [record(1), record(2), record(3, { type: 'link', url: 'https://a.b', desc: 'A 的文章' })],
      processed: new Map([[3, { notePath: '收件/A 的文章.md' }]]),
      captures: [
        capture('c1', { proposals: [{ status: 'ok' }, { status: 'no' }] }),
        capture('c2'),
        capture('from-record', { recordId: 1 }),
        capture('commander-batch', { input: { kind: 'text', text: '', name: 'Mia 分析的資料源' } }),
      ],
    })
    expect(rows.map(row => row.id)).toEqual([`src:${recordSourceId(2)}`, `src:${captureSourceId('c2')}`, 'rec:1', 'rec:3', 'cap:c1'])
    expect(rows.find(row => row.id === 'rec:1')).toMatchObject({ status: 'todo', origin: 'record', title: '記錄 1' })
    expect(rows.find(row => row.id === 'rec:3')).toMatchObject({ status: 'done', outputs: 1, kind: 'web', title: 'A 的文章' })
    expect(rows.find(row => row.id === 'cap:c1')).toMatchObject({ status: 'done', outputs: 1 })
    expect(isUserCapture({ input: { kind: 'text', text: '' } })).toBe(false)
  })

  it('titles fall back to the origin for unreadable content', () => {
    expect(sourceTitle({ content: 'data:image/png;base64,xxx', origin: '截圖 · 11/19 14:03', kind: 'image' })).toBe('截圖 · 11/19 14:03')
    expect(sourceTitle({ content: '# 標題\n內文', kind: 'text' })).toBe('標題')
  })
})

describe('status filter, counts and summary', () => {
  const rows = buildSourceRows({
    sources: [source('w', 'awaiting_decision'), source('p', 'pending_analysis'), source('d', 'analyzed'), source('n', 'rejected')],
    records: [record(1)],
  })

  it('filters 待處理（含等你決定）／已分析／不採用 and counts each（ALMNC-69.3）', () => {
    expect(DEFAULT_SOURCE_FILTER).toEqual({ status: 'pending', journal: false })
    expect(filterRows(rows, { status: 'pending', journal: false }).map(row => row.id)).toEqual(['src:w', 'src:p', 'rec:1'])
    expect(filterRows(rows, { status: 'analyzed', journal: false }).map(row => row.id)).toEqual(['src:d'])
    expect(filterRows(rows, { status: 'rejected', journal: false }).map(row => row.id)).toEqual(['src:n'])
    expect(filterCounts(rows, DEFAULT_SOURCE_FILTER)).toEqual({ pending: 3, analyzed: 1, rejected: 1, journal: 0 })
    // 卡片上保留「等你決定」：列的狀態還是 wait。
    expect(rows.find(row => row.id === 'src:w')?.status).toBe('wait')
  })

  it('combines the status row with the 日誌 type row（ALMNC-69.3）', () => {
    const tagged = buildSourceRows({
      sources: [
        source('j1', 'pending_analysis', { journal: true }),
        source('j2', 'analyzed', { journal: true }),
        source('p', 'pending_analysis'),
        source('d', 'analyzed'),
      ],
    })
    expect(tagged.find(row => row.id === 'src:j1')?.journal).toBe(true)
    expect(tagged.find(row => row.id === 'src:p')?.journal).toBeUndefined()
    expect(filterRows(tagged, { status: 'pending', journal: true }).map(row => row.id)).toEqual(['src:j1'])
    expect(filterRows(tagged, { status: 'analyzed', journal: true }).map(row => row.id)).toEqual(['src:j2'])
    expect(filterRows(tagged, { status: 'analyzed', journal: false }).map(row => row.id)).toEqual(['src:j2', 'src:d'])
    expect(filterCounts(tagged, { status: 'pending', journal: true })).toEqual({ pending: 1, analyzed: 1, rejected: 0, journal: 1 })
    expect(filterCounts(tagged, { status: 'analyzed', journal: false })).toEqual({ pending: 2, analyzed: 2, rejected: 0, journal: 1 })
    expect(canReject(tagged.find(row => row.id === 'src:j1')!)).toBe(false)
    expect(canReject(tagged.find(row => row.id === 'src:p')!)).toBe(true)
  })

  it('shows 「N / M 已整理」 and the waiting badge', () => {
    expect(organisedSummary(rows)).toEqual({ done: 1, total: 5 })
    expect(waitingCount(rows)).toBe(1)
  })
})

describe('selection', () => {
  it('toggles rows and select-all only over the current list', () => {
    let picked = togglePick(new Set(), 'a')
    expect(pickState(['a', 'b'], picked)).toBe('some')
    picked = toggleAll(['a', 'b'], picked)
    expect([...picked]).toEqual(['a', 'b'])
    expect(pickState(['a', 'b'], picked)).toBe('all')
    picked = toggleAll(['a', 'b'], new Set(['a', 'b', 'z']))
    expect([...picked]).toEqual(['z'])
    expect(pickState([], new Set())).toBe('none')
    expect(togglePick(new Set(['a']), 'a').size).toBe(0)
  })
})

describe('hand to commander', () => {
  it('plans: submit awaiting, re-analyse organised as a new version, kick queued, bridge old data', () => {
    const rows = buildSourceRows({
      sources: [source('w', 'awaiting_decision'), source('d', 'analyzed'), source('p', 'pending_analysis'), source('i', 'analyzing')],
      records: [record(1)],
      processed: new Map(),
    })
    const { steps, reorganise } = planHandToCommander(rows)
    expect(steps.map(step => step.op)).toEqual(['submit', 'reanalyze', 'kick', 'bridge'])
    expect(reorganise).toBe(1)
  })

  it('bridges records with a fixed id; links are external, the rest self-written', () => {
    const [text] = buildSourceRows({ sources: [], records: [record(7)] })
    expect(bridgeInput(text)).toMatchObject({ id: 'rec_7', sourceType: 'self', kind: 'text', content: '記錄 7\n內容' })
    const [link] = buildSourceRows({ sources: [], records: [record(8, { type: 'link', url: 'https://x.y', content: '' })] })
    expect(bridgeInput(link)).toMatchObject({ id: 'rec_8', sourceType: 'external', kind: 'link', content: 'https://x.y', origin: 'https://x.y' })
    const [item] = buildSourceRows({ sources: [], captures: [capture('c9')] })
    expect(bridgeInput(item, '改過的內容')).toMatchObject({ id: 'cap_c9', content: '改過的內容' })
  })
})

describe('day buckets', () => {
  it('groups by 今天／昨天／本週／更早', () => {
    expect(dayBucket(NOW - H, NOW)).toBe('today')
    expect(dayBucket(NOW - 24 * H, NOW)).toBe('yesterday')
    expect(dayBucket(NOW - 4 * 24 * H, NOW)).toBe('week')
    expect(dayBucket(NOW - 30 * 24 * H, NOW)).toBe('earlier')
  })
})

describe('ALMNC-54.10 初步判斷', () => {
  const judgement = (sourceId: string, extra: Partial<SourceJudgement> = {}): SourceJudgement => ({ sourceId, status: 'ready', type: '研究報告', suggestion: '存成知識筆記', followSuggestion: false, createdAt: NOW, updatedAt: NOW, ...extra })

  it('only rows waiting for a decision carry the judgement line; capture failures are flagged', () => {
    const rows = buildSourceRows({
      sources: [source('w', 'awaiting_decision'), source('t', 'awaiting_decision'), source('f', 'awaiting_decision'), source('n', 'awaiting_decision'), source('p', 'pending_analysis')],
      judgements: new Map([
        ['w', judgement('w')],
        ['t', judgement('t', { suggestion: undefined })],
        ['f', judgement('f', { status: 'capture_failed', type: undefined, suggestion: undefined })],
        ['n', judgement('n', { status: 'unavailable', type: undefined, suggestion: undefined })],
        ['p', judgement('p')],
      ]),
    })
    const byId = Object.fromEntries(rows.map(row => [row.id, row]))
    expect(byId['src:w']).toMatchObject({ judgement: '研究報告｜存成知識筆記', suggestion: '存成知識筆記' })
    expect(byId['src:t']).toMatchObject({ judgement: '研究報告' })
    expect(byId['src:t'].suggestion).toBeUndefined()
    expect(byId['src:f']).toMatchObject({ captureFailed: true })
    expect(byId['src:n'].judgement).toBeUndefined() // AC#4：沒有判斷，列照樣出現
    expect(byId['src:n'].status).toBe('wait')
    expect(byId['src:p'].judgement).toBeUndefined()
  })
})

describe('sourceDisplayKind（ALMNC-57）', () => {
  it('Email、RSS、會議有自己的類型字，看得出是從哪個入口進來的；不認得的當檔案', () => {
    expect(sourceDisplayKind('email')).toBe('email')
    expect(sourceDisplayKind('rss')).toBe('rss')
    expect(sourceDisplayKind('meeting')).toBe('meeting')
    expect(sourceDisplayKind('link')).toBe('web')
    expect(sourceDisplayKind('legacy_note')).toBe('file')
  })
})

// Fork（almanac ALMNC-56.7，A06）
describe('restorePicks', () => {
  it('puts back what was picked before handing over, keeping picks made since', () => {
    expect([...restorePicks(new Set(), new Set(['a', 'b']))].sort()).toEqual(['a', 'b'])
    expect([...restorePicks(new Set(['c']), new Set(['a']))].sort()).toEqual(['a', 'c'])
    expect([...restorePicks(new Set(['a']), new Set(['a']))]).toEqual(['a'])
  })
})

describe('封存的不採用資料源（ALMNC-54.1 AC#6）', () => {
  it('封存的仍列在清單的「不採用」篩選裡，帶 archived 標記；沒封存的沒有標記', () => {
    const base = createSource({ id: 'a', sourceType: 'external', kind: 'text', content: '舊的想法', collector: 'scott' }, 1000)
    const archived: Source = { ...base, status: 'rejected', statusChangedAt: 1000, archivedAt: 5000 }
    const fresh: Source = { ...base, id: 'b', content: '剛不採用', status: 'rejected', statusChangedAt: 4000 }
    const rows = buildSourceRows({ sources: [archived, fresh] })
    expect(filterRows(rows, { status: 'rejected', journal: false }).map(row => row.sourceId).sort()).toEqual(['a', 'b'])
    expect(rows.find(row => row.sourceId === 'a')).toMatchObject({ status: 'no', archived: true })
    expect(rows.find(row => row.sourceId === 'b')?.archived).toBeUndefined()
  })
})

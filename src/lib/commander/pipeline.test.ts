import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSource, editSourceContent, submitSource, transitionSource, type Source, type SourceStatus } from '@/lib/v3-model/source'
import type { Domain } from '@/lib/v3-model/domain'
import { analyzeSource, createAnalysisQueue, requeueInterrupted, runAnalysisQueue } from './pipeline'
import type { AskModel, CommanderDeps, Converters, ProposalBatch, RosterAgent } from './types'

// 筆記庫與連結表：分析流程不應該碰到它們（寫入要等 Scott 接受）。
const vault = vi.hoisted(() => ({ writeNote: vi.fn(), addSourceOutput: vi.fn() }))
vi.mock('@/lib/daily/note-io', () => ({ writeNote: vault.writeNote, readNote: vi.fn(), noteExists: vi.fn(), revealInFileTree: vi.fn() }))
vi.mock('@/db/v3-sources', () => ({ addSourceOutput: vault.addSourceOutput }))

const T0 = Date.UTC(2026, 10, 21, 1)
const roster: RosterAgent[] = [
  { id: 'cmd', name: 'Mia', role: 'commander', enabled: true },
  { id: 'sec', name: 'Leo', role: 'secretary', enabled: true },
  { id: 'ie', name: 'Alex', role: 'expert', domain: '工業工程', enabled: true },
]
const domains: Domain[] = [{ id: 'd-ie', name: '工業工程', overview: '', createdAt: 0, updatedAt: 0 }]

function memorySources(initial: Source[]) {
  const rows = new Map(initial.map(source => [source.id, source]))
  const history: Array<[string, SourceStatus]> = []
  return {
    rows,
    history,
    store: {
      get: async (id: string) => rows.get(id),
      setStatus: async (id: string, to: SourceStatus) => {
        const next = transitionSource(rows.get(id)!, to, T0)
        rows.set(id, next)
        history.push([id, to])
        return next
      },
      list: async ({ status }: { status: SourceStatus }) => [...rows.values()].filter(source => source.status === status),
    },
  }
}

function src(id: string, partial: Partial<Parameters<typeof createSource>[0]> = {}, collectedAt = T0): Source {
  return createSource({ id, sourceType: 'self', kind: 'text', content: '內容', collector: 'scott', collectedAt, ...partial }, T0)
}

/** 假模型：拆分提示回傳 split；撰寫提示照片段 index 回傳草稿。 */
function fakeModel(split: unknown): AskModel & { calls: string[] } {
  const calls: string[] = []
  const ask = (async (prompt: string) => {
    calls.push(prompt)
    if (prompt.includes('--- 資料源 ---')) return typeof split === 'string' ? split : JSON.stringify(split)
    const indexes = [...prompt.matchAll(/### index (\d+)/g)].map(match => Number(match[1]))
    return JSON.stringify({ drafts: indexes.map(index => ({ index, title: `草稿 ${index}`, body: `整理過的內容 ${index}` })) })
  }) as AskModel & { calls: string[] }
  ask.calls = calls
  return ask
}

function deps(sources: ReturnType<typeof memorySources>, ask: AskModel, converters: Converters = {}) {
  const batches: ProposalBatch[] = []
  const activity: unknown[] = []
  const value: CommanderDeps = {
    sources: sources.store,
    converters,
    ask,
    roster: async () => roster,
    domains: async () => domains,
    agentPrompt: async (_agent, role) => `[${role}]`,
    submitProposals: async batch => { batches.push(batch) },
    logActivity: async entry => { activity.push(entry) },
    labels: { origin: ({ agent, source }) => `${agent}:${source}`, unconverted: ({ origin }) => `UNCONVERTED ${origin}` },
    now: () => new Date(T0),
  }
  return { deps: value, batches, activity }
}

const MEETING = { fragments: [
  { kind: 'event', title: '和 Amy 開會', date: '2026-11-25', time: '10:00', people: ['Amy'], project: '新官網' },
  { kind: 'task', title: '寄報價單', date: '2026-11-22' },
  { kind: 'note', noteType: 'knowledge', title: '產線平衡要先算節拍時間', body: '…', domainHint: '工業工程' },
  { kind: 'note', noteType: 'knowledge', title: '番茄鐘一次 25 分鐘', body: '…', domainHint: '時間管理' },
  { kind: 'note', noteType: 'record', title: '11/20 客戶拜訪', body: '…', date: '2026-11-20' },
  { kind: 'reject', title: '簽名檔', reason: '雜訊' },
] }

beforeEach(() => {
  vault.writeNote.mockClear()
  vault.addSourceOutput.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('analyzeSource', () => {
  it('ALMNC-54.10 照建議處理：初步判斷當成提示交給指揮官；讀不到提示照常分析', async () => {
    const sources = memorySources([src('s1', { sourceType: 'external', content: '會議紀錄…' }), src('s2', { content: '隨手記' })])
    sources.rows.set('s1', submitSource(sources.rows.get('s1')!, T0))
    const ask = fakeModel({ fragments: [{ kind: 'task', title: '寄報價單' }] })
    const { deps: d } = deps(sources, ask)
    d.sourceHint = async id => {
      if (id === 's2') throw new Error('db locked')
      return '會議紀錄｜存成紀錄筆記＋拆出任務'
    }
    await analyzeSource('s1', d)
    expect(ask.calls[0]).toContain('Scott 看過初步判斷「會議紀錄｜存成紀錄筆記＋拆出任務」，選了照建議處理')
    expect((await analyzeSource('s2', d)).status).toBe('analyzed')
    expect(ask.calls.filter(prompt => prompt.includes('--- 資料源 ---')).at(-1)).not.toContain('初步判斷')
  })

  it('happy path：自己寫的文字 → 分析中 → 提案送工作台 → 已分析', async () => {
    const sources = memorySources([src('s1', { content: '明天要寄報價單' })])
    const { deps: d, batches, activity } = deps(sources, fakeModel({ fragments: [{ kind: 'task', title: '寄報價單', date: '2026-11-22' }] }))
    const result = await analyzeSource('s1', d)
    expect(result.status).toBe('analyzed')
    expect(sources.history).toEqual([['s1', 'analyzing'], ['s1', 'analyzed']])
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({ id: 'commander:s1', origin: 'Mia:明天要寄報價單' })
    expect(batches[0].proposals[0]).toMatchObject({ kind: 'task', title: '草稿 0', due: '2026-11-22', sourceIds: ['s1'], drafter: { role: 'secretary' } })
    expect(activity).toEqual([expect.objectContaining({ sourceId: 's1', batchId: 'commander:s1', status: 'analyzed' })])
  })

  it('一則會議紀錄拆成多個片段，分給專家（C1）、指揮官（C2）、秘書（C3），不採用的只記錄', async () => {
    const sources = memorySources([src('s1', { kind: 'transcript', content: '會議逐字稿…' })])
    const { deps: d, batches } = deps(sources, fakeModel(MEETING))
    const result = await analyzeSource('s1', d, { conversationId: 42 })
    if (result.status !== 'analyzed') throw new Error(result.status)
    expect(result.assignments.map(a => a.lane)).toEqual(['C3', 'C3', 'C1', 'C2', 'C2', 'reject'])
    expect(result.rejected.map(f => f.title)).toEqual(['簽名檔'])
    const proposals = batches[0].proposals
    expect(proposals.map(p => [p.kind, p.drafter?.role, p.noteType])).toEqual([
      ['event', 'secretary', undefined],
      ['task', 'secretary', undefined],
      ['note', 'expert', 'knowledge'],
      ['note', 'commander', 'knowledge'],
      ['note', 'commander', 'record'],
    ])
    expect(proposals[0]).toMatchObject({ due: '2026-11-25', time: '10:00', people: ['Amy'], project: '新官網' })
    expect(proposals[2]).toMatchObject({ domains: ['d-ie'], drafter: { role: 'expert', agentId: 'ie' } })
    expect(proposals.every(p => p.conversationId === 42 && p.sourceIds?.[0] === 's1')).toBe(true)
    expect(batches[0].conversationId).toBe(42)
  })

  it('外部擷取的資料源（A5）還在等 Scott 決定：跳過，不轉文字、不呼叫模型、狀態不變', async () => {
    const external = src('e1', { sourceType: 'external', kind: 'image', content: '/tmp/shot.png' })
    const sources = memorySources([external])
    const ocrImage = vi.fn(async () => 'text')
    const ask = fakeModel(MEETING)
    const { deps: d, batches } = deps(sources, ask, { ocrImage })
    expect(await analyzeSource('e1', d)).toEqual({ status: 'skipped', sourceId: 'e1', reason: 'not_pending' })
    expect(ocrImage).not.toHaveBeenCalled()
    expect(ask.calls).toEqual([])
    expect(batches).toEqual([])
    expect(sources.rows.get('e1')?.status).toBe('awaiting_decision')
  })

  it('Scott 選「處理」之後（待分析）才轉文字：截圖辨識', async () => {
    const external = submitSource(src('e1', { sourceType: 'external', kind: 'image', content: '/tmp/shot.png' }), T0)
    const sources = memorySources([external])
    const ocrImage = vi.fn(async () => '白板上寫著：週五交報告')
    const ask = fakeModel({ fragments: [{ kind: 'task', title: '交報告' }] })
    const { deps: d } = deps(sources, ask, { ocrImage })
    const result = await analyzeSource('e1', d)
    expect(ocrImage).toHaveBeenCalledWith('/tmp/shot.png')
    if (result.status !== 'analyzed') throw new Error(result.status)
    expect(result.conversion).toMatchObject({ converter: 'ocr', status: 'converted' })
    expect(ask.calls[0]).toContain('白板上寫著：週五交報告')
  })

  it('轉換器沒設定：保留原檔、標記 unavailable，照樣分析成一則保底提案', async () => {
    const sources = memorySources([src('s1', { kind: 'image', content: 'data:image/png;base64,AAAA', origin: 'shot.png' })])
    const ask = fakeModel('ignored')
    const { deps: d, batches } = deps(sources, ask)
    const result = await analyzeSource('s1', d)
    if (result.status !== 'analyzed') throw new Error(result.status)
    expect(result.conversion).toMatchObject({ converter: 'ocr', status: 'unavailable', text: 'shot.png' })
    expect(batches[0].proposals).toHaveLength(1)
  })

  it('完全轉不出文字時用說明文字當內文，不把空白送給模型', async () => {
    const sources = memorySources([src('s1', { kind: 'voice', content: 'data:audio/webm;base64,AAAA' })])
    const ask = fakeModel('ignored')
    const { deps: d, batches } = deps(sources, ask)
    const result = await analyzeSource('s1', d)
    expect(result.status).toBe('analyzed')
    expect(ask.calls.some(prompt => prompt.includes('--- 資料源 ---'))).toBe(false)
    expect(batches[0].proposals[0].body).toContain('UNCONVERTED')
  })

  it('模型回傳壞掉的 JSON：一個保底片段，原文整則保留', async () => {
    const text = '第一行\n第二行很重要'
    const sources = memorySources([src('s1', { content: text })])
    const ask: AskModel = async prompt => (prompt.includes('--- 資料源 ---') ? '我不會 JSON' : 'still not json')
    const { deps: d, batches } = deps(sources, ask)
    const result = await analyzeSource('s1', d)
    if (result.status !== 'analyzed') throw new Error(result.status)
    expect(result.fragments).toHaveLength(1)
    expect(result.fragments[0].fallback).toBe(true)
    expect(batches[0].proposals[0]).toMatchObject({ kind: 'note', noteType: 'record', body: text, drafter: { role: 'commander' } })
  })

  it('全部不採用 → 資料源標成不採用，不送提案', async () => {
    const sources = memorySources([src('s1', { content: '廣告信' })])
    const { deps: d, batches, activity } = deps(sources, fakeModel({ fragments: [{ kind: 'reject', title: '廣告', reason: '廣告' }] }))
    const result = await analyzeSource('s1', d)
    expect(result.status).toBe('rejected')
    expect(sources.rows.get('s1')?.status).toBe('rejected')
    expect(batches).toEqual([])
    expect(activity).toEqual([expect.objectContaining({ status: 'rejected', batchId: undefined })])
  })

  it('草稿從不寫進筆記庫，也不在接受前建立 source_outputs 連結', async () => {
    const sources = memorySources([src('s1', { kind: 'transcript', content: '會議逐字稿…' })])
    const { deps: d } = deps(sources, fakeModel(MEETING))
    await analyzeSource('s1', d)
    expect(vault.writeNote).not.toHaveBeenCalled()
    expect(vault.addSourceOutput).not.toHaveBeenCalled()
  })

  it('中途出錯退回待分析，等下一輪重試', async () => {
    const sources = memorySources([src('s1')])
    const { deps: d } = deps(sources, fakeModel(MEETING))
    d.submitProposals = async () => { throw new Error('store unavailable') }
    await expect(analyzeSource('s1', d)).rejects.toThrow('store unavailable')
    expect(sources.rows.get('s1')?.status).toBe('pending_analysis')
  })

  it('改過的新版本：把上一版交給模型，只分析差異', async () => {
    const first = transitionSource(transitionSource(src('v1', { content: '舊內容' }), 'analyzing', T0), 'analyzed', T0)
    const edit = editSourceContent(first, '舊內容\n新增一行', T0, 'v2')
    if (edit.kind !== 'versioned') throw new Error(edit.kind)
    const sources = memorySources([first, edit.source])
    const ask = fakeModel({ fragments: [{ kind: 'task', title: '新增一行' }] })
    const { deps: d } = deps(sources, ask)
    await analyzeSource('v2', d)
    expect(ask.calls[0]).toContain('--- 上一版 ---\n舊內容')
  })

  it('找不到資料源就跳過', async () => {
    const { deps: d } = deps(memorySources([]), fakeModel(MEETING))
    expect(await analyzeSource('nope', d)).toEqual({ status: 'skipped', sourceId: 'nope', reason: 'not_found' })
  })
})

describe('佇列', () => {
  it('只分析待分析的（R2：自己寫的、系統產生的一進來就是），由舊到新；某一則失敗不影響其他的', async () => {
    const sources = memorySources([
      src('new', {}, T0 + 2),
      src('old', { sourceType: 'system' }, T0),
      src('ext', { sourceType: 'external' }, T0 - 5),
      src('bad', {}, T0 + 1),
    ])
    const order: string[] = []
    const { deps: d } = deps(sources, fakeModel({ fragments: [{ kind: 'task', title: 'x' }] }))
    const submit = d.submitProposals
    d.submitProposals = async batch => {
      order.push(batch.id)
      if (batch.id === 'commander:bad') throw new Error('boom')
      await submit(batch)
    }
    const summary = await runAnalysisQueue(d)
    expect(order).toEqual(['commander:old', 'commander:bad', 'commander:new'])
    expect(summary.analyzed).toEqual(['old', 'new'])
    expect(summary.failed).toEqual([{ sourceId: 'bad', error: 'boom' }])
    expect(sources.rows.get('ext')?.status).toBe('awaiting_decision')
    expect(sources.rows.get('bad')?.status).toBe('pending_analysis')
  })

  it('上次中斷卡在分析中的退回待分析', async () => {
    const stuck = transitionSource(src('s1'), 'analyzing', T0)
    const sources = memorySources([stuck])
    expect(await requeueInterrupted({ sources: sources.store })).toEqual(['s1'])
    expect(sources.rows.get('s1')?.status).toBe('pending_analysis')
  })

  it('createAnalysisQueue：跑的時候又被叫就跑完再補一輪，不會同時跑兩輪', async () => {
    const sources = memorySources([transitionSource(src('stuck'), 'analyzing', T0), src('a')])
    const { deps: d, batches } = deps(sources, fakeModel({ fragments: [{ kind: 'task', title: 'x' }] }))
    const queue = createAnalysisQueue(d)
    const first = queue.kick()
    expect(queue.running).toBe(true)
    sources.rows.set('b', src('b', {}, T0 + 1))
    const second = queue.kick()
    expect(second).toBe(first)
    const summary = await first
    expect(summary.analyzed.sort()).toEqual(['a', 'b', 'stuck'])
    expect(batches.map(b => b.id).sort()).toEqual(['commander:a', 'commander:b', 'commander:stuck'])
    expect(queue.running).toBe(false)
  })
})

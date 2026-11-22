// almanac ALMNC-47：已送狀態只在真的送出後更新（commitSent），組裝與 buildBriefing 從不更新；
// 送出後同一天重算仍是同一份，隔天才換下一批。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markPinsSent } from '@/lib/eink/pins'
import { markReadLaterSent } from '@/lib/eink/read-later'
import { assembleBriefing, type BriefingInputs } from './assemble'
import { commitSent, type CommitDeps } from './commit'
import { buildBriefing, loadBriefingInputs, type BriefingSources } from './index'
import { applyBriefingSent, normalizeBriefingLog, type BriefingLog } from './state'
import { DAY, TEXTS, at, fullInputs, pinSnap } from './__fixtures__/inputs'

vi.mock('./commit', async importOriginal => {
  const actual = await importOriginal<typeof import('./commit')>()
  return { ...actual, commitSent: vi.fn(actual.commitSent) }
})

/** 用 fullInputs 當各來源的回傳值；每個來源都是 spy。 */
function fakeSources(inputs: BriefingInputs = fullInputs()) {
  return {
    settings: vi.fn(async () => ({ sections: inputs.settings.sections, weatherCity: '臺北' })),
    privateItems: vi.fn(async () => inputs.privateItems),
    schedule: vi.fn(async () => inputs.schedule),
    weather: vi.fn(async () => inputs.weather),
    pins: vi.fn(async () => inputs.pins),
    readLater: vi.fn(async () => inputs.readLater),
    report: vi.fn(async () => inputs.report),
    workbench: vi.fn(async () => inputs.workbench),
    log: vi.fn(async () => inputs.log),
  } satisfies BriefingSources
}

/** 把 commitSent 寫回的結果套到下一次組裝的輸入（模擬 store 更新）。 */
function memoryDeps(inputs: BriefingInputs): CommitDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    markArticlesSent: async (urls, when) => {
      calls.push(`articles:${urls.length}`)
      if (inputs.readLater.status === 'ok') inputs.readLater.data = markReadLaterSent(inputs.readLater.data, urls, when)
    },
    markPinsSent: async (paths, when) => {
      calls.push(`pins:${paths.length}`)
      if (inputs.pins.status === 'ok') {
        const pins = markPinsSent(inputs.pins.data.map(item => item.pin), paths, when)
        inputs.pins.data = inputs.pins.data.map((item, index) => ({ ...item, pin: pins[index] }))
      }
    },
    readLog: async () => inputs.log,
    writeLog: async log => {
      calls.push('log')
      inputs.log = log
    },
  }
}

beforeEach(() => { vi.mocked(commitSent).mockClear() })

describe('buildBriefing（讀來源 → 組裝）', () => {
  it('組兩次結果相同，而且不呼叫 commitSent', async () => {
    const sources = fakeSources()
    const first = await buildBriefing(DAY, sources, TEXTS)
    expect(await buildBriefing(DAY, sources, TEXTS)).toEqual(first)
    expect(first).toEqual(assembleBriefing(DAY, fullInputs(), TEXTS))
    expect(commitSent).not.toHaveBeenCalled()
  })

  it('沒勾的章節不讀它的來源（例如不抓天氣）', async () => {
    const inputs = { ...fullInputs(), settings: { sections: ['pinned' as const] } }
    const sources = fakeSources(inputs)
    await loadBriefingInputs(DAY, sources)
    expect(sources.pins).toHaveBeenCalled()
    for (const skipped of [sources.schedule, sources.weather, sources.readLater, sources.report, sources.workbench]) expect(skipped).not.toHaveBeenCalled()
  })

  it('某個來源丟錯只影響那一章', async () => {
    const sources = fakeSources()
    sources.weather.mockRejectedValueOnce(new Error('boom'))
    sources.report.mockRejectedValueOnce(new Error('boom'))
    const briefing = await buildBriefing(DAY, sources, TEXTS)
    expect(briefing.chapters.find(item => item.kind === 'weather')).toMatchObject({ status: 'unavailable', note: '天氣暫無資料' })
    expect(briefing.omitted).toEqual([{ kind: 'report', reason: 'unavailable' }])
    expect(briefing.chapters).toHaveLength(6)
  })
})

describe('commitSent', () => {
  it('依 sent 清單更新文章、釘選、回顧卡與知識報告', async () => {
    const briefing = assembleBriefing(DAY, fullInputs(), TEXTS)
    const deps = { markArticlesSent: vi.fn(async () => {}), markPinsSent: vi.fn(async () => {}), readLog: vi.fn(async (): Promise<BriefingLog> => ({ reviewShown: {} })), writeLog: vi.fn(async () => {}) }
    const when = at(21, 7)
    await commitSent(briefing, when, deps)
    expect(deps.markArticlesSent).toHaveBeenCalledWith(['https://ex.com/2', 'https://ex.com/3', 'https://ex.com/4'], when)
    expect(deps.markPinsSent).toHaveBeenCalledWith(['新.md', '舊.md'], when)
    expect(deps.writeLog).toHaveBeenCalledWith({ reviewShown: { '舊.md': when }, report: { period: '2026-W47', sentAt: when } })
  })

  it('送出後同一天重算（一天下載很多次）結果不變；重複送出也不變', async () => {
    const inputs = fullInputs()
    const deps = memoryDeps(inputs)
    const before = assembleBriefing(DAY, inputs, TEXTS)
    await commitSent(before, at(21, 7), deps)
    const after = assembleBriefing(DAY, inputs, TEXTS)
    expect(after).toEqual(before)
    await commitSent(after, at(21, 12), deps)
    expect(assembleBriefing(DAY, inputs, TEXTS)).toEqual(before)
  })

  it('隔天：文章換下一批、昨天第一次送的釘選改列標題、回顧卡輪到別張、知識報告不再放', async () => {
    const inputs = fullInputs()
    if (inputs.pins.status === 'ok') inputs.pins.data.push(pinSnap('更舊.md', 3, { firstSentAt: at(2), lastSentAt: at(2) }))
    const deps = memoryDeps(inputs)
    const today = assembleBriefing(DAY, inputs, TEXTS)
    await commitSent(today, at(21, 7), deps)

    const tomorrow = assembleBriefing(new Date(2026, 10, 22, 6), inputs, TEXTS)
    const articles = tomorrow.chapters.find(item => item.kind === 'articles')
    expect(articles && 'items' in articles && articles.items.map(item => 'url' in item && item.url)).toEqual(['https://ex.com/5'])
    const pinned = tomorrow.chapters.find(item => item.kind === 'pinned')
    expect(pinned && pinned.kind === 'pinned' && pinned.items.map(item => [item.path, item.mode])).toEqual([
      ['新.md', 'title'], ['舊.md', 'title'], ['不見了.md', 'missing'], ['更舊.md', 'title'],
    ])
    // 今天抽過 舊.md、更舊.md、新.md 還沒出現過 → 明天 新.md（沒出現過）先抽
    expect(today.sent.reviewPaths).toEqual(['更舊.md', '舊.md'])
    expect(tomorrow.sent.reviewPaths[0]).toBe('新.md')
    expect(tomorrow.omitted).toContainEqual({ kind: 'report', reason: 'not-new' })
  })

  it('沒有回顧卡與知識報告時不寫紀錄', async () => {
    const deps = memoryDeps(fullInputs())
    await commitSent({ date: '2026-11-21', chapters: [], appendix: [], omitted: [], sent: { articleUrls: [], pinPaths: [], reviewPaths: [] } }, 1, deps)
    expect(deps.calls).toEqual(['articles:0', 'pins:0'])
  })
})

describe('einkBriefingLog', () => {
  it('讀回時丟掉壞資料', () => {
    expect(normalizeBriefingLog({ reviewShown: { 'a.md': 1, 'b.md': 'x', '': 2 }, report: { period: 'W1' } })).toEqual({ reviewShown: { 'a.md': 1 } })
    expect(normalizeBriefingLog(null)).toEqual({ reviewShown: {} })
  })

  it('記錄回顧卡出現時間與知識報告期別；沒送報告時保留舊紀錄', () => {
    const log = applyBriefingSent({ reviewShown: { 'a.md': 1 }, report: { period: 'W1', sentAt: 1 } }, { reviewPaths: ['b.md'] }, 5)
    expect(log).toEqual({ reviewShown: { 'a.md': 1, 'b.md': 5 }, report: { period: 'W1', sentAt: 1 } })
  })
})

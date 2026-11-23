// Fork（almanac ALMNC-54.14）：舊筆記遷移（R3）——選哪些筆記、標記不重複、分批交給指揮官（暫停／繼續／進度／重開 App 接續）、
// 判斷不出來的合成一包、一次只出現一包；一般佇列不碰舊筆記。
import { describe, expect, it, vi } from 'vitest'
import { createLegacyNoteSource, createSource, isLegacyNote, legacySourceId, transitionSource, type Source, type SourceStatus } from '@/lib/v3-model/source'
import { createAnalysisQueue } from '@/lib/commander/pipeline'
import { toText } from '@/lib/commander/to-text'
import type { AskModel, CommanderDeps, ProposalBatch } from '@/lib/commander/types'
import {
  createLegacyMigration, currentPack, isDailyNote, isUndecided, legacyPackKey, legacyProgress, markLegacyNotes, nextBatch, packsToShow, unmarkedPaths,
  runLegacyBatch, selectLegacyNotes, unmarkedLegacyNotes, type LegacyPack, type LegacyPackItem,
} from './legacy'

// 分析流程不應該寫筆記庫（寫入要等 Scott 接受）；舊筆記標記也不讀、不改檔。
const vault = vi.hoisted(() => ({ writeNote: vi.fn(), readNote: vi.fn(), addSourceOutput: vi.fn() }))
vi.mock('@/lib/daily/note-io', () => ({ writeNote: vault.writeNote, readNote: vault.readNote, noteExists: vi.fn(), revealInFileTree: vi.fn() }))
vi.mock('@/db/v3-sources', () => ({ addSourceOutput: vault.addSourceOutput }))

const T0 = Date.UTC(2026, 10, 21, 1)
const DAILY = { dailyFolder: '20 Journal/21 Daily', dailyPattern: 'YYYYMMDD' }

function note(path: string, frontmatter: Record<string, unknown> | null = null, mtime = T0) {
  return { path, frontmatter, mtime }
}

// ── 選 ──

describe('selectLegacyNotes', () => {
  it('只選還沒變成 V3 的 Markdown 筆記；每日筆記、V3 筆記、隱藏檔、非 Markdown 都跳過並計數', () => {
    const result = selectLegacyNotes([
      note('30 Notes/OEE 的定義.md'),
      note('30 Notes/有 frontmatter 但不是 V3.md', { tags: ['a'], type: 'meeting' }),
      note('30 Notes/知識.md', { type: 'knowledge' }),
      note('30 Notes/專案.md', { type: 'Project' }),
      note('20 Journal/21 Daily/20261120.md'),
      note('20 Journal/21 Daily/週記.md'),
      note('.obsidian/workspace.md'),
      note('assets/圖.png'),
      note('10 Inbox/隨手記.md'),
    ], DAILY)
    expect(result.paths).toEqual(['10 Inbox/隨手記.md', '20 Journal/21 Daily/週記.md', '30 Notes/OEE 的定義.md', '30 Notes/有 frontmatter 但不是 V3.md'])
    expect(result.skipped).toEqual({ v3: 2, daily: 1, hidden: 1, nonMarkdown: 1 })
  })

  it('日誌筆記的新類型值 log 也算 V3 筆記，不會被當成舊筆記（ALMNC-69.4）', () => {
    expect(selectLegacyNotes([note('30 日誌/週會.md', { type: 'log' })], DAILY).skipped.v3).toBe(1)
  })

  it('遷移成 S 編號的舊筆記資料源，以舊 id（legacyId）認出已標過（ALMNC-69.4）', () => {
    expect(unmarkedPaths(['a.md', 'b.md'], [{ id: 'S-20261101-000000-AAAA', legacyId: legacySourceId('a.md') }])).toEqual(['b.md'])
  })

  it('每日筆記資料夾留空時，根目錄裡符合日期格式的檔案才算每日筆記', () => {
    expect(isDailyNote('20261120.md', { dailyFolder: '', dailyPattern: 'YYYYMMDD' })).toBe(true)
    expect(isDailyNote('notes/20261120.md', { dailyFolder: '', dailyPattern: 'YYYYMMDD' })).toBe(false)
    expect(isDailyNote('隨手記.md', { dailyFolder: '', dailyPattern: 'YYYYMMDD' })).toBe(false)
  })
})

// ── 標 ──

function memoryDb() {
  const rows = new Map<string, Source>()
  return {
    rows,
    deps: {
      list: async () => [...rows.values()],
      // 和 insert … on conflict(id) do nothing 一樣：已經有的 id 跳過。
      insert: vi.fn(async (sources: readonly Source[]) => {
        let added = 0
        for (const source of sources) {
          if (rows.has(source.id)) continue
          rows.set(source.id, source)
          added++
        }
        return added
      }),
    },
  }
}

describe('markLegacyNotes', () => {
  it('每則舊筆記標成一則資料源：自己寫的、等你決定、內容只存路徑、收集時間是檔案修改時間；不讀也不改筆記檔', async () => {
    const db = memoryDb()
    const result = await markLegacyNotes([{ path: 'a.md', mtime: T0 - 1000 }, { path: 'b.md', mtime: 0 }], db.deps, T0)
    expect(result).toEqual({ added: 2, existing: 0 })
    const a = db.rows.get(legacySourceId('a.md'))!
    expect(a).toMatchObject({ sourceType: 'self', status: 'awaiting_decision', content: 'a.md', origin: 'a.md', collectedAt: T0 - 1000, lockedAt: undefined })
    expect(isLegacyNote(a)).toBe(true)
    expect(db.rows.get(legacySourceId('b.md'))!.collectedAt).toBe(T0)
    expect(vault.readNote).not.toHaveBeenCalled()
    expect(vault.writeNote).not.toHaveBeenCalled()
  })

  it('重跑不重複；後來才出現的舊筆記會補上；已分析完的不再標', async () => {
    const db = memoryDb()
    await markLegacyNotes([{ path: 'a.md' }, { path: 'b.md' }], db.deps, T0)
    const analyzed = transitionSource(transitionSource(db.rows.get(legacySourceId('a.md'))!, 'pending_analysis', T0), 'analyzing', T0)
    db.rows.set(analyzed.id, transitionSource(analyzed, 'analyzed', T0))

    const again = await markLegacyNotes([{ path: 'a.md' }, { path: 'b.md' }, { path: 'c.md' }], db.deps, T0 + 1)
    expect(again).toEqual({ added: 1, existing: 2 })
    expect(db.rows.size).toBe(3)
    expect(db.rows.get(legacySourceId('a.md'))!.status).toBe('analyzed')
    expect(db.deps.insert).toHaveBeenLastCalledWith([expect.objectContaining({ id: legacySourceId('c.md') })])

    await markLegacyNotes([{ path: 'a.md' }, { path: 'b.md' }, { path: 'c.md' }], db.deps, T0 + 2)
    expect(db.deps.insert).toHaveBeenCalledTimes(2)
  })

  it('unmarkedLegacyNotes：筆記庫裡還沒標的舊筆記，帶修改時間', () => {
    const notes = [note('a.md', null, 11), note('b.md', null, 22), note('k.md', { type: 'knowledge' }), note('20 Journal/21 Daily/20261120.md')]
    expect(unmarkedLegacyNotes(notes, DAILY, new Set([legacySourceId('a.md')]))).toEqual([{ path: 'b.md', mtime: 22 }])
  })
})

// ── 分批交給指揮官 ──

function legacy(path: string, collectedAt = T0): Source {
  return createLegacyNoteSource({ path, mtime: collectedAt }, T0)
}

function memorySources(initial: Source[]) {
  const rows = new Map(initial.map(source => [source.id, source]))
  return {
    rows,
    store: {
      get: async (id: string) => rows.get(id),
      setStatus: async (id: string, to: SourceStatus) => {
        const next = transitionSource(rows.get(id)!, to, T0)
        rows.set(id, next)
        return next
      },
      list: async ({ status }: { status: SourceStatus }) => [...rows.values()].filter(source => source.status === status),
    },
  }
}

const GOOD = JSON.stringify({ fragments: [{ kind: 'note', noteType: 'knowledge', title: '節拍時間', body: '產線平衡先算節拍時間', domainHint: '工業工程' }] })

/** 假模型：檔名含「亂」的筆記回壞掉的 JSON（判斷不出來），含「丟」的全部不採用，其餘拆成一則知識筆記。 */
function model(onSplit?: (prompt: string) => void): AskModel {
  return async prompt => {
    if (prompt.includes('--- 資料源 ---')) {
      onSplit?.(prompt)
      if (prompt.includes('BROKEN')) return 'not json'
      if (prompt.includes('NOISE')) return JSON.stringify({ fragments: [{ kind: 'reject', title: '廣告', reason: '雜訊' }] })
      return GOOD
    }
    const indexes = [...prompt.matchAll(/### index (\d+)/g)].map(match => Number(match[1]))
    return JSON.stringify({ drafts: indexes.map(index => ({ index, title: `草稿 ${index}`, body: '整理過的內容' })) })
  }
}

/** 筆記內容：檔名含「亂」→ BROKEN，含「丟」→ NOISE，含「無」→ 讀不到檔。 */
const readVaultNote = async (path: string) => {
  if (path.includes('無')) throw new Error('note not found')
  return path.includes('亂') ? `BROKEN ${path}` : path.includes('丟') ? `NOISE ${path}` : `# ${path}\n內容`
}

function setup(paths: string[], options: { ask?: AskModel, submit?: (batch: ProposalBatch) => Promise<void> } = {}) {
  const sources = memorySources(paths.map((path, index) => legacy(path, T0 + index)))
  const batches: ProposalBatch[] = []
  const packs: Array<{ batchId: string, items: readonly LegacyPackItem[] }> = []
  let n = 0
  const commander: CommanderDeps = {
    sources: sources.store,
    converters: { readVaultNote },
    ask: options.ask ?? model(),
    roster: async () => [{ id: 'cmd', name: 'Mia', role: 'commander', enabled: true }],
    domains: async () => [],
    agentPrompt: async (_agent, role) => `[${role}]`,
    submitProposals: options.submit ?? (async batch => { batches.push(batch) }),
    labels: { origin: ({ agent, source }) => `${agent}:${source}`, unconverted: ({ origin }) => `UNCONVERTED ${origin}` },
    now: () => new Date(T0),
  }
  return {
    sources,
    batches,
    packs,
    deps: {
      commander,
      list: async () => [...sources.rows.values()],
      addPack: async (batchId: string, items: readonly LegacyPackItem[]) => { packs.push({ batchId, items }) },
      newBatchId: () => `b${++n}`,
    },
  }
}

describe('toText：舊筆記資料源', () => {
  it('分析時才讀筆記庫裡的檔案（內容只存路徑）', async () => {
    const result = await toText(legacy('30 Notes/OEE.md'), { readVaultNote })
    expect(result).toMatchObject({ converter: 'file', status: 'converted', text: '# 30 Notes/OEE.md\n內容' })
  })
})

describe('isUndecided', () => {
  it('讀不到檔、或只剩保底片段才算判斷不出來；全部不採用是明確的結論', async () => {
    const env = setup(['好.md', '亂.md', '丟.md', '無.md'])
    const outcome = await runLegacyBatch(env.deps, { batchSize: 10 })
    expect(outcome.done.sort()).toEqual(['好.md', '亂.md', '丟.md', '無.md'].map(legacySourceId).sort())
    expect(outcome.undecided.sort()).toEqual([legacySourceId('亂.md'), legacySourceId('無.md')].sort())
    expect(isUndecided({ status: 'skipped', sourceId: 'x', reason: 'not_found' })).toBe(false)
  })
})

describe('runLegacyBatch', () => {
  it('一批 N 則：等你決定 → 待分析 → 交給指揮官；判斷得出來的送提案，判斷不出來的不送、整批合成一包', async () => {
    const env = setup(['a.md', 'b 亂.md', 'c.md', 'd 亂.md', 'e.md'])
    const outcome = await runLegacyBatch(env.deps, { batchSize: 4 })
    expect(outcome.batchId).toBe('b1')
    expect(outcome.done).toHaveLength(4)
    // 舊的在前：第 5 則（e.md）留到下一批。
    expect(env.sources.rows.get(legacySourceId('e.md'))!.status).toBe('awaiting_decision')
    expect(env.batches.map(batch => batch.origin)).toEqual(['Mia:a.md', 'Mia:c.md'])
    // 只有一包，裡面是這一批判斷不出來的兩則。
    expect(env.packs).toEqual([{ batchId: 'b1', items: [{ sourceId: legacySourceId('b 亂.md'), path: 'b 亂.md' }, { sourceId: legacySourceId('d 亂.md'), path: 'd 亂.md' }] }])
    expect(legacyProgress([...env.sources.rows.values()])).toEqual({ total: 5, processed: 4, remaining: 1 })
  })

  it('沒有判斷不出來的就不建包', async () => {
    const env = setup(['a.md', 'b.md'])
    await runLegacyBatch(env.deps, { batchSize: 20 })
    expect(env.packs).toEqual([])
  })

  it('提案送不出去時內容不會掉：放進包裡', async () => {
    const env = setup(['a.md'], { submit: async () => { throw new Error('store down') } })
    const outcome = await runLegacyBatch(env.deps)
    expect(outcome.undecided).toEqual([legacySourceId('a.md')])
    expect(env.packs[0]!.items).toEqual([{ sourceId: legacySourceId('a.md'), path: 'a.md' }])
  })

  it('nextBatch：先接中斷或失敗退回的（待分析），再拿等你決定的，各自舊的在前', () => {
    const a = legacy('a.md', 3)
    const b = transitionSource(legacy('b.md', 5), 'pending_analysis', T0)
    const c = legacy('c.md', 1)
    expect(nextBatch([a, b, c], 2).map(source => source.content)).toEqual(['b.md', 'c.md'])
    expect(nextBatch([a, b, c], 5, new Set([b.id])).map(source => source.content)).toEqual(['c.md', 'a.md'])
  })
})

describe('createLegacyMigration：按一次就分批處理', () => {
  it('一直跑到做完；每批做完回報進度；判斷不出來的一批一包', async () => {
    const paths = Array.from({ length: 7 }, (_, index) => (index === 1 || index === 5 ? `n${index} 亂.md` : `n${index}.md`))
    const env = setup(paths)
    const progress: number[] = []
    const migration = createLegacyMigration(env.deps, {
      batchSize: 3,
      onProgress: () => { progress.push(legacyProgress([...env.sources.rows.values()]).processed) },
    })
    const summary = await migration.start()
    expect(summary).toEqual({ reason: 'finished', done: 7, undecided: 2, failed: 0, packs: 2 })
    expect(progress).toEqual([3, 6, 7])
    expect(env.packs.map(pack => pack.items.map(item => item.path))).toEqual([['n1 亂.md'], ['n5 亂.md']])
    expect(migration.running).toBe(false)
  })

  it('暫停：這一則做完就停，進度留在資料源狀態裡；再按一次從還沒處理的接著做', async () => {
    const env = setup(['a.md', 'b.md', 'c.md', 'd.md', 'e.md'])
    let splits = 0
    const migration = createLegacyMigration(env.deps, { batchSize: 20 })
    env.deps.commander.ask = model(() => {
      splits++
      if (splits === 2) migration.pause()
    })
    const first = migration.start()
    expect(migration.running).toBe(true)
    const paused = await first
    expect(paused.reason).toBe('paused')
    expect(paused.done).toBe(2)
    expect(legacyProgress([...env.sources.rows.values()])).toEqual({ total: 5, processed: 2, remaining: 3 })

    const resumed = await migration.start()
    expect(resumed).toMatchObject({ reason: 'finished', done: 3 })
    expect(legacyProgress([...env.sources.rows.values()])).toEqual({ total: 5, processed: 5, remaining: 0 })
  })

  it('重開 App：上次卡在分析中的舊筆記退回待分析，先接著做', async () => {
    const env = setup(['a.md', 'b.md'])
    const stuck = transitionSource(transitionSource(env.sources.rows.get(legacySourceId('b.md'))!, 'pending_analysis', T0), 'analyzing', T0)
    env.sources.rows.set(stuck.id, stuck)
    const order: string[] = []
    env.deps.commander.ask = model(prompt => order.push(prompt.includes('b.md') ? 'b' : 'a'))
    // 新的控制器＝重開後的第一次 start。
    const summary = await createLegacyMigration(env.deps, { batchSize: 20 }).start()
    expect(summary).toMatchObject({ reason: 'finished', done: 2 })
    expect(order).toEqual(['b', 'a'])
  })

  it('整批都失敗就停（不無限重試），失敗的留在待分析等下次', async () => {
    const env = setup(['a.md', 'b.md'])
    env.deps.commander.roster = async () => { throw new Error('db down') }
    const summary = await createLegacyMigration(env.deps, { batchSize: 20 }).start()
    expect(summary).toMatchObject({ reason: 'all_failed', failed: 2, done: 0 })
    expect([...env.sources.rows.values()].map(source => source.status)).toEqual(['pending_analysis', 'pending_analysis'])
  })

  it('整批都判斷不出來（多半是模型沒設定）就先停，不把剩下的全倒進包裡', async () => {
    const env = setup(['a 亂.md', 'b 亂.md', 'c 亂.md', 'd.md', 'e.md'])
    const summary = await createLegacyMigration(env.deps, { batchSize: 3 }).start()
    expect(summary).toMatchObject({ reason: 'all_undecided', done: 3, undecided: 3, packs: 1 })
    expect(env.sources.rows.get(legacySourceId('d.md'))!.status).toBe('awaiting_decision')
  })
})

describe('一般佇列不碰舊筆記', () => {
  it('R2 的分析佇列跳過待分析的舊筆記，也不把分析中的舊筆記退回', async () => {
    const env = setup(['a.md'])
    const self = createSource({ id: 'self1', sourceType: 'self', kind: 'text', content: '隨手記', collector: 'scott' }, T0)
    env.sources.rows.set(self.id, self)
    const pendingLegacy = transitionSource(env.sources.rows.get(legacySourceId('a.md'))!, 'pending_analysis', T0)
    env.sources.rows.set(pendingLegacy.id, pendingLegacy)
    const summary = await createAnalysisQueue(env.deps.commander).kick()
    expect(summary.analyzed).toEqual(['self1'])
    expect(env.sources.rows.get(pendingLegacy.id)!.status).toBe('pending_analysis')

    const analyzing = transitionSource(pendingLegacy, 'analyzing', T0)
    env.sources.rows.set(analyzing.id, analyzing)
    await createAnalysisQueue(env.deps.commander).kick()
    expect(env.sources.rows.get(analyzing.id)!.status).toBe('analyzing')
  })
})

describe('一次一包', () => {
  const packs: LegacyPack[] = [
    { id: 'p1', createdAt: 1, items: [{ sourceId: 's1', path: 'a.md' }] },
    { id: 'p2', createdAt: 2, items: [{ sourceId: 's2', path: 'b.md' }, { sourceId: 's3', path: 'c.md' }] },
    { id: 'p3', createdAt: 3, items: [{ sourceId: 's4', path: 'd.md' }] },
  ]

  it('清單上只出現最舊的那一包；先放著的那包跳過，換下一包', () => {
    expect(currentPack(packs)?.id).toBe('p1')
    expect(currentPack(packs, key => key === legacyPackKey('p1'))?.id).toBe('p2')
    expect(currentPack([])).toBeUndefined()
  })

  it('要做成卡片的包＝目前那一包＋先放著的（列在「先放著」）', () => {
    expect(packsToShow(packs).map(pack => pack.id)).toEqual(['p1'])
    expect(packsToShow(packs, key => key === legacyPackKey('p1')).map(pack => pack.id)).toEqual(['p1', 'p2'])
  })
})

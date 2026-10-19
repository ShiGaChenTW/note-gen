import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { findUnlinkedMentions } from '@/lib/markdown/unlinked-mentions'
import { resolveWikilinkTarget } from '@/lib/markdown/wikilink'
import { rankWikilinkSuggestions, type WikilinkSuggestNote } from '@/lib/wikilink-suggest-model'
import { indexReadConcurrency, listStatConcurrency, planScan, restoreIndexCache, scheduleVaultIndexSave, serializeIndexCache } from '@/lib/vault-index/index-core'
import { indexNote, type IndexedNote } from '@/lib/vault-index/index-note'
import { buildLocalGraph } from '@/lib/vault-index/graph'
import {
  buildLinkLookup,
  buildVaultLinkIndex,
  collectBacklinks,
  collectOutgoingLinks,
  resolveIndexedLink,
  resolveIndexedLinkWithLookup,
  resolveWikilinkTargetWithLookup,
} from '@/lib/vault-index/links'
import { buildTagTree } from '@/lib/vault-index/tags'
import useVaultIndexStore, { selectBacklinks, selectOutgoingLinks } from '@/stores/vault-index'
import { makeSyntheticVault, SYNTHETIC_FOLDERS, type SyntheticNote } from './synthetic-vault'

/** 規格預算乘 3，吸收 CI 抖動。10,000 篇再乘規格的 4 倍。 */
const LOOSE = 3
const BUDGET = {
  indexNote: 1500,
  cache: 300,
  cacheBytes: 15 * 1024 * 1024,
  linkFirst: 100,
  linkNext: 2,
  suggest: 20,
  tags: 50,
  graph: 50,
  mentions: 1000,
  planScan: 200,
} as const

interface PerfContext {
  files: SyntheticNote[]
  notes: IndexedNote[]
  indexMs: number
}

function elapsed(run: () => void): number {
  const started = performance.now()
  run()
  return performance.now() - started
}

function logMetric(label: string, ms: number, budgetMs: number, detail = ''): void {
  const suffix = detail ? ` ${detail}` : ''
  console.info(`[perf] ${label}: ${ms.toFixed(1)} ms；預算 ${budgetMs} ms${suffix}`)
}

function loadStore(notes: IndexedNote[], workspace: string): void {
  const store = useVaultIndexStore.getState()
  store.reset(workspace)
  store.replaceAll(new Map(notes.map(note => [note.path, note])))
}

function measureVault(label: string, count: number, scale: number): PerfContext {
  const files = makeSyntheticVault(count, 20261019)
  const started = performance.now()
  const notes = files.map((file, index) => indexNote(file.path, file.content, 1_700_000_000_000 + index))
  const indexMs = performance.now() - started
  logMetric(`${label} indexNote`, indexMs, BUDGET.indexNote * scale)
  return { files, notes, indexMs }
}

describe('未連結提及一次掃描', () => {
  it('較長名稱因邊界失敗時，仍留下同一位置較短且合法的名稱', () => {
    expect(findUnlinkedMentions('Hello-Worlds', ['Hello', 'Hello-World']).map(mention => mention.text)).toEqual(['Hello'])
    expect(findUnlinkedMentions('xNote Notex Note_ _Note Note', ['Note']).map(mention => mention.column)).toEqual([24])
  })
})

describe('合成 vault', () => {
  it('固定 seed 可重現，形狀符合大 vault 基準', () => {
    const first = makeSyntheticVault(32, 7)
    const second = makeSyntheticVault(32, 7)
    expect(second).toEqual(first)
    expect(makeSyntheticVault(32, 8)).not.toEqual(first)
    expect(makeSyntheticVault(0, 1)).toEqual([])
    expect(SYNTHETIC_FOLDERS).toHaveLength(10)
    expect(new Set(SYNTHETIC_FOLDERS).size).toBe(10)

    const paths = new Set<string>()
    for (const note of first) {
      expect(note.content.length).toBeGreaterThanOrEqual(1024)
      expect(note.content.length).toBeLessThanOrEqual(3072)
      const parts = note.path.split('/')
      expect(parts).toHaveLength(3)
      expect(SYNTHETIC_FOLDERS).toContain(`${parts[0]}/${parts[1]}`)
      expect(note.content).toContain('[[Note]]')
      expect(note.content).toContain('[[Note|')
      expect(note.content).toContain('[[Note#第二節]]')
      expect(note.content).toContain('- [ ]')
      expect(note.content).toContain('- [x]')
      expect(note.content).toContain('\n# ')
      expect(note.content).toContain('\n## ')
      expect(note.content).toMatch(/\^blk-\d+/)
      expect(note.content).toContain('project/p')
      paths.add(note.path)
    }
    expect(paths.size).toBe(first.length)
    expect(first.slice(0, 10).map(note => note.path.split('/').pop())).toEqual(Array.from({ length: 10 }, () => 'Note.md'))

    const indexed = indexNote(first[3].path, first[3].content, 1)
    expect(indexed.links.filter(link => link.kind === 'wikilink')).toHaveLength(5)
    expect(indexed.tasks).toHaveLength(2)
    expect(indexed.headings).toHaveLength(2)
    expect(indexed.blockIds).toHaveLength(1)
    expect(indexed.tags.filter(tag => tag.includes('/')).length).toBeGreaterThanOrEqual(1)
    expect(indexed.tags.length).toBeGreaterThanOrEqual(3)
    const keys = indexed.frontmatter ? Object.keys(indexed.frontmatter) : []
    expect(keys.length).toBeGreaterThanOrEqual(3)
    expect(keys.length).toBeLessThanOrEqual(6)
  })
})

function installPerfSuite(label: string, count: number, scale: number): void {
  describe(label, () => {
    const ctx: PerfContext = { files: [], notes: [], indexMs: 0 }

    beforeAll(() => {
      const measured = measureVault(label, count, scale)
      ctx.files = measured.files
      ctx.notes = measured.notes
      ctx.indexMs = measured.indexMs
    }, 180_000)

    afterAll(() => {
      useVaultIndexStore.getState().reset(`${label}-done`)
      selectBacklinks(useVaultIndexStore.getState(), 'none.md')
    })

    it('indexNote 全部', () => {
      expect(ctx.indexMs, `${label} indexNote ${ctx.indexMs.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.indexNote * scale * LOOSE)
    })

    it('serializeIndexCache 與 restoreIndexCache', () => {
      let bytes = 0
      let restored = 0
      const ms = elapsed(() => {
        const payload = serializeIndexCache('perf', ctx.notes, 1)
        const json = JSON.stringify(payload)
        bytes = Buffer.byteLength(json)
        restored = restoreIndexCache(JSON.parse(json), 'perf').size
      })
      logMetric(`${label} cache`, ms, BUDGET.cache * scale, `json ${(bytes / 1024 / 1024).toFixed(2)} MB`)
      expect(restored).toBe(count)
      expect(ms, `${label} cache ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.cache * scale * LOOSE)
      expect(bytes).toBeLessThanOrEqual(BUDGET.cacheBytes * scale)
    })

    it('selectBacklinks 第一次與之後', () => {
      loadStore(ctx.notes, `${label}-backlinks`)
      const state = useVaultIndexStore.getState()
      let refs = 0
      const first = elapsed(() => { refs = selectBacklinks(state, ctx.notes[0].path).length })
      let later = 0
      const next = elapsed(() => { later = selectBacklinks(state, ctx.notes[Math.min(10, count - 1)].path).length })
      logMetric(`${label} selectBacklinks first`, first, BUDGET.linkFirst * scale, `refs ${refs}`)
      logMetric(`${label} selectBacklinks next`, next, BUDGET.linkNext * scale, `refs ${later}`)
      expect(first, `${label} backlinks first ${first.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.linkFirst * scale * LOOSE)
      expect(next, `${label} backlinks next ${next.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.linkNext * scale * LOOSE)
    }, 180_000)

    it('selectOutgoingLinks 第一次與之後', () => {
      loadStore(ctx.notes, `${label}-outgoing`)
      const state = useVaultIndexStore.getState()
      let refs = 0
      const first = elapsed(() => { refs = selectOutgoingLinks(state, ctx.notes[0].path).length })
      let later = 0
      const next = elapsed(() => { later = selectOutgoingLinks(state, ctx.notes[1 % count].path).length })
      logMetric(`${label} selectOutgoingLinks first`, first, BUDGET.linkFirst * scale, `links ${refs}`)
      logMetric(`${label} selectOutgoingLinks next`, next, BUDGET.linkNext * scale, `links ${later}`)
      expect(first, `${label} outgoing first ${first.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.linkFirst * scale * LOOSE)
      expect(next, `${label} outgoing next ${next.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.linkNext * scale * LOOSE)
    }, 180_000)

    it('rankWikilinkSuggestions（query 3 字，同一 notes 參考再查一次）', () => {
      const suggestNotes: WikilinkSuggestNote[] = ctx.notes.map(note => ({
        path: note.path,
        aliases: note.aliases,
        mtime: note.mtime,
        headings: note.headings,
        blockIds: note.blockIds,
      }))
      let ranked = 0
      const first = elapsed(() => {
        ranked = rankWikilinkSuggestions({ query: 'n10', notes: suggestNotes, currentPath: ctx.notes[0].path }).length
      })
      let again = 0
      const second = elapsed(() => {
        again = rankWikilinkSuggestions({ query: 'n10', notes: suggestNotes, currentPath: ctx.notes[0].path }).length
      })
      logMetric(`${label} rankWikilinkSuggestions first`, first, BUDGET.suggest * scale, `hits ${ranked}`)
      logMetric(`${label} rankWikilinkSuggestions second`, second, BUDGET.suggest * scale, `hits ${again}`)
      expect(again).toBe(ranked)
      expect(first, `${label} suggest ${first.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.suggest * scale * LOOSE)
      expect(second, `${label} suggest second ${second.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.suggest * scale * LOOSE)
    })

    it('buildTagTree', () => {
      let nodes = 0
      const ms = elapsed(() => { nodes = buildTagTree(ctx.notes).length })
      logMetric(`${label} buildTagTree`, ms, BUDGET.tags * scale, `roots ${nodes}`)
      expect(nodes).toBeGreaterThan(0)
      expect(ms, `${label} tags ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.tags * scale * LOOSE)
    })

    it('buildLocalGraph 深度 2，換中心再算一次', () => {
      let nodes = 0
      const first = elapsed(() => {
        nodes = buildLocalGraph(ctx.notes[0].path, ctx.notes, { depth: 2, revision: 1 }).nodes.length
      })
      let nodes2 = 0
      const second = elapsed(() => {
        nodes2 = buildLocalGraph(ctx.notes[Math.min(20, count - 1)].path, ctx.notes, { depth: 2, revision: 1 }).nodes.length
      })
      logMetric(`${label} buildLocalGraph first`, first, BUDGET.graph * scale, `nodes ${nodes}`)
      logMetric(`${label} buildLocalGraph second`, second, BUDGET.graph * scale, `nodes ${nodes2}`)
      expect(nodes).toBeGreaterThan(0)
      expect(nodes2).toBeGreaterThan(0)
      expect(first, `${label} graph ${first.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.graph * scale * LOOSE)
      expect(second, `${label} graph second ${second.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.graph * scale * LOOSE)
    }, 180_000)

    it('findUnlinkedMentions 掃全部內容', () => {
      const names = ['Note', '別名甲']
      let mentions = 0
      const ms = elapsed(() => {
        for (const file of ctx.files) mentions += findUnlinkedMentions(file.content, names).length
      })
      logMetric(`${label} findUnlinkedMentions`, ms, BUDGET.mentions * scale, `mentions ${mentions}`)
      expect(mentions).toBeGreaterThan(0)
      if (scale === 1) expect(mentions).toBe(97588)
      expect(ms, `${label} mentions ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.mentions * scale * LOOSE)
    }, 180_000)

    it('抽樣解析與逐路徑掃描一致', () => {
      const paths = ctx.notes.map(note => note.path)
      const lookup = buildLinkLookup(paths)
      for (const note of ctx.notes.slice(0, 25)) {
        for (const link of note.links) {
          expect(resolveIndexedLinkWithLookup(link, lookup, note.path)).toBe(resolveIndexedLink(link, paths, note.path))
        }
      }
    })

    it('planScan 只比 mtime', () => {
      const cached = new Map(ctx.notes.map(note => [note.path, note]))
      const listed = ctx.notes.map(note => ({ path: note.path, mtime: note.mtime }))
      listed[0] = { path: listed[0].path, mtime: listed[0].mtime + 1 }
      let indexed = 0
      const ms = elapsed(() => { indexed = planScan(cached, listed).toIndex.length })
      logMetric(`${label} planScan`, ms, BUDGET.planScan * scale, `toIndex ${indexed}`)
      expect(indexed).toBe(1)
      expect(ms, `${label} planScan ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET.planScan * scale * LOOSE)
    })
  })
}

installPerfSuite('synthetic-3000', 3000, 1)
installPerfSuite('synthetic-10000', 10000, 4)

describe('預建連結對照表', () => {
  const paths = [
    'Inbox/Note.md',
    'Projects/Note.md',
    'Projects/Sub/Deep.md',
    'Daily/20261019.md',
    'Attachments/圖.png',
    'Other/unique.md',
    'long/Note.md',
    'x/Note.md',
    'here/Note.md',
  ]

  it('與 resolveWikilinkTarget 一致', () => {
    const lookup = buildLinkLookup(paths)
    const targets = ['Note', 'NOTE', 'unique', 'Deep.md', 'Projects/Note', 'projects/note', '圖.png', '圖', '沒有這篇', '', '  Note  ', 'LONG/note', 'x/Note.md', '20261019']
    const sources = ['', 'here/a.md', 'else/a.md', 'Projects/Other.md', 'Daily/20261019.md', 'Inbox/Note.md']
    for (const target of targets) {
      for (const source of sources) {
        expect(resolveWikilinkTargetWithLookup(target, lookup, source), `${target} @ ${source}`).toBe(resolveWikilinkTarget(target, paths, source))
      }
    }
  })

  it('完整路徑的先後順序與舊函式相同', () => {
    for (const ordered of [['foo.md', 'foo'], ['foo', 'foo.md'], ['b/Note.md', 'a/Note.md']]) {
      const lookup = buildLinkLookup(ordered)
      for (const target of ['foo', 'foo.md', 'Note', 'a/Note', 'b/note']) {
        expect(resolveWikilinkTargetWithLookup(target, lookup, 'a/x.md')).toBe(resolveWikilinkTarget(target, ordered, 'a/x.md'))
      }
    }
  })

  it('反向索引與舊的逐篇掃描一致', () => {
    const notes = [
      indexNote('z.md', '[[Target|別名]]'),
      indexNote('Target.md', '[[Target]] [[#標題]]'),
      indexNote('a/source.md', 'text\n![[Target#段落]]\n[文字](../target.md)'),
      indexNote('missing.md', '[[未知]]'),
      indexNote('here/a.md', '[[Note]]'),
    ]
    const notePaths = notes.map(note => note.path)
    const lookup = buildLinkLookup(notePaths)
    for (const note of notes) {
      for (const link of note.links) {
        expect(resolveIndexedLinkWithLookup(link, lookup, note.path)).toBe(resolveIndexedLink(link, notePaths, note.path))
      }
    }
    const index = buildVaultLinkIndex(notes, lookup)
    for (const path of ['Target.md', 'target.md', 'z.md', 'missing.md', 'here/a.md', 'absent.md']) {
      expect(index.backlinks.get(path.toLowerCase()) ?? []).toEqual(collectBacklinks(path, notes))
    }
    for (const note of notes) expect(index.outgoing.get(note.path)).toEqual(collectOutgoingLinks(note.path, notes))
    expect(index.outgoing.has('absent.md')).toBe(false)
  })
})

describe('索引排程與並行數', () => {
  it('讀檔 50 篇以內用 4，否則用 8；列目錄 stat 最多 32', () => {
    expect(indexReadConcurrency(0)).toBe(0)
    expect(indexReadConcurrency(-1)).toBe(0)
    expect(indexReadConcurrency(1)).toBe(1)
    expect(indexReadConcurrency(4)).toBe(4)
    expect(indexReadConcurrency(5)).toBe(4)
    expect(indexReadConcurrency(50)).toBe(4)
    expect(indexReadConcurrency(51)).toBe(8)
    expect(indexReadConcurrency(3000)).toBe(8)
    expect(listStatConcurrency(0)).toBe(0)
    expect(listStatConcurrency(10)).toBe(10)
    expect(listStatConcurrency(3000)).toBe(32)
  })

  it('沒有 requestIdleCallback 時用 setTimeout，取消後不再執行', () => {
    vi.useFakeTimers()
    const globals = globalThis as { requestIdleCallback?: unknown }
    const previous = globals.requestIdleCallback
    globals.requestIdleCallback = undefined
    try {
      let ran = false
      scheduleVaultIndexSave(() => { ran = true }, 2000)
      vi.advanceTimersByTime(1999)
      expect(ran).toBe(false)
      vi.advanceTimersByTime(1)
      expect(ran).toBe(true)
      ran = false
      const cancel = scheduleVaultIndexSave(() => { ran = true }, 2000)
      cancel()
      vi.advanceTimersByTime(2000)
      expect(ran).toBe(false)
    } finally {
      globals.requestIdleCallback = previous
      vi.useRealTimers()
    }
  })

  it('有 requestIdleCallback 時用它，取消時呼叫 cancelIdleCallback', () => {
    const scheduled: Array<{ timeout?: number }> = []
    const cancelIdle = vi.fn()
    vi.stubGlobal('requestIdleCallback', (_callback: () => void, options?: { timeout?: number }) => {
      scheduled.push({ timeout: options?.timeout })
      return 11
    })
    vi.stubGlobal('cancelIdleCallback', cancelIdle)
    try {
      const cancel = scheduleVaultIndexSave(() => undefined, 2000)
      expect(scheduled).toEqual([{ timeout: 2000 }])
      cancel()
      expect(cancelIdle).toHaveBeenCalledWith(11)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

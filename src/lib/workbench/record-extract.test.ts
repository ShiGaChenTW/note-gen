// Fork（almanac ALMNC-90）：紀錄筆記「送給指揮官萃取」的去重流程——內容沒變不重送、已有未處理提案時提示、改了才接新版。
import { describe, expect, it, vi } from 'vitest'
import { createSource, editSourceContent, transitionSource, RECORD_EXTRACT_KIND, type Source } from '@/lib/v3-model/source'
import type { Proposal } from '@/lib/collect/types'
import {
  hasPendingProposalsFor, isRecordNote, recordExtractSource, recordExtractSourceId, recordNoteLink, routeRecordExtract, type RecordExtractDeps,
} from './record-extract'

const PATH = '30 日誌/2026-11-10 週會.md'
const NOTE = '---\ntype: log\ntitle: 11/10 週會\n---\n# 11/10 週會\n\n決定每天留 30 分鐘緩衝；切換工作的代價比想像中高。\n'

/** 記憶體裡的資料源表＋工作台的待決定提案；流程（routeRecordExtract）用真的。 */
function memory() {
  const rows: Source[] = []
  const pending: Array<Pick<Proposal, 'sourceIds'> & { status: 'wait' | 'ok' | 'no' }> = []
  let nextId = 1
  let now = 1_700_000_000_000
  const kick = vi.fn()
  const deps: RecordExtractDeps = {
    chain: async rootId => {
      const first = rows.find(row => row.id === rootId)
      if (!first) return []
      const chain = [first]
      for (;;) {
        const next = rows.find(row => row.previousId === chain[chain.length - 1].id)
        if (!next) return chain
        chain.push(next)
      }
    },
    hasPendingProposals: async ids => hasPendingProposalsFor([{ proposals: pending }], ids),
    addIfAbsent: async input => {
      if (rows.some(row => row.id === input.id)) return undefined
      const source = createSource(input, now++)
      rows.push(source)
      return source
    },
    edit: async (id, content) => {
      const result = editSourceContent(rows.find(row => row.id === id)!, content, now++, `S-${nextId++}`)
      if (result.kind === 'versioned') rows.push(result.source)
      return result
    },
    kick,
  }
  /** 指揮官分析完：最新一版改成已分析，提案進工作台（等 Scott 決定）。 */
  const analyze = (withProposal = true) => {
    const latest = rows[rows.length - 1]
    const analyzed = transitionSource(transitionSource(latest, 'analyzing', now++), 'analyzed', now++)
    rows[rows.length - 1] = analyzed
    if (withProposal) pending.push({ sourceIds: [analyzed.id], status: 'wait' })
  }
  return { rows, pending, deps, kick, analyze }
}

describe('isRecordNote：只有紀錄類筆記（日誌筆記）才能送去萃取', () => {
  it('type: log 與舊值 record 都算；知識、專案、沒有 frontmatter、frontmatter 壞掉都不算', () => {
    expect(isRecordNote('---\ntype: log\n---\n')).toBe(true)
    expect(isRecordNote('---\ntype: record\n---\n')).toBe(true)
    expect(isRecordNote('---\ntype: knowledge\n---\n')).toBe(false)
    expect(isRecordNote('---\ntype: project\n---\n')).toBe(false)
    expect(isRecordNote(null)).toBe(false)
    expect(isRecordNote('---\ntype: [log\n---\n')).toBe(false)
  })
})

describe('recordExtractSource', () => {
  it('id 由筆記路徑決定（和一般「送給指揮官」分開），形式是萃取，來處是筆記路徑', () => {
    expect(recordExtractSource({ path: PATH, content: NOTE })).toEqual({
      id: recordExtractSourceId(PATH), sourceType: 'self', kind: RECORD_EXTRACT_KIND, content: NOTE.trim(), origin: PATH, collector: 'scott',
    })
    expect(recordExtractSourceId(PATH)).not.toBe(`src_note:${PATH}`)
    expect(recordExtractSource({ path: PATH, content: '  \n' })).toBeUndefined()
    // 身分編號是系統補的，不送給指揮官、也不算進內容
    expect(recordExtractSource({ path: PATH, content: NOTE.replace('---\n', '---\nid: N-20261127-011915-GULX\n') })?.content).toBe(NOTE.trim())
  })

  it('連回紀錄筆記的 wiki 連結用檔名（去掉資料夾與 .md）', () => {
    expect(recordNoteLink(PATH)).toBe('[[2026-11-10 週會]]')
  })
})

describe('routeRecordExtract：同一則紀錄筆記重複送出不會產生重複提案', () => {
  it('第一次送：登錄成待分析並叫指揮官', async () => {
    const { rows, deps, kick } = memory()
    const result = await routeRecordExtract({ path: PATH, content: NOTE }, deps)
    expect(result.outcome).toBe('added')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: recordExtractSourceId(PATH), status: 'pending_analysis', kind: RECORD_EXTRACT_KIND })
    expect(kick).toHaveBeenCalledOnce()
  })

  it('還在萃取中再按：不重送，回 inProgress', async () => {
    const { rows, deps, kick } = memory()
    await routeRecordExtract({ path: PATH, content: NOTE }, deps)
    const result = await routeRecordExtract({ path: PATH, content: `${NOTE}\n補一句。` }, deps)
    expect(result.outcome).toBe('inProgress')
    expect(rows).toHaveLength(1)
    expect(kick).toHaveBeenCalledOnce()
  })

  it('已有未處理的萃取提案：就算內容改了也不重送，回 pending（提示先處理工作台）', async () => {
    const { rows, deps, kick, analyze } = memory()
    await routeRecordExtract({ path: PATH, content: NOTE }, deps)
    analyze()
    expect((await routeRecordExtract({ path: PATH, content: NOTE }, deps)).outcome).toBe('pending')
    expect((await routeRecordExtract({ path: PATH, content: `${NOTE}\n補一句。` }, deps)).outcome).toBe('pending')
    expect(rows).toHaveLength(1)
    expect(kick).toHaveBeenCalledOnce()
  })

  it('提案都處理完、內容沒變：不重送，回 unchanged', async () => {
    const { rows, pending, deps, kick, analyze } = memory()
    await routeRecordExtract({ path: PATH, content: NOTE }, deps)
    analyze()
    pending[0].status = 'ok'
    const result = await routeRecordExtract({ path: PATH, content: `\n${NOTE}\n` }, deps)
    expect(result.outcome).toBe('unchanged')
    expect(rows).toHaveLength(1)
    expect(kick).toHaveBeenCalledOnce()
  })

  it('讀過沒有知識可萃取（沒有提案）、內容沒變：一樣不重送', async () => {
    const { deps, kick, analyze } = memory()
    await routeRecordExtract({ path: PATH, content: NOTE }, deps)
    analyze(false)
    expect((await routeRecordExtract({ path: PATH, content: NOTE }, deps)).outcome).toBe('unchanged')
    expect(kick).toHaveBeenCalledOnce()
  })

  it('提案都處理完、內容改了：接一版新的（舊版不動）再叫指揮官；新版的提案未處理時同樣擋住', async () => {
    const { rows, pending, deps, kick, analyze } = memory()
    await routeRecordExtract({ path: PATH, content: NOTE }, deps)
    analyze()
    pending[0].status = 'no'
    const result = await routeRecordExtract({ path: PATH, content: `${NOTE}\n補一句。` }, deps)
    expect(result.outcome).toBe('versioned')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ previousId: rows[0].id, version: 2, status: 'pending_analysis', kind: RECORD_EXTRACT_KIND })
    expect(rows[0].content).toBe(NOTE.trim())
    expect(kick).toHaveBeenCalledTimes(2)

    analyze()
    expect((await routeRecordExtract({ path: PATH, content: `${NOTE}\n再補。` }, deps)).outcome).toBe('pending')
    expect(rows).toHaveLength(2)
  })

  it('系統開啟筆記時補上的身分編號（frontmatter id）不算內容改了：一樣不重送', async () => {
    const { rows, deps, kick, analyze } = memory()
    await routeRecordExtract({ path: PATH, content: NOTE }, deps)
    analyze(false)
    const withId = NOTE.replace('---\n', '---\nid: N-20261127-011915-GULX\n')
    expect((await routeRecordExtract({ path: PATH, content: withId }, deps)).outcome).toBe('unchanged')
    expect(rows).toHaveLength(1)
    expect(kick).toHaveBeenCalledOnce()
  })

  it('空白筆記不送', async () => {
    const { rows, deps, kick } = memory()
    expect((await routeRecordExtract({ path: PATH, content: ' ' }, deps)).outcome).toBe('empty')
    expect(rows).toHaveLength(0)
    expect(kick).not.toHaveBeenCalled()
  })
})

describe('hasPendingProposalsFor', () => {
  it('只看等決定（wait）的提案，比對任一個來源 id', () => {
    const items = [{ proposals: [{ sourceIds: ['S-1'], status: 'ok' as const }, { sourceIds: ['S-2', 'S-3'], status: 'wait' as const }, { status: 'wait' as const }] }]
    expect(hasPendingProposalsFor(items, ['S-1'])).toBe(false)
    expect(hasPendingProposalsFor(items, ['S-3'])).toBe(true)
    expect(hasPendingProposalsFor(items, [])).toBe(false)
  })
})

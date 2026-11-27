import { describe, expect, it, vi } from 'vitest'
import { parseItems, serializeItems, type PersistedItem } from '@/lib/collect/persist'
import type { ProposalBatch } from '@/lib/commander/types'
import { projectProposals } from '@/lib/decide/project'
import { contentVersion } from '@/lib/ops/version'
import { parseMoc } from '@/lib/moc/parse'
import { createV3Note, parseV3Note } from '@/lib/v3-model/note'
import { buildReviewCards } from '@/lib/workbench/cards'
import { SCOTT_PIN_TTL_MS, type ScottPin } from '@/lib/moc/scott-pins'
import { applyEdits } from './apply'
import type { CleanupLabels } from './plan'
import { memoryQueue, storeQueue } from './queue'
import type { ConflictObservation } from './types'
import { canSuggestStart, chapterCountIssue, runWeeklyMocs, weeklyMocKey, type WeeklyMocDeps } from './weekly-moc'

const ID = 'M-20261112-060012-VPB3'
const CHAPTER = 'C-20261112-060020-N9NR'
const UNSORTED = 'C-20261112-060024-3XSV'
const PATH = '領域.md'
const NOW = new Date(2027, 0, 4, 12)
const labels: CleanupLabels = {
  action: action => action,
  bundleTitle: ({ domain }) => domain,
  singleTitle: ({ action, title }) => `${action} ${title}`,
  item: ({ evidence }) => evidence,
  origin: () => '整理',
  confirmTitle: ({ title }) => title,
  confirmBody: () => '',
}

const notePath = (n: number) => `notes/${n}.md`
const rawMoc = [
  '---', `id: ${ID}`, 'kind: domain', 'title: 時間管理', '---', '# 時間管理', '',
  '## ① 定位問題', '怎麼安排時間？', '',
  '## ② 從這裡開始', '第一次來先讀以下筆記。', '',
  '## ③ 章節', '', '### 什麼時候做', `<!-- ${CHAPTER} -->`,
  '- [[notes/0]] ── 解釋安排順序', '- [[notes/1]] ── 說明時段', '',
  '### 尚未分章', `<!-- ${UNSORTED} -->`,
  '- [[notes/2|筆記二]]', '- [[notes/3]]', '- [[notes/4]]', '- [[notes/5]]', '- [[missing]]', '',
  '## ④ 重點結論', '<!-- 這行保留 -->', '', '- 舊結論 [[notes/0]]', '',
  '## ⑤ 待釐清', '- 未解：需要例子嗎？（來源：專家發現）', '',
].join('\r\n')

const contradiction: ConflictObservation = { domainId: ID, type: 'contradiction', notePaths: [notePath(0), notePath(1)], evidence: '同一情境的兩種說法', trigger: 'written' }

function setup(output: object = {}, initial: ConflictObservation[] = []) {
  const submitted: ProposalBatch[] = []
  const persisted = new Map<string, PersistedItem>()
  const files = new Map([[PATH, rawMoc], ...Array.from({ length: 10 }, (_, n): [string, string] => [
    notePath(n), createV3Note({ title: `筆記 ${n}`, type: 'knowledge', status: 'valid', lastConfirmed: '2001-01-01' }, `本文 ${n}`),
  ])])
  const queue = memoryQueue(initial)
  const ask = vi.fn<WeeklyMocDeps['ask']>(async () => JSON.stringify(output))
  const deps: WeeklyMocDeps = {
    files: async () => [{ path: PATH, raw: files.get(PATH)! }],
    resolve: target => files.has(`${target}.md`) ? `${target}.md` : null,
    hasCard: async key => persisted.has(key),
    submit: async batch => {
      submitted.push(batch)
      const [item] = serializeItems([{
        id: batch.id, createdAt: NOW.getTime(), input: { kind: 'text', text: '', name: batch.origin },
        state: 'ready', proposals: batch.proposals.map(proposal => ({ ...proposal, status: 'wait' })),
      }])
      persisted.set(item.id, item)
    },
    ask,
    newChapterId: vi.fn()
      .mockResolvedValueOnce('C-20270104-000001-AAAA')
      .mockResolvedValueOnce('C-20270104-000001-AAAB'),
    labels: { start: '從這裡開始', conclusions: '重點結論', open: '待釐清', outdated: title => `過時待確認：${title}`, place: (note, chapter) => `${note} → ${chapter}`, tooFew: () => '新增章節', tooMany: () => '合併章節' },
    check: { queue, readNote: async path => files.get(path) ?? null, domains: async () => [{ id: ID, name: '時間管理', overview: '' }], labels },
  }
  const io = { readNote: deps.check.readNote, writeNote: async (path: string, content: string) => { files.set(path, content) } }
  return { deps, submitted, persisted, files, io, queue, ask }
}

describe('weekly MOC policy', () => {
  it('uses the local ISO week, including the ISO year at a calendar boundary', () => {
    expect(weeklyMocKey(ID, new Date(2027, 0, 1))).toBe(`cleanup:moc:${ID}:2026-W53`)
    expect(weeklyMocKey(ID, NOW)).toBe(`cleanup:moc:${ID}:2027-W01`)
  })

  it('applies the six-note reading threshold and the 3–7 chapter bounds', () => {
    expect(canSuggestStart(5)).toBe(false)
    expect(canSuggestStart(6)).toBe(true)
    expect(chapterCountIssue(2, 8, false)).toBeUndefined()
    expect(chapterCountIssue(2, 9, true)).toBeUndefined()
    expect(chapterCountIssue(2, 9, false)).toBe('tooFew')
    expect(chapterCountIssue(3, 9, false)).toBeUndefined()
    expect(chapterCountIssue(7, 9, false)).toBeUndefined()
    expect(chapterCountIssue(8, 1, true)).toBe('tooMany')
  })

  it('uses formal resolved entries, and never accepts a placement without a chapter and relationship', async () => {
    const { deps, files, ask } = setup({
      start: [0, 1, 2],
      placements: [null, { note: 0, chapter: 0, relation: '已經分好了' }, { note: 2, chapter: 1, relation: '不存在' },
        { note: 2, chapter: 0, relation: '\n' }, { note: 2, chapter: 0, relation: '回答時機' }, { note: 2, chapter: 0, relation: '重複' }],
    })
    files.delete(notePath(5))
    const items = await runWeeklyMocs(NOW, deps)
    expect(items.map(item => item.title)).toEqual(['筆記 2 → 什麼時候做'])
    const [edit] = items[0].edits!
    expect(edit.content).toContain('- [[notes/2|筆記二]] ── 回答時機\r\n')
    expect(parseMoc(edit.content).unsorted?.entries.map(entry => entry.target)).not.toContain('notes/2')
    expect(ask.mock.calls[0][0]).not.toContain('2001-01-01')
  })
})

describe('weekly MOC cards', () => {
  it('produces one card per MOC per ISO week and skips the second run after reload and a MOC rename', async () => {
    const { deps, submitted, persisted, ask } = setup({ open: [{ text: '還需要例子嗎？', kind: 'gap', notes: [1] }] })
    const first = await runWeeklyMocs(NOW, deps)
    expect(first).toHaveLength(1)
    expect(submitted).toHaveLength(1)
    const stored = [...persisted.values()][0]
    const decided = { ...stored, proposals: stored.proposals.map(item => ({ ...item, status: 'no' })) }
    const reopened = parseItems([decided], new Date(2027, 0, 10).getTime())
    expect(reopened).toHaveLength(1)
    expect(reopened[0].proposals[0].mocReview).toEqual({ id: ID, name: '時間管理', week: '2027-W01' })
    const again = {
      ...deps, hasCard: async (key: string) => reopened.some(item => item.id === key),
      files: async () => [{ path: '改名.md', raw: rawMoc.replace('title: 時間管理', 'title: 新的領域名') }],
    }
    expect(await runWeeklyMocs(new Date(2027, 0, 10), again)).toEqual([])
    expect(ask).toHaveBeenCalledTimes(1)
    expect(await runWeeklyMocs(new Date(2027, 0, 11), again)).toHaveLength(1)
    expect(submitted.map(batch => batch.id)).toEqual([`cleanup:moc:${ID}:2027-W01`, `cleanup:moc:${ID}:2027-W02`])
  })

  it('keeps all pending items together and writes only accepted changes while retaining other edits', async () => {
    const { deps, files, io, persisted } = setup({
      conclusions: [{ before: 0, text: '先排重要的事', notes: [0, 1] }, { text: '缺少來源' }],
      open: [{ text: '什麼是可用時間？', kind: 'unresolved' }],
      start: [1, 2, 0],
      placements: [{ note: 2, chapter: 0, relation: '補充不同時段的例子' }, { note: 3, chapter: 0, relation: '描述準備時間' }],
    }, [contradiction])
    const items = await runWeeklyMocs(NOW, deps)
    expect(items).toHaveLength(6)
    const input = [...persisted.values()]
    const decisions = () => projectProposals({ items: input, tasks: [], journal: null, jobs: [] })
    const cards = () => buildReviewCards({ proposals: decisions(), now: NOW.getTime() })
    expect(cards()).toMatchObject([{ label: 'knowledge', verb: 'organize', title: '時間管理', actions: [], batch: expect.any(Array) }])
    expect(cards()[0].batch).toHaveLength(6)
    expect(parseV3Note(files.get(notePath(0))!).fields.status).toBe('valid')

    const accept = async (index: number) => {
      await applyEdits(items[index], io)
      input[0].proposals[index].status = 'ok'
    }
    await accept(0)
    input[0].proposals[1].status = 'no'
    await accept(2)
    await accept(3)
    await accept(4)
    expect(cards()).toHaveLength(1)
    expect(cards()[0].batch).toHaveLength(1)
    expect(files.get(PATH)).toContain('先排重要的事 [[notes/0]]、[[notes/1]]')
    expect(files.get(PATH)).toContain('第一次來先讀以下筆記。')
    expect(files.get(PATH)).toContain('1. [[notes/1]]\r\n2. [[notes/2]]\r\n3. [[notes/0]]')
    expect(files.get(PATH)).not.toContain('什麼是可用時間')
    expect(files.get(PATH)).not.toMatch(/(?<!\r)\n/)
    await accept(5)
    expect(cards()).toEqual([])
    expect(files.get(PATH)).toContain('來源：[[notes/0]]、[[notes/1]]')
    expect(parseV3Note(files.get(notePath(0))!).fields.status).toBe('disputed')
  })

  it('does not overwrite a conclusion already edited by hand', async () => {
    const { deps, files, io } = setup({ conclusions: [{ before: 0, text: '先排重要的事', notes: [0] }] })
    const [proposal] = await runWeeklyMocs(NOW, deps)
    const edited = rawMoc.replace('舊結論', 'Scott 指定的結論')
    files.set(PATH, edited)
    await expect(applyEdits(proposal, io)).rejects.toMatchObject({ conflict: true, targets: [PATH] })
    expect(files.get(PATH)).toBe(edited)
  })

  it('puts a concrete chapter consolidation on the card and leaves formal membership intact', async () => {
    const { deps, files, io } = setup({ merge: { from: [1], into: 0, reason: '都在回答什麼時候做' } })
    const extra = Array.from({ length: 7 }, (_, n) => [
      `### 子問題 ${n + 1}`, `<!-- C-20261112-060030-AAAA -->`.replace('AAAA', `AAA${n}`), '',
    ].join('\r\n')).join('\r\n')
    files.set(PATH, rawMoc.replace('### 尚未分章', `${extra}\r\n### 尚未分章`))
    const [proposal] = await runWeeklyMocs(NOW, deps)
    expect(proposal.title).toBe('合併章節')
    await applyEdits(proposal, io)
    expect(parseMoc(files.get(PATH)!).chapters).toHaveLength(7)
    expect(files.get(PATH)).toContain('- [[notes/0]] ── 解釋安排順序\r\n')
  })

  it('proposes the two missing chapters only when at least nine notes resolve', async () => {
    const { deps, files } = setup({ newChapters: ['哪些事先做？', '怎麼檢查安排？'] })
    files.set(PATH, rawMoc.replace('- [[missing]]', '- [[notes/6]]\r\n- [[notes/7]]\r\n- [[notes/8]]'))
    const [proposal] = await runWeeklyMocs(NOW, deps)
    expect(proposal.title).toBe('新增章節')
    expect(parseMoc(proposal.edits![0].content).chapters.map(chapter => chapter.title)).toEqual(['什麼時候做', '哪些事先做？', '怎麼檢查安排？'])
  })

  it('records the actual before and after of a rebased MOC edit for undo', async () => {
    const { deps, files, io } = setup({ open: [{ text: '要不要加例子？', kind: 'gap' }] })
    const [proposal] = await runWeeklyMocs(NOW, deps)
    const onWritten = vi.fn()
    const manual = rawMoc.replace('怎麼安排時間？', '如何排時間？')
    await applyEdits(proposal, {
      ...io,
      rewriteNote: async (path, _before, _after, rebase) => {
        files.set(path, manual)
        files.set(path, rebase!(manual)!)
      },
    }, onWritten)
    expect(onWritten).toHaveBeenCalledWith([{ path: PATH, before: manual, after: files.get(PATH) }])
    expect(files.get(PATH)).toContain('如何排時間？')
  })

  it('leaves an older claim valid until Scott accepts replacement based on content evidence', async () => {
    const { deps, files, io } = setup({
      conflicts: [{ type: 'outdated', notes: [1, 0], evidence: '原規則已修訂成另一項要求', conclusionChanged: true }],
    })
    const [proposal] = await runWeeklyMocs(NOW, deps)
    expect(proposal).toMatchObject({ card: { verb: 'replace' }, membershipTransfers: [{ from: notePath(1), to: notePath(0) }] })
    expect(parseV3Note(files.get(notePath(1))!).fields.status).toBe('valid')
    await applyEdits(proposal, io)
    expect(parseV3Note(files.get(notePath(1))!).fields.status).toBe('superseded')
  })

  it('does not act on a queued observation once the evidence notes have changed', async () => {
    const { deps, files, queue } = setup()
    await queue.add([{ ...contradiction, observedVersions: Object.fromEntries(contradiction.notePaths.map(path => [path, contentVersion(files.get(path)!)!])) }])
    files.set(notePath(0), files.get(notePath(0))!.replace('本文 0', 'Scott 的更正'))
    expect(await runWeeklyMocs(NOW, deps)).toEqual([])
    expect(queue.items()).toEqual([])
  })

  // Fork（almanac ALMNC-92）：處理對話中查到新資料的觀察，和其他時機一樣出在同一張衝突確認卡（每週整理卡）。
  it('turns an observation from data fetched in a process conversation into the same conflict card', async () => {
    const fetched: ConflictObservation = { ...contradiction, trigger: 'fetched', by: { role: 'commander' }, externalUrls: ['https://example.com/std'] }
    const { deps, persisted, queue, files } = setup({}, [fetched])
    const [proposal] = await runWeeklyMocs(NOW, deps)
    expect(proposal.cleanup?.actions).toEqual(['verify'])
    expect(proposal.edits?.map(edit => edit.path)).toEqual(expect.arrayContaining([notePath(0), notePath(1)]))
    const cards = buildReviewCards({ proposals: projectProposals({ items: [...persisted.values()], tasks: [], journal: null, jobs: [] }), now: NOW.getTime() })
    expect(cards).toMatchObject([{ label: 'knowledge', verb: 'organize', title: '時間管理' }])
    expect(queue.items()).toEqual([])
    expect(parseV3Note(files.get(notePath(0))!).fields.status).toBe('valid')
  })

  it('leaves queued conflicts for retry when submitting the card fails', async () => {
    const { deps, queue } = setup({}, [contradiction])
    const errors: string[] = []
    expect(await runWeeklyMocs(NOW, { ...deps, submit: async () => { throw new Error('offline') } }, [], errors)).toEqual([])
    expect(errors[0]).toContain('offline')
    expect(queue.items()).toEqual([contradiction])
    expect(await runWeeklyMocs(NOW, deps)).toHaveLength(1)
    expect(queue.items()).toEqual([])
  })
})

// Fork（almanac ALMNC-69.11）：有「Scott 指定」標記的位置，一般整理（每週整理卡與清理提案）不主動提議改動；90 天後失效。
describe('Scott 指定', () => {
  const DAY = 24 * 60 * 60 * 1000
  const pin = (extra: Partial<ScottPin>, age = DAY): ScottPin => ({ kind: 'block', mocPath: PATH, mocId: ID, mocName: '時間管理', at: NOW.getTime() - age, ...extra })
  const withPins = (deps: WeeklyMocDeps, pins: ScottPin[]): WeeklyMocDeps => ({ ...deps, pins: async () => pins })

  it('有標記的區塊不提；別的區塊照提；90 天後失效又會提', async () => {
    const output = { conclusions: [{ before: 0, text: '先排重要的事', notes: [0] }], open: [{ text: '還需要例子嗎？', kind: 'gap' }] }
    const pinned = setup(output)
    const items = await runWeeklyMocs(NOW, withPins(pinned.deps, [pin({ block: 'conclusions' })]))
    expect(items.map(item => item.title)).toEqual(['待釐清'])
    const expired = setup(output)
    expect((await runWeeklyMocs(NOW, withPins(expired.deps, [pin({ block: 'conclusions' }, SCOTT_PIN_TTL_MS)]))).map(item => item.title)).toEqual(['重點結論', '待釐清'])
  })

  it('有標記的收錄不會被取代或合併換掉', async () => {
    const output = { conflicts: [{ type: 'outdated', notes: [1, 0], evidence: '原規則已修訂成另一項要求', conclusionChanged: true }] }
    const pinned = setup(output)
    expect(await runWeeklyMocs(NOW, withPins(pinned.deps, [pin({ kind: 'relation', notePath: notePath(1), chapterId: CHAPTER })]))).toEqual([])
    const other = setup(output)
    expect(await runWeeklyMocs(NOW, withPins(other.deps, [pin({ kind: 'relation', notePath: notePath(5), chapterId: CHAPTER })]))).toHaveLength(1)
  })

  it('待釐清有標記時，矛盾提案照提但不改 MOC', async () => {
    const { deps } = setup({}, [contradiction])
    const [proposal] = await runWeeklyMocs(NOW, withPins(deps, [pin({ block: 'open' })]))
    expect(proposal.cleanup?.actions).toEqual(['verify'])
    expect(proposal.edits?.map(edit => edit.path)).not.toContain(PATH)
  })

  it('有標記的章節不會被併掉；尚未分章的收錄（只保護歸屬）仍可排進章節', async () => {
    const { deps, files } = setup({ merge: { from: [1], into: 0, reason: '都在回答什麼時候做' } })
    const extra = Array.from({ length: 7 }, (_, n) => [`### 子問題 ${n + 1}`, `<!-- C-20261112-060030-AAA${n} -->`, ''].join('\r\n')).join('\r\n')
    files.set(PATH, rawMoc.replace('### 尚未分章', `${extra}\r\n### 尚未分章`))
    expect(await runWeeklyMocs(NOW, withPins(deps, [pin({ kind: 'chapter-title', chapterId: 'C-20261112-060030-AAA0' })]))).toEqual([])

    const placed = setup({ placements: [{ note: 2, chapter: 0, relation: '回答時機' }] })
    const items = await runWeeklyMocs(NOW, withPins(placed.deps, [pin({ kind: 'position', notePath: notePath(2), chapterId: UNSORTED })]))
    expect(items.map(item => item.title)).toEqual(['筆記 2 → 什麼時候做'])
  })

  it('讀不到標記時記錯，照沒有標記處理', async () => {
    const { deps } = setup({ open: [{ text: '還需要例子嗎？', kind: 'gap' }] })
    const errors: string[] = []
    expect(await runWeeklyMocs(NOW, { ...deps, pins: async () => { throw new Error('db') } }, [], errors)).toHaveLength(1)
    expect(errors[0]).toContain('pins')
  })
})

it('keeps concurrent observations for distinct MOCs and does not acknowledge newer evidence', async () => {
  let saved: unknown
  const queue = storeQueue({ get: async () => saved, set: async (_key, value) => { saved = value } })
  const other = { ...contradiction, domainId: 'other' }
  await Promise.all([queue.add([contradiction]), queue.add([other])])
  const snapshot = await queue.snapshot()
  expect(snapshot).toEqual([contradiction, other])
  const updated = { ...contradiction, evidence: '更新的證據' }
  await queue.add([updated])
  await queue.acknowledge(snapshot)
  expect(await queue.snapshot()).toEqual([updated])
})

it('persists a weekly sibling proposal and an evidence-based page split, and skips Scott-designated chapters', async () => {
  const { observeMocPositions, FOUR_WEEKS } = await import('@/lib/moc/positions')
  const arrange = (pinned: boolean) => {
    const { files, deps, persisted } = setup({ chapterSplits: [{ chapter: 0, titles: ['怎麼排序', '如何選時段'], second: [0] }] })
    let text = rawMoc.replace('kind: domain', 'kind: domain\r\nparent: M-20261112-060012-ROOT\r\nlevel: 2')
    const rows = Array.from({ length: 12 }, (_, n) => {
      files.set(notePath(n), createV3Note({ title: `筆記 ${n}`, type: 'knowledge', status: 'valid' }, '內容'))
      return `- [[notes/${n}]] ── 說明 ${n}`
    })
    text = text.replace(/- \[\[notes\/0\]\].*\r\n- \[\[notes\/1\]\].*/, rows.join('\r\n'))
      .replace(/### 尚未分章[\s\S]*?(?=## ④)/, '')
    files.set(PATH, text)
    const positions = observeMocPositions(parseMoc(text, PATH), null, deps.resolve, NOW.getTime() - FOUR_WEEKS)
    deps.branching = { positions: new Map([[ID, positions]]), identify: deps.resolve, isPinned: async pos => pinned && pos.note === notePath(0) }
    deps.labels.grow = (_, sibling) => sibling ? '升成同層' : '長成 MOC'
    deps.labels.growBody = count => String(count)
    deps.labels.splitPage = () => '在頁內拆'
    return { deps, persisted }
  }
  const { deps, persisted } = arrange(false)
  const items = await runWeeklyMocs(NOW, deps)
  expect(items.map(item => item.title)).toEqual(['升成同層', '在頁內拆'])
  const restored = parseItems([...persisted.values()], NOW.getTime())
  expect(restored[0].proposals.map(item => item.mocBranch)).toEqual(items.map(item => item.mocBranch))
  expect((await runWeeklyMocs(NOW, arrange(true).deps)).filter(item => item.mocBranch)).toEqual([])
})

// Fork（almanac ALMNC-88）：專家回顧領域時，同一主題零散片段過多 → 產生「建議你親手整理」卡（AI 用固定回應）。
describe('weekly MOC review → 建議你親手整理', () => {
  function withHandwork(output: object, options: { threshold?: number, existing?: string[][] } = {}) {
    const ctx = setup(output)
    const added: Array<{ domainId: string, domainName: string, topic: string, reason: string, paths: string[], agentId?: string }> = []
    ctx.deps.handwork = {
      threshold: vi.fn(async () => options.threshold ?? 5),
      existing: vi.fn(async () => (options.existing ?? []).map(paths => ({ paths }))),
      add: vi.fn(async pack => { added.push(pack) }),
    }
    return { ...ctx, added }
  }
  const fragments = [{ topic: '時段切法', reason: '六則都只有一兩句、彼此重複', notes: [0, 1, 2, 3, 4, 5] }]

  it('片段數達門檻時產生一張卡，列出那群筆記與領域', async () => {
    const { deps, added, ask } = withHandwork({ fragments })
    await runWeeklyMocs(NOW, deps)
    expect(ask.mock.calls[0][0]).toContain('fragments:')
    expect(added).toEqual([{
      domainId: ID, domainName: '時間管理', topic: '時段切法', reason: '六則都只有一兩句、彼此重複',
      paths: [0, 1, 2, 3, 4, 5].map(notePath),
    }])
  })

  it('門檻可調：門檻高於片段數時不產生，也不在提示詞裡要求', async () => {
    const { deps, added, ask } = withHandwork({ fragments }, { threshold: 7 })
    await runWeeklyMocs(NOW, deps)
    expect(added).toEqual([])
    expect(ask.mock.calls[0][0]).not.toContain('fragments:')
  })

  it('同一群筆記已有未處理卡就不重複產生', async () => {
    const { deps, added } = withHandwork({ fragments }, { existing: [[0, 1, 2, 3, 4, 5].map(notePath)] })
    await runWeeklyMocs(NOW, deps)
    expect(added).toEqual([])
  })

  it('不影響同一次回顧的其他整理提案；沒接 handwork 時照舊', async () => {
    const output = { fragments, open: [{ text: '還需要例子嗎？', kind: 'gap', notes: [1] }] }
    const { deps, added } = withHandwork(output)
    expect(await runWeeklyMocs(NOW, deps)).toHaveLength(1)
    expect(added).toHaveLength(1)
    const plain = setup(output)
    expect(await runWeeklyMocs(NOW, plain.deps)).toHaveLength(1)
    expect(plain.ask.mock.calls[0][0]).not.toContain('fragments:')
  })

  it('寫入失敗只記錯誤，不擋其他提案', async () => {
    const { deps } = withHandwork({ fragments, open: [{ text: '還需要例子嗎？', kind: 'gap', notes: [1] }] })
    deps.handwork!.add = vi.fn(async () => { throw new Error('db down') })
    const errors: string[] = []
    expect(await runWeeklyMocs(NOW, deps, [], errors)).toHaveLength(1)
    expect(errors.join('\n')).toContain('db down')
  })
})

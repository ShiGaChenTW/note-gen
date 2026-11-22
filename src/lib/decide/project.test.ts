// almanac ALMNC-10：等你定的投影——來源狀態變了，清單就跟著變；不存獨立狀態。
import { describe, expect, it } from 'vitest'
import { journalInsertPreview, previewDiff, projectDecisions, projectProposals, sameThingKey, type CollectItemLike, type DraftLike, type JournalSnapshot, type TaskLike } from './project'

const base = { body: '', due: '', time: '', tags: [] as string[] }
const journal = (before: string): JournalSnapshot => ({ before, section: '捕捉軌', fileMissing: false, today: '2026-11-18' })

function item(id: string, createdAt: number, proposals: CollectItemLike['proposals'], state: CollectItemLike['state'] = 'ready'): CollectItemLike {
  return { id, createdAt, state, input: { text: `原文 ${id}` }, proposals }
}
function task(id: string, updatedAt: number, drafts: DraftLike[], status = 'awaiting_review'): TaskLike {
  return { id, title: `任務 ${id}`, status, updatedAt, drafts }
}
const draft = (id: string, state: DraftLike['state'] = 'pending', extra: Partial<DraftLike> = {}): DraftLike =>
  ({ id, kind: 'update', path: 'Q4/草稿.md', baseContent: 'a\nb\nc', content: 'a\nB\nc', summary: '改第 2 段', state, ...extra })

describe('projectDecisions', () => {
  it('只列 wait 的收集提案與 pending 的草稿；status 一變就從清單消失', () => {
    const items = [item('c1', 10, [
      { ...base, id: 'p1', kind: 'note', title: '新筆記', status: 'wait' },
      { ...base, id: 'p2', kind: 'task', title: '已收下', status: 'ok' },
      { ...base, id: 'p3', kind: 'task', title: '已丟掉', status: 'no' },
    ])]
    const tasks = [task('t1', 20, [draft('d1'), draft('d2', 'applied'), draft('d3', 'discarded')])]
    const keys = projectDecisions({ items, tasks, journal: null }).map(entry => entry.key)
    expect(keys).toEqual(['collect:c1:p1', 'draft:t1:d1'])

    items[0].proposals[0].status = 'ok'
    tasks[0].drafts[0].state = 'applied'
    expect(projectDecisions({ items, tasks, journal: null })).toEqual([])
  })

  it('還在讀取的項目、不在待審狀態的任務都不列', () => {
    const items = [item('c1', 1, [{ ...base, id: 'p1', kind: 'task', title: '甲', status: 'wait' }], 'reading')]
    const tasks = [task('t1', 1, [draft('d1')], 'running'), task('t2', 1, [draft('d1')], 'completed')]
    expect(projectDecisions({ items, tasks, journal: null })).toEqual([])
  })

  it('等最久的排最上面，同時間維持來源內原順序', () => {
    const items = [
      item('new', 300, [{ ...base, id: 'a', kind: 'note', title: 'A', status: 'wait' }]),
      item('old', 100, [{ ...base, id: 'b', kind: 'note', title: 'B', status: 'wait' }, { ...base, id: 'c', kind: 'note', title: 'C', status: 'wait' }]),
    ]
    const tasks = [task('t', 200, [draft('d')])]
    expect(projectDecisions({ items, tasks, journal: null }).map(entry => entry.key)).toEqual(['collect:old:b', 'collect:old:c', 'draft:t:d', 'collect:new:a'])
  })

  it('同一件事來自兩個收集項目時只列一次，另一個併進 duplicates', () => {
    const items = [
      item('c1', 1, [{ ...base, id: 'p1', kind: 'event', title: '寫  Q4 提案', due: '2026-11-18', time: '14:00', status: 'wait' }]),
      item('c2', 2, [{ ...base, id: 'p9', kind: 'event', title: '寫 q4 提案', due: '2026-11-18', time: '14:00', status: 'wait' }]),
    ]
    const out = projectDecisions({ items, tasks: [], journal: null })
    expect(out).toHaveLength(1)
    expect(out[0].ref).toEqual({ source: 'collect', itemId: 'c1', proposalId: 'p1' })
    expect(out[0].duplicates).toEqual([{ source: 'collect', itemId: 'c2', proposalId: 'p9' }])
  })

  it('不同時間的同標題提案是不同的事', () => {
    const a = { ...base, id: 'a', kind: 'event' as const, title: '開會', time: '10:00' }
    const b = { ...a, id: 'b', time: '11:00' }
    expect(sameThingKey(a)).not.toBe(sameThingKey(b))
  })

  it('任務與時段已經在今日日誌裡就不再問', () => {
    const before = '## 捕捉軌\n\n- [ ] 寫提案 📅 2026-11-18 ⏰ 14:00\n'
    const items = [item('c1', 1, [
      { ...base, id: 'p1', kind: 'event', title: '寫提案', due: '2026-11-18', time: '14:00', status: 'wait' },
      { ...base, id: 'p2', kind: 'task', title: '另一件', status: 'wait' },
    ])]
    expect(projectDecisions({ items, tasks: [], journal: journal(before) }).map(entry => entry.ref)).toEqual([{ source: 'collect', itemId: 'c1', proposalId: 'p2' }])
  })

  it('時段提案帶「今日日誌多出哪一行」的預覽，與 acceptProposal 寫入的位置一致', () => {
    const before = '# 今天\n\n## 捕捉軌\n\n- [ ] 既有任務\n\n## 其他\n'
    const items = [item('c1', 1, [{ ...base, id: 'p1', kind: 'event', title: '寫提案', due: '2026-11-18', time: '14:00', tags: ['q4'], status: 'wait' }])]
    const [entry] = projectDecisions({ items, tasks: [], journal: journal(before) })
    expect(entry.kind).toBe('event')
    expect(entry.when).toBe('11/18 14:00')
    expect(entry.preview).toMatchObject({ type: 'journal', section: '捕捉軌', fileMissing: false })
    if (entry.preview.type !== 'journal') throw new Error('unreachable')
    expect(entry.preview.diff).toEqual({ context: ['- [ ] 既有任務'], removed: [], added: ['- [ ] 寫提案 📅 2026-11-18 ⏰ 14:00 #q4'], hidden: 0 })
  })

  it('任務沒有日期時預覽用今天；今日日誌還沒建立會標出來', () => {
    const items = [item('c1', 1, [{ ...base, id: 'p1', kind: 'task', title: '交預算表', status: 'wait' }])]
    const [entry] = projectDecisions({ items, tasks: [], journal: { before: '', section: '捕捉軌', fileMissing: true, today: '2026-11-18' } })
    if (entry.preview.type !== 'journal') throw new Error('unreachable')
    expect(entry.preview.fileMissing).toBe(true)
    expect(entry.preview.diff.added).toEqual(['- [ ] 交預算表 📅 2026-11-18'])
  })

  it('草稿帶修改前後的差異；非檔案內容的草稿沒有差異', () => {
    const tasks = [task('t', 1, [draft('d1'), draft('d2', 'pending', { kind: 'move', path: 'a.md', targetPath: 'b.md', content: undefined })])]
    const [first, second] = projectDecisions({ items: [], tasks, journal: null })
    expect(first.preview).toMatchObject({ type: 'file', path: 'Q4/草稿.md', diff: { context: ['a'], removed: ['b'], added: ['B'] } })
    expect(second.preview).toMatchObject({ type: 'file', targetPath: 'b.md', diff: null })
    expect(first.summary).toBe('改第 2 段')
  })

  it('同一份輸入重算結果相同（投影沒有隱藏狀態）', () => {
    const items = [item('c1', 1, [{ ...base, id: 'p1', kind: 'note', title: 'N', status: 'wait' }])]
    const tasks = [task('t', 2, [draft('d')])]
    expect(projectDecisions({ items, tasks, journal: null })).toEqual(projectDecisions({ items, tasks, journal: null }))
  })
})

describe('previewDiff', () => {
  it('新檔：全部都是新增', () => {
    expect(previewDiff('', 'x\ny')).toEqual({ context: [], removed: [], added: ['x', 'y'], hidden: 0 })
  })
  it('超過上限的行數記在 hidden', () => {
    const after = Array.from({ length: 12 }, (_, i) => `l${i}`).join('\n')
    const diff = previewDiff('', after, 5)
    expect(diff.added).toHaveLength(5)
    expect(diff.hidden).toBe(7)
  })
  it('沒有差異時三欄都空', () => {
    expect(previewDiff('a\nb', 'a\nb')).toEqual({ context: [], removed: [], added: [], hidden: 0 })
  })
})

describe('journalInsertPreview', () => {
  it('找不到捕捉軌就附在檔尾', () => {
    const { line, diff } = journalInsertPreview(journal('# 今天\n\n一些字\n'), { ...base, id: 'x', kind: 'task', title: '甲' })
    expect(line).toBe('- [ ] 甲 📅 2026-11-18')
    expect(diff.added).toEqual([line])
  })
})

// Fork（almanac ALMNC-54.5）：提案的來源對話、再次討論、取代與待決定。
describe('ALMNC-54.5 projectProposals', () => {
  const wait = (id: string, extra: Partial<CollectItemLike['proposals'][number]> = {}) =>
    ({ ...base, id, kind: 'task' as const, title: `事 ${id}`, status: 'wait' as const, ...extra })

  it('AC#1: every source carries its conversation (collect field, task, job threadKey, or the discussion trail)', () => {
    const items = [item('c1', 1, [wait('p1', { conversationId: 4 }), wait('p2')])]
    const tasks = [{ ...task('t1', 2, [draft('d1')]), conversationId: 5 }]
    const jobs = [{
      id: 'j1', threadKey: 'sync-6', title: '工作', createdAt: 3, status: 'running',
      steps: [{ id: 's1', title: '步驟', criterion: '條件', status: 'review', result: '結果', finishedAt: 3 }],
    }] as unknown as NonNullable<Parameters<typeof projectProposals>[0]['jobs']>
    const out = projectProposals({
      items, tasks, jobs, journal: null,
      conversations: [{ id: 6, syncId: 'sync-6' }],
      trail: { 'collect:c1:p2': { conversationId: 9 } },
    })
    expect(out.map(entry => [entry.key, entry.conversationId])).toEqual([
      ['collect:c1:p1', 4], ['collect:c1:p2', 9], ['draft:t1:d1', 5], ['job:j1:s1', 6],
    ])
    expect(out.every(entry => entry.status === 'wait')).toBe(true)
  })

  it('AC#2: a discussing proposal leaves the workbench list but stays pending with its note', () => {
    const items = [item('c1', 1, [wait('p1', { conversationId: 4 }), wait('p2')])]
    const trail = { 'collect:c1:p1': { conversationId: 4, discussion: { note: '改短', at: 5 } } }
    const pending = projectProposals({ items, tasks: [], journal: null, trail })
    expect(pending.map(entry => [entry.key, entry.status])).toEqual([['collect:c1:p1', 'discussing'], ['collect:c1:p2', 'wait']])
    expect(pending[0].discussion).toEqual({ note: '改短', at: 5 })
    expect(projectDecisions({ items, tasks: [], journal: null, trail }).map(entry => entry.key)).toEqual(['collect:c1:p2'])
  })

  it('AC#2: the revised proposal supersedes the old one (previousProposalId or trail.supersededBy)', () => {
    const items = [
      item('old', 1, [wait('p1', { conversationId: 4 })]),
      item('new', 2, [wait('p1', { conversationId: 4, previousProposalId: 'collect:old:p1', title: '改過的' })]),
      item('x', 3, [wait('p9')]),
    ]
    const trail = { 'collect:old:p1': { conversationId: 4, discussion: { note: '改', at: 1 } }, 'collect:x:p9': { supersededBy: 'draft:t:d' } }
    const out = projectProposals({ items, tasks: [], journal: null, trail })
    expect(out.map(entry => entry.key)).toEqual(['collect:new:p1'])
    expect(out[0].previousProposalId).toBe('collect:old:p1')
  })

  it('shows a body-only revision ahead of deduplication and keeps the original closed after acceptance', () => {
    const items = [
      item('old', 1, [wait('p1', { kind: 'note', title: '同樣的標題', body: '舊內容' })]),
      item('new', 2, [wait('p2', { kind: 'note', title: '同樣的標題', body: '新內容', previousProposalId: 'collect:old:p1' })]),
    ]
    const input = { items, tasks: [], journal: null }
    expect(projectDecisions(input).map(entry => entry.key)).toEqual(['collect:new:p2'])
    items[1].proposals[0].status = 'ok'
    expect(projectDecisions(input)).toEqual([])
  })
})

// Fork（almanac ALMNC-54.7）：右側欄指揮官想改的既有檔案，在工作台顯示成檔案變更並帶來源對話。
describe('file change proposals from the sidebar commander', () => {
  it('projects the change with a file preview and the source conversation', () => {
    const change = { toolName: 'note_update_file', args: {}, kind: 'update' as const, path: '領域/工業工程.md', content: 'a\nB\n', baseContent: 'a\nb\n', summary: '修改 領域/工業工程.md（2 → 2 行）' }
    const items = [item('c1', 10, [{ ...base, id: 'p1', kind: 'note', title: change.summary, status: 'wait', conversationId: 9, change }])]
    const [entry] = projectDecisions({ items, tasks: [], journal: journal('') })
    expect(entry).toMatchObject({ kind: 'update', title: '領域/工業工程.md', summary: change.summary, conversationId: 9 })
    expect(entry.preview).toEqual({ type: 'file', path: '領域/工業工程.md', targetPath: undefined, diff: { context: ['a'], removed: ['b'], added: ['B'], hidden: 0 } })
  })
})

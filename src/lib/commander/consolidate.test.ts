import { describe, expect, it, vi } from 'vitest'
import { proposalNoteContent } from '@/lib/collect/builders'
import { parseItems, serializeItems } from '@/lib/collect/persist'
import { parseV3Note } from '@/lib/v3-model/note'
import { acceptedOutputLinks, consolidate, draftToProposal, linkAcceptedOutputs } from './consolidate'
import type { Draft, Fragment } from './types'

const frag = (partial: Partial<Fragment> = {}): Fragment => ({ index: 0, kind: 'note', title: 't', body: '', people: [], tags: [], ...partial })
const noteDraft: Draft = {
  fragment: frag(), lane: 'C1', role: 'expert', agentId: 'ie', kind: 'note', noteType: 'knowledge',
  title: '產線平衡要先算節拍時間', body: '節拍時間＝可用時間÷需求量', people: ['Amy'], domainIds: ['d-ie'], tags: ['工業工程'],
  meta: { writtenBy: 'ai', similarNotes: 'unavailable' },
}
const eventDraft: Draft = {
  fragment: frag({ kind: 'event' }), lane: 'C3', role: 'secretary', agentId: 'sec', kind: 'event',
  title: '和 Amy 開會', body: '', date: '2026-11-25', time: '10:00', people: ['Amy'], project: '新官網', domainIds: [], tags: [],
  meta: { writtenBy: 'ai' },
}
const source = { id: 'src_1', content: '原文', origin: undefined }

describe('consolidate', () => {
  it('草稿統整成一批提案，記住來源資料源、來源對話、筆記類型、領域與撰寫者', () => {
    const batch = consolidate({ source, drafts: [noteDraft, eventDraft], origin: 'Mia · 指揮官 分析的資料源：原文', conversationId: 7 })!
    expect(batch.id).toBe('commander:src_1')
    expect(batch.conversationId).toBe(7)
    expect(batch.proposals).toHaveLength(2)
    expect(batch.proposals[0]).toMatchObject({
      kind: 'note', noteType: 'knowledge', domains: ['d-ie'], sourceIds: ['src_1'], conversationId: 7,
      people: ['Amy'], drafter: { role: 'expert', agentId: 'ie' },
    })
    expect(batch.proposals[1]).toMatchObject({
      kind: 'event', due: '2026-11-25', time: '10:00', project: '新官網', tags: ['新官網'], drafter: { role: 'secretary', agentId: 'sec' },
    })
    expect(batch.proposals[1].noteType).toBeUndefined()
  })

  it('全部不採用（沒有草稿）時不產生提案', () => {
    expect(consolidate({ source, drafts: [], origin: 'x' })).toBeUndefined()
  })

  it('同一件事只提一次', () => {
    const batch = consolidate({ source, drafts: [noteDraft, { ...noteDraft }], origin: 'x' })!
    expect(batch.proposals).toHaveLength(1)
  })
})

describe('接受後才寫的東西', () => {
  it('筆記內容帶 V3 frontmatter：類型、來源、領域、狀態，加上日期、相關的人、專案', () => {
    const proposal = draftToProposal({ ...noteDraft, noteType: 'record', date: '2026-11-20', project: '新官網' }, ['src_1'])
    const parsed = parseV3Note(proposalNoteContent(proposal))
    expect(parsed.issues).toEqual([])
    expect(parsed.fields).toMatchObject({ type: 'record', sources: ['src_1'], domains: ['d-ie'], status: 'valid', tags: ['工業工程'] })
    expect(parsed.extra).toMatchObject({ date: '2026-11-20', people: ['Amy'], project: '新官網' })
    expect(parsed.body).toContain('# 產線平衡要先算節拍時間')
  })

  it('一般收集提案（沒有來源資料源）的筆記內容不變', () => {
    expect(proposalNoteContent({ id: 'p', kind: 'note', title: 'T', body: 'B', due: '', time: '', tags: [] })).toBe('# T\n\nB\n')
  })

  it('source_outputs 連結：筆記指向寫入的路徑，行動指向「檔案#提案 id」', () => {
    expect(acceptedOutputLinks({ id: 'p1', kind: 'note', sourceIds: ['a', 'b'] }, { path: 'Inbox/x.md' })).toEqual([
      { sourceId: 'a', targetType: 'note', targetRef: 'Inbox/x.md' },
      { sourceId: 'b', targetType: 'note', targetRef: 'Inbox/x.md' },
    ])
    expect(acceptedOutputLinks({ id: 'p2', kind: 'task', sourceIds: ['a'] }, { path: 'Daily/2026-11-21.md' })).toEqual([
      { sourceId: 'a', targetType: 'action', targetRef: 'Daily/2026-11-21.md#p2' },
    ])
    expect(acceptedOutputLinks({ id: 'p3', kind: 'note' }, { path: 'x.md' })).toEqual([])
  })

  it('linkAcceptedOutputs 逐條交給寫入函式', async () => {
    const writer = vi.fn(async () => undefined)
    await linkAcceptedOutputs({ id: 'p1', kind: 'note', sourceIds: ['a'] }, { path: 'x.md' }, writer)
    expect(writer).toHaveBeenCalledWith({ sourceId: 'a', targetType: 'note', targetRef: 'x.md' })
  })

  it('指揮官提案的欄位存檔、讀檔後還在；型別不對的欄位丟掉', () => {
    const proposal = { ...draftToProposal(noteDraft, ['src_1'], 3), status: 'wait' as const }
    const item = { id: 'commander:src_1', input: { kind: 'text' as const, text: '' }, createdAt: Date.now(), state: 'ready' as const, proposals: [proposal] }
    const [restored] = parseItems(serializeItems([item]), Date.now())
    expect(restored.proposals[0]).toMatchObject({
      sourceIds: ['src_1'], noteType: 'knowledge', domains: ['d-ie'], people: ['Amy'], drafter: { role: 'expert', agentId: 'ie' }, conversationId: 3,
    })
    const broken = parseItems([{ ...item, proposals: [{ ...proposal, noteType: 'diary', drafter: { role: 'boss' }, sourceIds: 'src_1' }] }], Date.now())
    expect(broken[0].proposals[0].noteType).toBeUndefined()
    expect(broken[0].proposals[0].drafter).toBeUndefined()
    expect(broken[0].proposals[0].sourceIds).toBeUndefined()
    expect(broken[0].proposals[0].title).toBe(noteDraft.title)
  })
})

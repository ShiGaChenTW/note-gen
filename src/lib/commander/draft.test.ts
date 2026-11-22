import { beforeEach, describe, expect, it, vi } from 'vitest'
import { draft, parseDrafts } from './draft'
import type { Assignment, Fragment, RosterAgent } from './types'

const roster: RosterAgent[] = [
  { id: 'cmd', name: 'Mia', role: 'commander', enabled: true },
  { id: 'sec', name: 'Leo', role: 'secretary', enabled: true },
  { id: 'ie', name: 'Alex', role: 'expert', domain: '工業工程', enabled: true },
]
const frag = (partial: Partial<Fragment>): Fragment => ({ index: 0, kind: 'note', title: 't', body: 'b', people: [], tags: [], ...partial })

const assignments: Assignment[] = [
  { fragment: frag({ index: 0, noteType: 'knowledge', title: '節拍時間', body: '原文 0', domainHint: '工業工程' }), lane: 'C1', agentId: 'ie', domainId: 'd-ie' },
  { fragment: frag({ index: 1, noteType: 'record', title: '拜訪', body: '原文 1', date: '2026-11-20', people: ['Amy'] }), lane: 'C2', agentId: 'cmd' },
  { fragment: frag({ index: 2, kind: 'event', title: '開會', body: '', date: '2026-11-25', time: '10:00' }), lane: 'C3', agentId: 'sec' },
  { fragment: frag({ index: 3, kind: 'reject', title: '廣告' }), lane: 'reject' },
]

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('draft', () => {
  it('每位負責的角色各撰寫一次，用自己的工作指示與記憶；不採用的片段不撰寫', async () => {
    const agentPrompt = vi.fn(async (agent: RosterAgent | undefined, role: string) => `ROLE:${role}:${agent?.name}`)
    const ask = vi.fn(async (prompt: string) => {
      const index = Number(prompt.match(/### index (\d+)/)?.[1])
      return JSON.stringify({ drafts: [{ index, title: `草稿 ${index}`, body: `整理過的 ${index}` }] })
    })
    const drafts = await draft(assignments, { ask, roster, agentPrompt })
    expect(ask).toHaveBeenCalledTimes(3)
    expect(agentPrompt.mock.calls.map(call => call[1])).toEqual(['expert', 'commander', 'secretary'])
    expect((ask.mock.calls[0][0] as string).startsWith('ROLE:expert:Alex')).toBe(true)
    expect(drafts.map(d => [d.lane, d.role, d.agentId, d.kind])).toEqual([
      ['C1', 'expert', 'ie', 'note'],
      ['C2', 'commander', 'cmd', 'note'],
      ['C3', 'secretary', 'sec', 'event'],
    ])
    expect(drafts[0]).toMatchObject({ title: '草稿 0', body: '整理過的 0', noteType: 'knowledge', domainIds: ['d-ie'], meta: { writtenBy: 'ai' } })
    expect(drafts[1]).toMatchObject({ noteType: 'record', date: '2026-11-20', people: ['Amy'] })
    expect(drafts[2]).toMatchObject({ date: '2026-11-25', time: '10:00', body: '' })
  })

  it('專家沒有「依領域找類似筆記」的工具時標成 unavailable，不假裝比對過', async () => {
    const drafts = await draft(assignments.slice(0, 1), { ask: async () => '{}', roster, agentPrompt: async () => '' })
    expect(drafts[0].meta.similarNotes).toBe('unavailable')
  })

  it('有工具時把類似筆記放進提示並記在草稿裡', async () => {
    const findSimilarNotes = vi.fn(async () => [{ path: 'notes/takt.md', title: '節拍時間計算' }])
    const ask = vi.fn<(prompt: string) => Promise<string>>(async () => '{}')
    const drafts = await draft(assignments.slice(0, 1), { ask, roster, agentPrompt: async () => '', findSimilarNotes })
    expect(findSimilarNotes).toHaveBeenCalledWith('d-ie', assignments[0].fragment)
    expect(ask.mock.calls[0][0]).toContain('節拍時間計算 (notes/takt.md)')
    expect(drafts[0].meta.similarNotes).toEqual([{ path: 'notes/takt.md', title: '節拍時間計算' }])
  })

  it('模型失敗或漏寫某一段時，那一段用片段內容，內容不會掉', async () => {
    const drafts = await draft(assignments, { ask: async () => { throw new Error('offline') }, roster, agentPrompt: async () => '' })
    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toMatchObject({ title: '節拍時間', body: '原文 0', meta: { writtenBy: 'fallback' } })
    expect(drafts[1]).toMatchObject({ title: '拜訪', body: '原文 1', meta: { writtenBy: 'fallback' } })
  })

  it('秘書：沒有時間的就是任務', async () => {
    const task: Assignment = { fragment: frag({ index: 5, kind: 'task', title: '寄報價單', date: '2026-11-22' }), lane: 'C3', agentId: 'sec' }
    const [d] = await draft([task], { ask: async () => '{"drafts":[{"index":5,"title":"寄出報價單","date":"2026-11-23"}]}', roster, agentPrompt: async () => '' })
    expect(d).toMatchObject({ kind: 'task', title: '寄出報價單', date: '2026-11-23' })
    expect(d.time).toBeUndefined()
  })
})

describe('parseDrafts', () => {
  it('只收有 index 與標題的；日期時間格式不對就丟掉', () => {
    const parsed = parseDrafts('{"drafts":[{"index":0,"title":"a","date":"11/23","time":"25:00"},{"title":"沒 index"},{"index":"1","title":"b","time":"9:05"}]}')
    expect([...parsed.keys()]).toEqual([0, 1])
    expect(parsed.get(0)).toEqual({ title: 'a', body: '', date: undefined, time: undefined })
    expect(parsed.get(1)?.time).toBe('09:05')
  })
})

describe('保底片段', () => {
  it('不交給模型改寫，原文原封不動', async () => {
    const ask = vi.fn(async () => '{"drafts":[{"index":0,"title":"改寫","body":"摘要"}]}')
    const fallback: Assignment = { fragment: frag({ index: 0, noteType: 'record', title: '原標題', body: '完整原文', fallback: true }), lane: 'C2', agentId: 'cmd' }
    const [d] = await draft([fallback], { ask, roster, agentPrompt: async () => '' })
    expect(ask).not.toHaveBeenCalled()
    expect(d).toMatchObject({ title: '原標題', body: '完整原文', meta: { writtenBy: 'fallback' } })
  })
})

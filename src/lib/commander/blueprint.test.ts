import { describe, expect, it, vi } from 'vitest'
import type { AgentToolExecutionContext } from '@/lib/agent/types'
import { routeByRules } from '@/lib/router/router'
import { buildExploreTool } from './blueprint-chat'
import { requestExplore, setExploreHandler, type ExploreRequest } from '@/lib/domain-page/explore'
import { MOC_HEADINGS } from '@/lib/migration/domain-moc-migration'
import { formalEntries, parseMoc } from '@/lib/moc/parse'
import { createMemoryMocIo } from '@/lib/moc/testing'
import { parseV3Note } from '@/lib/v3-model/note'
import { buildBlueprint, deleteBlueprintChapter, type BlueprintContext } from './blueprint'
import { applyDomainBlueprint, changeExploration } from './blueprint-moc'

const notePath = '10 知識/睡眠節律.md'
const knowledge = '---\ntype: knowledge\n---\n# 睡眠節律\n'
const context: BlueprintContext = {
  notes: [{ path: notePath, title: '睡眠節律' }],
  domains: [{ name: '時間管理', chapters: ['如何維持專注？'] }],
}
const draft = JSON.stringify({
  name: '睡眠科學', positioning: '如何改善睡眠品質？',
  chapters: [
    { question: '節律？', notes: [] },
    { question: '環境？', notes: [] },
    { question: '如何追蹤？', notes: [] },
  ],
})

describe('探索與探索中', () => {
  it.each<ExploreRequest>([
    { origin: 'conversation', topic: '睡眠科學' },
    { origin: 'adjacent', domainId: 'M-1', domainName: '時間管理', topics: ['睡眠科學'] },
    { origin: 'new-domain', topic: '睡眠科學' },
    { origin: 'unassigned', notePaths: [notePath] },
  ])('從 $origin 建立可接受的藍圖', async request => {
    const ask = vi.fn(async () => draft)
    let result: ReturnType<typeof buildBlueprint> | undefined
    const off = setExploreHandler(input => { result = buildBlueprint(input, context, ask, 'blueprint:1', 1) })
    try {
      if (request.origin === 'conversation') {
        expect(routeByRules('我想探索睡眠科學')?.route).toBe('process')
        expect((await buildExploreTool().execute({ topic: request.topic }, {} as AgentToolExecutionContext)).ok).toBe(true)
      } else {
        expect(requestExplore(request)).toBe(true)
      }
      const proposal = (await result)!
      expect(ask.mock.calls[0]).toEqual([expect.stringContaining('時間管理')])
      if (request.origin === 'adjacent') expect(ask.mock.calls[0]).toEqual([expect.stringContaining('如何維持專注？')])
      const io = createMemoryMocIo({ [notePath]: knowledge })
      const created = await applyDomainBlueprint(proposal, io)
      expect(created.path).toBe('20 領域/睡眠科學.md')
      const raw = io.files[created.path]
      const moc = parseMoc(raw, created.path)
      expect(moc.id).toMatch(/^M-/)
      expect(moc.status).toBe('探索中')
      expect(moc.chapters.map(chapter => chapter.id)).toEqual(Array(3).fill(expect.stringMatching(/^C-/)))
      for (const heading of Object.values(MOC_HEADINGS)) expect(raw).toContain(heading)
      expect(raw).toContain('知識缺口：還沒有筆記')
      expect(formalEntries(moc)).toHaveLength(request.origin === 'unassigned' ? 1 : 0)
      expect(parseV3Note(io.files[notePath]).fields.domains).toEqual(request.origin === 'unassigned' ? ['睡眠科學'] : [])
    } finally {
      off()
    }
  })

  it('刪章時保留指定筆記，並移除該題的閱讀順序', async () => {
    const proposal = await buildBlueprint({ origin: 'unassigned', notePaths: [notePath] }, context, async () => draft, 'ref', 1)
    const chapters = deleteBlueprintChapter(proposal.chapters, 0)
    expect(chapters.map(chapter => chapter.question)).toEqual(['環境？', '如何追蹤？'])
    expect(chapters.flatMap(chapter => chapter.notes).map(note => note.path)).toEqual([notePath])
  })

  it('模型漏掉指定筆記時，依筆記名稱與章節問題重新配對', async () => {
    const proposal = await buildBlueprint({ origin: 'unassigned', notePaths: [notePath] }, context,
      async () => draft.replace('節律？', '光線？').replace('如何追蹤？', '如何穩定睡眠節律？'), 'ref', 1)
    expect(proposal.chapters[2].notes.map(note => note.path)).toEqual([notePath])
  })

  it('撤回時重讀收錄的筆記，保留別的領域，即使索引尚未更新', async () => {
    const proposal = await buildBlueprint({ origin: 'unassigned', notePaths: [notePath] }, context, async () => draft, 'ref', 1)
    const io = createMemoryMocIo({ [notePath]: knowledge.replace('type: knowledge', 'type: knowledge\ndomains: [另一個領域]') })
    const created = await applyDomainBlueprint(proposal, io)
    io.listNotes = async () => [{ path: notePath, domains: ['另一個領域'] }]
    await changeExploration(io, created, 'withdraw')
    expect(parseV3Note(io.files[notePath]).fields.domains).toEqual(['另一個領域'])
  })

  it('轉正保留章節與歸屬，撤回移除檔案與該領域歸屬', async () => {
    const proposal = await buildBlueprint({ origin: 'unassigned', notePaths: [notePath] }, context, async () => draft, 'ref', 1)
    const io = createMemoryMocIo({ [notePath]: knowledge })
    const created = await applyDomainBlueprint(proposal, io)
    const before = io.files[created.path]
    await changeExploration(io, created, 'promote')
    expect(io.files[created.path]).not.toContain('status: 探索中')
    expect(parseV3Note(io.files[notePath]).fields.domains).toEqual(['睡眠科學'])
    await expect(changeExploration(io, created, 'withdraw')).rejects.toThrow()
    io.files[created.path] = before
    await changeExploration(io, created, 'withdraw')
    expect(io.files[created.path]).toBeUndefined()
    expect(parseV3Note(io.files[notePath]).fields.domains).toEqual([])
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { Proposal } from '@/lib/collect/types'
import { reviseProposal } from './revise'

describe('reviseProposal', () => {
  it('revises file content using the commander’s instructions and keeps the original operation and conflict check', async () => {
    const original: Proposal = {
      id: 'p1', kind: 'note', title: '改筆記', body: '', due: '', time: '', tags: [],
      change: {
        toolName: 'note_update_file', args: { filePath: 'a.md', content: '初稿' },
        kind: 'update', path: 'a.md', baseContent: '原文', content: '初稿', summary: '改筆記',
      },
    }
    const ask = vi.fn(async () => JSON.stringify({
      file: { content: '修訂版', filePath: 'b.md', toolName: 'note_delete_file' },
      sourceIds: ['arbitrary'],
    }))
    const result = await reviseProposal({
      original, key: 'collect:c1:p1', conversationId: 7, note: '用上面說的措辭',
      history: [{ role: 'user', content: '請稱它為工作台' }],
    }, {
      ask, roster: async () => [], agentPrompt: async () => '指揮官的工作指示',
    })
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('請稱它為工作台'))
    expect(result.proposal).toMatchObject({
      conversationId: 7, previousProposalId: 'collect:c1:p1',
      change: {
        toolName: 'note_update_file', args: { filePath: 'a.md', content: '修訂版' },
        kind: 'update', path: 'a.md', baseContent: '原文', content: '修訂版',
      },
    })
    expect(result.proposal).not.toHaveProperty('sourceIds')
    expect(original.change?.args.content).toBe('初稿')
  })
})

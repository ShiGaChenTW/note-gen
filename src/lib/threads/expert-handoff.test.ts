// Fork（almanac ALMNC-91）：專家提議轉給指揮官的判斷邏輯。AI 的判斷用固定回應（直接執行工具），不打 AI。
import { describe, expect, it, vi } from 'vitest'
import { buildExpertHandoffTool, expertHandoffQuestion, EXPERT_HANDOFF_TOOL_NAME } from './expert-handoff'

const context = { runId: 'test', context: { userInput: '' } } as never

describe('buildExpertHandoffTool', () => {
  it('is a read-only system tool, so the expert keeps it in read-only answers', () => {
    const tool = buildExpertHandoffTool(vi.fn())
    expect(tool.name).toBe(EXPERT_HANDOFF_TOOL_NAME)
    expect(tool.risk).toBe('read')
    expect(tool.category).toBe('system')
  })

  it('records the suggestion when the expert (fixed AI response) passes a reason', async () => {
    const onSuggest = vi.fn()
    const result = await buildExpertHandoffTool(onSuggest).execute({ reason: '  需要今天的\n即時匯率 ' }, context)
    expect(result.ok).toBe(true)
    expect(onSuggest).toHaveBeenCalledWith('需要今天的 即時匯率')
  })

  it('rejects an empty reason and records nothing', async () => {
    const onSuggest = vi.fn()
    const result = await buildExpertHandoffTool(onSuggest).execute({ reason: '   ' }, context)
    expect(result.ok).toBe(false)
    expect(onSuggest).not.toHaveBeenCalled()
  })
})

describe('expertHandoffQuestion', () => {
  const chats = [
    { id: 1, role: 'user', type: 'chat', content: '產線平衡怎麼算？' },
    { id: 2, role: 'system', type: 'chat', content: '筆記裡有。' },
    { id: 3, role: 'user', type: 'chat', content: '  今天美元匯率多少？ ' },
    { id: 4, role: 'system', type: 'chat', content: '筆記庫沒有匯率。' },
  ]
  const flagged = new Set([4])

  it('returns the original question for a flagged expert answer in a query conversation', () => {
    expect(expertHandoffQuestion('query', chats, 4, flagged)).toBe('今天美元匯率多少？')
  })

  it('does not ask when the expert did not flag the answer', () => {
    expect(expertHandoffQuestion('query', chats, 2, flagged)).toBeNull()
  })

  it('only asks in query conversations', () => {
    expect(expertHandoffQuestion('process', chats, 4, flagged)).toBeNull()
    expect(expertHandoffQuestion('schedule', chats, 4, flagged)).toBeNull()
  })

  it('does not ask again once Scott said no for that message', () => {
    expect(expertHandoffQuestion('query', chats, 4, flagged, new Set([4]))).toBeNull()
  })

  it('stops asking about an older answer once Scott asks something else', () => {
    const later = [...chats, { id: 5, role: 'user', type: 'chat', content: '那歐元呢？' }]
    expect(expertHandoffQuestion('query', later, 4, flagged)).toBeNull()
  })

  it('skips non-chat entries when looking for the question, and gives up without one', () => {
    const withNote = [chats[2], { id: 9, role: 'user', type: 'note', content: '附註' }, chats[3]]
    expect(expertHandoffQuestion('query', withNote, 4, flagged)).toBe('今天美元匯率多少？')
    expect(expertHandoffQuestion('query', [chats[3]], 4, flagged)).toBeNull()
    expect(expertHandoffQuestion('query', chats, 99, new Set([99]))).toBeNull()
  })
})

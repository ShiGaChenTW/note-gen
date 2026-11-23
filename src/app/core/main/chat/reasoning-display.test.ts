// Fork（almanac ALMNC-74）
import { describe, expect, it } from 'vitest'
import { getReasoningLabel, getReasoningPhase, isReasoningExpanded } from './reasoning-display'
import { computeReasoningDuration } from '@/lib/agent/reasoning-duration'
import { retainCompletedAgentTraceEvents } from '@/lib/agent/trace-retention'

describe('reasoning display', () => {
  it('only treats a running event without a duration as still thinking', () => {
    expect(getReasoningPhase({ status: 'running' }, true)).toBeNull()
    expect(getReasoningPhase({ status: 'running', reasoning: '  ' }, true)).toBeNull()
    expect(getReasoningPhase({ status: 'running', reasoning: '想' }, true)).toBe('thinking')
    expect(getReasoningPhase({ status: 'running', reasoning: '想', reasoningDuration: 10 }, true)).toBe('done')
    expect(getReasoningPhase({ status: 'running', reasoning: '想' }, false)).toBe('done')
    expect(getReasoningPhase({ status: 'success', reasoning: '想' }, true)).toBe('done')
  })

  it('formats the duration, falling back for records without one', () => {
    expect(getReasoningLabel('thinking', 5_000)).toEqual({ key: 'thinking' })
    expect(getReasoningLabel('done', undefined)).toEqual({ key: 'reasoning' })
    expect(getReasoningLabel('done', Number.NaN)).toEqual({ key: 'reasoning' })
    expect(getReasoningLabel('done', 0)).toEqual({ key: 'thoughtBriefly' })
    expect(getReasoningLabel('done', 999)).toEqual({ key: 'thoughtBriefly' })
    expect(getReasoningLabel('done', 1_000)).toEqual({ key: 'thoughtFor', seconds: 1 })
    expect(getReasoningLabel('done', 12_499)).toEqual({ key: 'thoughtFor', seconds: 12 })
    expect(getReasoningLabel('done', 12_500)).toEqual({ key: 'thoughtFor', seconds: 13 })
  })

  it('prefers the reader\'s choice over the automatic state', () => {
    expect(isReasoningExpanded(undefined, 'thinking')).toBe(true)
    expect(isReasoningExpanded(undefined, 'done')).toBe(false)
    expect(isReasoningExpanded(false, 'thinking')).toBe(false)
    expect(isReasoningExpanded(true, 'done')).toBe(true)
  })

  it('measures thinking from the request until the reply starts', () => {
    expect(computeReasoningDuration({ startedAt: 1_000, endedAt: 4_000, now: 9_000, hasReasoning: true })).toBe(3_000)
    expect(computeReasoningDuration({ startedAt: 1_000, endedAt: 0, now: 9_000, hasReasoning: true })).toBe(8_000)
    expect(computeReasoningDuration({ startedAt: 1_000, endedAt: 4_000, now: 9_000, hasReasoning: false })).toBeUndefined()
    expect(computeReasoningDuration({ startedAt: 0, endedAt: 0, now: 9_000, hasReasoning: true })).toBeUndefined()
    expect(computeReasoningDuration({ startedAt: 5_000, endedAt: 4_000, now: 9_000, hasReasoning: true })).toBe(0)
  })

  it('keeps the duration in the saved history so reopened chats can show it', () => {
    const [kept] = retainCompletedAgentTraceEvents([{
      id: 'm', runId: 'r', type: 'model_response', status: 'success', title: '模型响应', timestamp: 1,
      reasoning: '想', reasoningDuration: 4_200, output: '最終回覆', isIntermediateResponse: false,
    }])
    expect(kept?.reasoningDuration).toBe(4_200)
  })
})

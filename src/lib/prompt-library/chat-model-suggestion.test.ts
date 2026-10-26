import { describe, expect, it } from 'vitest'
import type { AiConfig } from '@/app/core/setting/config'
import { parsePromptModelSuggestion, resolvePromptModelSuggestion } from './chat-model-suggestion'

function aiModelList(): AiConfig[] {
  return [
    {
      key: 'config-a',
      title: 'Provider A',
      baseURL: 'https://a.example.com',
      models: [
        { id: 'model-uuid-1', model: 'claude-sonnet-5-5', modelType: 'chat', temperature: 0.7 },
        { id: 'model-uuid-2', model: 'gpt-4o', modelType: 'chat' },
      ],
    },
  ]
}

describe('parsePromptModelSuggestion', () => {
  it('reads model and temperature from frontmatter', () => {
    expect(parsePromptModelSuggestion({ model: 'claude-sonnet-5-5', temperature: 0.3 })).toEqual({
      modelRef: 'claude-sonnet-5-5',
      temperature: 0.3,
    })
  })

  it('returns null when model is missing or not a non-empty string', () => {
    expect(parsePromptModelSuggestion(null)).toBeNull()
    expect(parsePromptModelSuggestion({})).toBeNull()
    expect(parsePromptModelSuggestion({ model: '' })).toBeNull()
    expect(parsePromptModelSuggestion({ model: '   ' })).toBeNull()
    expect(parsePromptModelSuggestion({ model: 42 })).toBeNull()
  })

  it('drops a temperature that is not a finite number', () => {
    expect(parsePromptModelSuggestion({ model: 'gpt-4o', temperature: 'high' })).toEqual({
      modelRef: 'gpt-4o',
      temperature: undefined,
    })
    expect(parsePromptModelSuggestion({ model: 'gpt-4o', temperature: Number.POSITIVE_INFINITY })).toEqual({
      modelRef: 'gpt-4o',
      temperature: undefined,
    })
  })

  it('trims the model reference', () => {
    expect(parsePromptModelSuggestion({ model: '  claude-sonnet-5-5  ' })?.modelRef).toBe('claude-sonnet-5-5')
  })
})

describe('resolvePromptModelSuggestion', () => {
  it('matches a model entry by its model string, case-insensitively', () => {
    const resolved = resolvePromptModelSuggestion(
      { modelRef: 'Claude-Sonnet-5-5', temperature: 0.2 },
      aiModelList(),
    )
    expect(resolved).toEqual({
      modelId: 'model-uuid-1',
      modelLabel: 'claude-sonnet-5-5',
      temperature: 0.2,
    })
  })

  it('returns null when no model entry matches', () => {
    expect(resolvePromptModelSuggestion({ modelRef: 'unknown-model' }, aiModelList())).toBeNull()
  })

  it('returns null when there is no model list', () => {
    expect(resolvePromptModelSuggestion({ modelRef: 'claude-sonnet-5-5' }, undefined)).toBeNull()
  })

  it('carries through an undefined temperature unchanged', () => {
    const resolved = resolvePromptModelSuggestion({ modelRef: 'gpt-4o' }, aiModelList())
    expect(resolved).toEqual({ modelId: 'model-uuid-2', modelLabel: 'gpt-4o', temperature: undefined })
  })
})

import { describe, expect, it } from 'vitest'
import type { Mark } from './marks'
import { validateRecordSnapshot } from './record-snapshot'

function baseMark(overrides: Partial<Mark> = {}): Mark {
  return {
    id: 1,
    tagId: 1,
    type: 'text',
    content: 'hello',
    desc: '',
    url: '',
    deleted: 0,
    createdAt: Date.now(),
    sourceId: 'source-1',
    ...overrides,
  }
}

describe('validateRecordSnapshot', () => {
  it('accepts every known mark type, including prompt-draft (#55)', () => {
    const types: Mark['type'][] = ['scan', 'text', 'image', 'link', 'file', 'recording', 'todo', 'prompt-draft']
    const marks = types.map((type, index) => baseMark({ id: index + 1, type, sourceId: `source-${index}` }))
    expect(() => validateRecordSnapshot(marks)).not.toThrow()
  })

  it('rejects an unknown record type', () => {
    const marks = [baseMark({ type: 'not-a-real-type' as Mark['type'] })]
    expect(() => validateRecordSnapshot(marks)).toThrow()
  })
})

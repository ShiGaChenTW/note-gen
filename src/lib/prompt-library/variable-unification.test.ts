import { describe, expect, it } from 'vitest'
import {
  applyVariableUnifications,
  findVariableUnificationCandidates,
  groupVariableUnificationCandidates,
} from './variable-unification'

describe('findVariableUnificationCandidates', () => {
  it('finds the bracket style', () => {
    const candidates = findVariableUnificationCandidates('請幫我寫一篇關於 [主題] 的文章')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ style: 'bracket', raw: '[主題]', variableName: '主題', replacement: '{{主題}}' })
  })

  it('finds the angle bracket style', () => {
    const candidates = findVariableUnificationCandidates('Write about <topic>')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ style: 'angle', raw: '<topic>', variableName: 'topic', replacement: '{{topic}}' })
  })

  it('finds the single-brace style without matching {{...}}', () => {
    const candidates = findVariableUnificationCandidates('Write about {topic} and {{already}}')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ style: 'brace', raw: '{topic}', variableName: 'topic' })
  })

  it('finds the dollar style and lowercases screaming-case names', () => {
    const candidates = findVariableUnificationCandidates('Write about $TOPIC please')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ style: 'dollar', raw: '$TOPIC', variableName: 'topic', replacement: '{{topic}}' })
  })

  it('does not treat a markdown link as a bracket placeholder', () => {
    expect(findVariableUnificationCandidates('see [docs](https://example.com)')).toEqual([])
  })

  it('does not treat a markdown image as a bracket placeholder', () => {
    expect(findVariableUnificationCandidates('![alt](https://example.com/x.png)')).toEqual([])
  })

  it('does not treat a todo checkbox as a bracket placeholder', () => {
    expect(findVariableUnificationCandidates('- [ ] do it\n- [x] done')).toEqual([])
  })

  it('does not treat a common HTML tag as an angle placeholder', () => {
    expect(findVariableUnificationCandidates('line one<br>line two')).toEqual([])
  })

  it('skips candidates inside a fenced code block', () => {
    const body = ['```', '[主題] <topic> {topic} $TOPIC', '```'].join('\n')
    expect(findVariableUnificationCandidates(body)).toEqual([])
  })

  it('skips candidates inside inline code', () => {
    expect(findVariableUnificationCandidates('use `[主題]` here')).toEqual([])
  })

  it('finds every style in the same document, in order of appearance', () => {
    const body = '$TOPIC then [主題] then <topic> then {topic}'
    const candidates = findVariableUnificationCandidates(body)
    expect(candidates.map(c => c.style)).toEqual(['dollar', 'bracket', 'angle', 'brace'])
    expect(candidates.every((c, i) => i === 0 || c.start > candidates[i - 1].start)).toBe(true)
  })
})

describe('groupVariableUnificationCandidates', () => {
  it('groups different spellings of the same normalized variable name', () => {
    const candidates = findVariableUnificationCandidates('<topic> ... {topic} ... $TOPIC')
    const groups = groupVariableUnificationCandidates(candidates)
    expect(groups).toHaveLength(1)
    expect(groups[0].variableName).toBe('topic')
    expect(groups[0].rawVariants).toEqual(['<topic>', '{topic}', '$TOPIC'])
    expect(groups[0].occurrences).toHaveLength(3)
  })

  it('keeps distinct variable names in separate groups, ordered by first occurrence', () => {
    const candidates = findVariableUnificationCandidates('[語氣] then [主題]')
    const groups = groupVariableUnificationCandidates(candidates)
    expect(groups.map(g => g.variableName)).toEqual(['語氣', '主題'])
  })
})

describe('applyVariableUnifications', () => {
  it('replaces only the accepted occurrences, leaving the rest byte-for-byte unchanged', () => {
    const body = '寫一篇關於 [主題] 的文章，標題也要有 [主題]。'
    const candidates = findVariableUnificationCandidates(body)
    expect(candidates).toHaveLength(2)

    const onlyFirst = applyVariableUnifications(body, candidates, new Set([candidates[0].id]))
    expect(onlyFirst).toBe('寫一篇關於 {{主題}} 的文章，標題也要有 [主題]。')
  })

  it('leaves the text completely unchanged when nothing is accepted', () => {
    const body = 'Write about <topic> and {topic} and $TOPIC and [主題]'
    const candidates = findVariableUnificationCandidates(body)
    expect(applyVariableUnifications(body, candidates, new Set())).toBe(body)
  })

  it('applies every accepted occurrence across mixed styles', () => {
    const body = 'A: <topic>. B: {topic}. C: $TOPIC.'
    const candidates = findVariableUnificationCandidates(body)
    const accepted = new Set(candidates.map(c => c.id))
    expect(applyVariableUnifications(body, candidates, accepted)).toBe('A: {{topic}}. B: {{topic}}. C: {{topic}}.')
  })

  it('does not touch text outside of code blocks when candidates inside code are (impossibly) accepted', () => {
    const body = ['before [主題]', '```', '[主題]', '```', 'after'].join('\n')
    const candidates = findVariableUnificationCandidates(body)
    expect(candidates).toHaveLength(1) // the one inside the fence was never detected
    const applied = applyVariableUnifications(body, candidates, new Set(candidates.map(c => c.id)))
    expect(applied).toBe(['before {{主題}}', '```', '[主題]', '```', 'after'].join('\n'))
  })
})

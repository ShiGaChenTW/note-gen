// almanac：V3 筆記工具列「標籤」——讀寫 frontmatter 的 tags。
import { describe, expect, it } from 'vitest'
import { addTag, normalizeTagInput, planTagsWrite, readFrontmatterTags, removeTagAt } from './note-tags'

describe('normalizeTagInput / addTag / removeTagAt', () => {
  it('trims and drops a leading #', () => {
    expect(normalizeTagInput('  #idea ')).toBe('idea')
    expect(normalizeTagInput('##work/client')).toBe('work/client')
    expect(normalizeTagInput('#')).toBe('')
  })

  it('appends new tags and skips empty or duplicate ones (case-insensitive)', () => {
    expect(addTag(['a'], ' #b ')).toEqual(['a', 'b'])
    expect(addTag(['Idea'], 'idea')).toEqual(['Idea'])
    expect(addTag(['a'], '  ')).toEqual(['a'])
  })

  it('removes by position', () => {
    expect(removeTagAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
    expect(removeTagAt(['a'], 5)).toEqual(['a'])
  })
})

describe('readFrontmatterTags', () => {
  it('reads a block list, a flow list and a single value', () => {
    expect(readFrontmatterTags('---\ntitle: x\ntags:\n  - a\n  - "#b"\n---\n')).toEqual({ tags: ['a', 'b'], editable: true })
    expect(readFrontmatterTags('---\ntags: [a, b]\n---\n')).toEqual({ tags: ['a', 'b'], editable: true })
    expect(readFrontmatterTags('---\ntags: solo\n---\n')).toEqual({ tags: ['solo'], editable: true })
  })

  it('treats a missing frontmatter or missing tags as no tags', () => {
    expect(readFrontmatterTags(null)).toEqual({ tags: [], editable: true })
    expect(readFrontmatterTags('---\ntitle: x\n---\n')).toEqual({ tags: [], editable: true })
    expect(readFrontmatterTags('---\ntags:\n---\n')).toEqual({ tags: [], editable: true })
  })

  it('is read-only when the YAML cannot be edited field by field', () => {
    expect(readFrontmatterTags('---\ntags: &t [a]\n---\n').editable).toBe(false)
    expect(readFrontmatterTags('---\n{tags: [a]}\n---\n').editable).toBe(false)
    expect(readFrontmatterTags('---\ntags: [a\n---\n').editable).toBe(false)
  })
})

describe('planTagsWrite', () => {
  it('rewrites only the tags line and keeps other properties and comments', () => {
    const raw = '---\ntitle: Hello # keep\ntags:\n  - a\ndate: 2026-01-01\n---\n'
    const plan = planTagsWrite(raw, ['a', 'b'])
    expect(plan).toEqual({ kind: 'update', raw: '---\ntitle: Hello # keep\ntags:\n  - a\n  - b\ndate: 2026-01-01\n---\n' })
  })

  it('keeps the flow style of an existing flow list', () => {
    expect(planTagsWrite('---\ntags: [a]\n---\n', ['a', 'b'])).toEqual({ kind: 'update', raw: '---\ntags: [a, b]\n---\n' })
  })

  it('adds a tags property to frontmatter that has none', () => {
    expect(planTagsWrite('---\ntitle: x\n---\n', ['a'])).toEqual({ kind: 'update', raw: '---\ntitle: x\ntags:\n  - a\n---\n' })
  })

  it('leaves an empty list after removing the last tag, like the property card', () => {
    expect(planTagsWrite('---\ntags:\n  - a\n---\n', [])).toEqual({ kind: 'update', raw: '---\ntags: []\n---\n' })
  })

  it('creates a frontmatter block only when there is a tag to write', () => {
    expect(planTagsWrite(null, ['a'])).toEqual({ kind: 'insert', raw: '---\ntags:\n  - a\n---\n' })
    expect(planTagsWrite(null, [])).toEqual({ kind: 'none' })
  })

  it('reports no change when the tags are the same', () => {
    expect(planTagsWrite('---\ntags:\n  - a\n---\n', ['a'])).toEqual({ kind: 'none' })
  })

  it('throws when the tags cannot be edited field by field', () => {
    expect(() => planTagsWrite('---\ntags: &t [a]\n---\n', ['a', 'b'])).toThrow()
  })
})

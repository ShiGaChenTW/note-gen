import { describe, expect, it } from 'vitest'
import type { IndexedNote } from '@/lib/vault-index/index-note'
import { parseFrontmatterData } from '@/lib/vault-index/index-note'
import {
  collectPromptNotes,
  collectUnlistedPromptNotes,
  isInPromptFolder,
  isPromptNote,
  isUnlistedPromptNote,
  newPromptContent,
  promptTitle,
  sortPromptNotes,
} from './prompt-note'

function note(path: string, frontmatter: Record<string, unknown> | null = null): IndexedNote {
  return { path, mtime: 0, frontmatter, tasks: [], links: [], aliases: [], tags: [], headings: [], blockIds: [] }
}

describe('isInPromptFolder', () => {
  it('matches notes directly inside the folder', () => {
    expect(isInPromptFolder('Prompts/a.md', 'Prompts')).toBe(true)
    expect(isInPromptFolder('Prompts/sub/a.md', 'Prompts')).toBe(true)
  })

  it('does not match the folder name as a prefix of a sibling folder', () => {
    expect(isInPromptFolder('Prompts2/a.md', 'Prompts')).toBe(false)
  })

  it('treats an unset folder as "the whole vault counts"', () => {
    expect(isInPromptFolder('anywhere/a.md', '')).toBe(true)
  })

  it('normalizes leading/trailing slashes in the setting', () => {
    expect(isInPromptFolder('Prompts/a.md', '/Prompts/')).toBe(true)
  })
})

describe('isPromptNote / isUnlistedPromptNote', () => {
  it('requires both the folder and frontmatter type', () => {
    expect(isPromptNote(note('Prompts/a.md', { type: 'prompt' }), 'Prompts')).toBe(true)
    expect(isPromptNote(note('Prompts/a.md', { type: 'other' }), 'Prompts')).toBe(false)
    expect(isPromptNote(note('Other/a.md', { type: 'prompt' }), 'Prompts')).toBe(false)
    expect(isPromptNote(note('Prompts/a.md', null), 'Prompts')).toBe(false)
  })

  it('flags type:prompt notes outside the folder as unlisted', () => {
    expect(isUnlistedPromptNote(note('Other/a.md', { type: 'prompt' }), 'Prompts')).toBe(true)
    expect(isUnlistedPromptNote(note('Prompts/a.md', { type: 'prompt' }), 'Prompts')).toBe(false)
    expect(isUnlistedPromptNote(note('Other/a.md', { type: 'other' }), 'Prompts')).toBe(false)
  })
})

describe('collectPromptNotes / collectUnlistedPromptNotes', () => {
  const notes = [
    note('Prompts/a.md', { type: 'prompt' }),
    note('Prompts/b.md', { type: 'other' }),
    note('Other/c.md', { type: 'prompt' }),
  ]

  it('splits notes into in-library and unlisted', () => {
    expect(collectPromptNotes(notes, 'Prompts').map(n => n.path)).toEqual(['Prompts/a.md'])
    expect(collectUnlistedPromptNotes(notes, 'Prompts').map(n => n.path)).toEqual(['Other/c.md'])
  })
})

describe('promptTitle', () => {
  it('prefers frontmatter.title over the filename', () => {
    expect(promptTitle(note('Prompts/a.md', { title: '寫作助手' }))).toBe('寫作助手')
  })

  it('falls back to the filename without extension', () => {
    expect(promptTitle(note('Prompts/my-prompt.md'))).toBe('my-prompt')
  })
})

describe('sortPromptNotes', () => {
  const a = note('Prompts/a.md', { title: 'A' })
  const b = note('Prompts/b.md', { title: 'B' })
  const c = note('Prompts/c.md', { title: 'C' })
  const usage = new Map([
    ['Prompts/a.md', { useCount: 5, lastUsedAt: 100 }],
    ['Prompts/b.md', { useCount: 10, lastUsedAt: 50 }],
  ])

  it('sorts by use count descending for mostUsed, treating missing usage as 0', () => {
    expect(sortPromptNotes([a, b, c], usage, 'mostUsed').map(n => n.path)).toEqual(['Prompts/b.md', 'Prompts/a.md', 'Prompts/c.md'])
  })

  it('sorts by last-used time descending for recentlyUsed', () => {
    expect(sortPromptNotes([a, b, c], usage, 'recentlyUsed').map(n => n.path)).toEqual(['Prompts/a.md', 'Prompts/b.md', 'Prompts/c.md'])
  })

  it('sorts by title for the title mode', () => {
    expect(sortPromptNotes([c, a, b], usage, 'title').map(n => n.path)).toEqual(['Prompts/a.md', 'Prompts/b.md', 'Prompts/c.md'])
  })

  it('does not mutate the input array', () => {
    const input = [c, a, b]
    sortPromptNotes(input, usage, 'title')
    expect(input).toEqual([c, a, b])
  })
})

describe('newPromptContent', () => {
  it('produces frontmatter that parses with type: prompt and an empty variables list', () => {
    const content = newPromptContent('寫作助手')
    const { block } = (() => {
      const end = content.indexOf('---\n', 4) + 4
      return { block: content.slice(0, end) }
    })()
    const frontmatter = parseFrontmatterData(block)
    expect(frontmatter?.type).toBe('prompt')
    expect(frontmatter?.variables).toEqual([])
    expect(content).toContain('# 寫作助手')
    expect(content).toContain('## 變數')
  })
})

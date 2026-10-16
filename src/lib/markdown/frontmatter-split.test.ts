import { describe, expect, it } from 'vitest'
import { findFrontmatterEnd, joinFrontmatter, splitFrontmatter } from './frontmatter-split'

const cases: Record<string, { raw: string; block: string }> = {
  'typical': {
    raw: '---\ntitle: A\ntags:\n  - x\n---\n\n# Body\n',
    block: '---\ntitle: A\ntags:\n  - x\n---\n',
  },
  'CRLF': {
    raw: '---\r\ntitle: A\r\n---\r\nBody\r\n',
    block: '---\r\ntitle: A\r\n---\r\n',
  },
  'lone CR': {
    raw: '---\ra: 1\r---\rBody',
    block: '---\ra: 1\r---\r',
  },
  'BOM': {
    raw: '﻿---\na: 1\n---\nBody',
    block: '﻿---\na: 1\n---\n',
  },
  'dots closer': {
    raw: '---\na: 1\n...\nBody',
    block: '---\na: 1\n...\n',
  },
  'empty frontmatter': {
    raw: '---\n---\nBody',
    block: '---\n---\n',
  },
  'closing fence at EOF': {
    raw: '---\na: 1\n---',
    block: '---\na: 1\n---',
  },
  'comments and quotes kept': {
    raw: '---\ntitle: "Acme: 合約"  # 註解\nlinks:\n  - "[[Acme]]"\n---\n內文',
    block: '---\ntitle: "Acme: 合約"  # 註解\nlinks:\n  - "[[Acme]]"\n---\n',
  },
}

describe('splitFrontmatter', () => {
  for (const [name, { raw, block }] of Object.entries(cases)) {
    it(name, () => {
      const split = splitFrontmatter(raw)
      expect(split.block).toBe(block)
      expect(split.block + split.body).toBe(raw)
      expect(joinFrontmatter(split.block, split.body)).toBe(raw)
    })
  }

  it.each([
    ['no frontmatter', '# Title\n---\nnot fm\n---\n'],
    ['unclosed fence', '---\na: 1\nbody without closer\n'],
    ['fence not on first line', '\n---\na: 1\n---\n'],
    ['empty document', ''],
    ['thematic break only', '---'],
  ])('%s', (_name, raw) => {
    expect(findFrontmatterEnd(raw)).toBeNull()
    expect(splitFrontmatter(raw)).toEqual({ block: '', body: raw })
  })
})

describe('joinFrontmatter', () => {
  it('keeps the closing fence on its own line when body is added after EOF fence', () => {
    expect(joinFrontmatter('---\na: 1\n---', 'Body')).toBe('---\na: 1\n---\nBody')
  })

  it('returns body unchanged without a block', () => {
    expect(joinFrontmatter('', 'Body')).toBe('Body')
  })
})

import { describe, expect, it } from 'vitest'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { parseFrontmatterData } from '@/lib/vault-index/index-note'
import { resolvePromptFields } from './variables'
import {
  buildPromptNoteContent,
  normalizePromptOrganizeProposal,
} from './organize'

describe('normalizePromptOrganizeProposal', () => {
  it('normalizes a well-formed AI response', () => {
    const proposal = normalizePromptOrganizeProposal({
      title: '寫一篇部落格文章',
      summary: '依主題寫一篇結構清楚的部落格文章',
      scenarios: ['準備部落格草稿', '社群貼文發想'],
      tags: ['寫作', '部落格'],
      variables: [{ name: 'topic', description: '文章主題' }],
      source: 'https://example.com/post',
      improvementSuggestions: ['可以加上目標讀者說明'],
      commitSummary: '新增「寫部落格文章」提示詞',
    }, { body: '寫一篇關於 {{topic}} 的部落格文章', sourceUrl: 'https://example.com/post', knownVariableNames: ['topic'] })

    expect(proposal).toEqual({
      title: '寫一篇部落格文章',
      summary: '依主題寫一篇結構清楚的部落格文章',
      scenarios: ['準備部落格草稿', '社群貼文發想'],
      tags: ['寫作', '部落格'],
      variables: [{ name: 'topic', description: '文章主題' }],
      source: 'https://example.com/post',
      improvementSuggestions: ['可以加上目標讀者說明'],
      commitSummary: '新增「寫部落格文章」提示詞',
    })
  })

  it('falls back to sane defaults when the AI response is empty or malformed', () => {
    const proposal = normalizePromptOrganizeProposal(null, {
      body: '第一行當標題\n其餘內容',
      knownVariableNames: [],
    })
    expect(proposal.title).toBe('第一行當標題')
    expect(proposal.summary).toBe('')
    expect(proposal.scenarios).toEqual([])
    expect(proposal.tags).toEqual([])
    expect(proposal.variables).toEqual([])
    expect(proposal.source).toBe('')
    expect(proposal.improvementSuggestions).toEqual([])
    expect(proposal.commitSummary).toContain('第一行當標題')
  })

  it('keeps a known variable name even when the AI omits it from variables', () => {
    const proposal = normalizePromptOrganizeProposal({ variables: [] }, {
      body: 'about {{topic}}',
      knownVariableNames: ['topic', 'tone'],
    })
    expect(proposal.variables).toEqual([
      { name: 'topic', description: '' },
      { name: 'tone', description: '' },
    ])
  })

  it('does not duplicate a variable the AI already described', () => {
    const proposal = normalizePromptOrganizeProposal({
      variables: [{ name: 'topic', description: '主題' }],
    }, { body: 'about {{topic}}', knownVariableNames: ['topic'] })
    expect(proposal.variables).toEqual([{ name: 'topic', description: '主題' }])
  })

  it('falls back to the context source URL when the AI omits source', () => {
    const proposal = normalizePromptOrganizeProposal({}, {
      body: 'text',
      sourceUrl: 'https://example.com',
      knownVariableNames: [],
    })
    expect(proposal.source).toBe('https://example.com')
  })
})

describe('buildPromptNoteContent', () => {
  it('builds frontmatter, title, body and the 變數 section', () => {
    const content = buildPromptNoteContent({
      title: '寫部落格文章',
      tags: ['寫作', '部落格'],
      variableNames: ['topic', 'tone'],
      body: '寫一篇關於 {{topic}} 的文章，語氣要 {{tone}}。',
      summary: '依主題寫文章',
      scenarios: ['準備草稿'],
      source: 'https://example.com',
      variableDescriptions: new Map([['topic', '文章主題'], ['tone', '']]),
    })

    const { block, body } = splitFrontmatter(content)
    const frontmatter = parseFrontmatterData(block)
    expect(frontmatter).toMatchObject({
      type: 'prompt',
      tags: ['寫作', '部落格'],
      variables: ['topic', 'tone'],
      summary: '依主題寫文章',
      scenarios: ['準備草稿'],
      source: 'https://example.com',
    })
    expect(body).toContain('# 寫部落格文章')
    expect(body).toContain('寫一篇關於 {{topic}} 的文章，語氣要 {{tone}}。')
    expect(body).toContain('## 變數')
    expect(body).toContain('### topic')
    expect(body).toContain('文章主題')
    expect(body).toContain('### tone')
  })

  it('omits empty optional frontmatter fields instead of writing blank values', () => {
    const content = buildPromptNoteContent({
      title: 'Untitled',
      tags: [],
      variableNames: [],
      body: 'plain text, no variables',
      summary: '',
      scenarios: [],
      source: '',
      variableDescriptions: new Map(),
    })
    const { block } = splitFrontmatter(content)
    const frontmatter = parseFrontmatterData(block)
    expect(frontmatter).toEqual({ type: 'prompt', tags: [], variables: [] })
    expect(content).not.toContain('## 變數')
  })

  it('produces a note whose required-variable rules match variables.ts (no default = required)', () => {
    const content = buildPromptNoteContent({
      title: 'T',
      tags: [],
      variableNames: ['topic'],
      body: 'about {{topic}}',
      summary: '',
      scenarios: [],
      source: '',
      variableDescriptions: new Map([['topic', 'the subject']]),
    })
    const { block, body } = splitFrontmatter(content)
    const frontmatter = parseFrontmatterData(block)
    const fields = resolvePromptFields(body, frontmatter?.variables)
    expect(fields).toEqual([{
      name: 'topic',
      declared: true,
      required: true, // declared but no default value => required
      description: 'the subject',
      defaultValue: '',
      options: [],
    }])
  })

  it('leaves everything outside of the variable tokens untouched', () => {
    const body = '原文完全不變，除了 {{topic}} 這個變數。'
    const content = buildPromptNoteContent({
      title: 'T',
      tags: [],
      variableNames: ['topic'],
      body,
      summary: '',
      scenarios: [],
      source: '',
      variableDescriptions: new Map(),
    })
    expect(content).toContain(body)
  })
})

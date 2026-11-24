import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { sourceMarkdownLanguage } from './source-markdown-language'
import { buildLivePreviewDecorations } from './source-live-preview'
import { buildWriterHangDecorations, frontmatterEnd } from './source-writer-style'

function stateOf(doc: string) {
  const state = EditorState.create({ doc, extensions: [sourceMarkdownLanguage()] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

function hungText(doc: string) {
  const state = stateOf(doc)
  const parts: string[] = []
  buildWriterHangDecorations(state, [{ from: 0, to: state.doc.length }]).between(0, state.doc.length, (from, to, value) => {
    if (value.spec.class === 'cm-writer-hang') parts.push(state.sliceDoc(from, to))
  })
  return parts
}

describe('writer style hanging markers', () => {
  it('hangs heading marks with their trailing space', () => {
    expect(hungText('# One\n\n## Two\n\n#### Four')).toEqual(['# ', '## ', '#### '])
  })

  it('does not hang headings deeper than level 4 or closing marks', () => {
    expect(hungText('##### Five\n\n# Closed #')).toEqual(['# '])
  })

  it('hangs only the outermost quote mark', () => {
    expect(hungText('> quote\n> > nested')).toEqual(['> ', '> '])
  })

  it('leaves list markers and body text alone', () => {
    expect(hungText('- [ ] task\n- item\n\nplain #tag')).toEqual([])
  })

  it('marks frontmatter lines and never hangs inside them', () => {
    const doc = '---\nid: 1\n# not a heading\n---\n# Title'
    const state = stateOf(doc)
    expect(frontmatterEnd(state)).toBe(doc.indexOf('\n# Title'))
    expect(hungText(doc)).toEqual(['# '])
    const lines: number[] = []
    buildWriterHangDecorations(state, [{ from: 0, to: doc.length }]).between(0, doc.length, (from, _to, value) => {
      if (value.spec.class === 'cm-writer-frontmatter') lines.push(state.doc.lineAt(from).number)
    })
    expect(lines).toEqual([1, 2, 3, 4])
  })

  it('finds no frontmatter unless the document starts with ---', () => {
    expect(frontmatterEnd(stateOf('text\n---\nmore'))).toBe(-1)
    expect(frontmatterEnd(stateOf('---\nunclosed'))).toBe(-1)
  })

  it('live preview leaves frontmatter untouched', () => {
    const doc = '---\ntitle: **x**\n---\n**bold**'
    const state = stateOf(doc)
    const decorations = buildLivePreviewDecorations(state, [{ from: 0, to: doc.length }], false)
    const touched: number[] = []
    decorations.between(0, doc.length, (from) => { touched.push(state.doc.lineAt(from).number) })
    expect(touched.every(line => line === 4)).toBe(true)
    expect(touched.length).toBeGreaterThan(0)
  })
})

import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { activeLineNumbers, buildLivePreviewDecorations } from './source-live-preview'
import { sourceMarkdownLanguage } from './source-markdown-language'

function stateOf(doc: string, cursor = doc.length) {
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [sourceMarkdownLanguage()] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

function hiddenText(state: EditorState, decorations: DecorationSet) {
  const parts: string[] = []
  decorations.between(0, state.doc.length, (from, to, value) => {
    if (from !== to && value.spec.class === undefined && !value.spec.attributes) parts.push(state.sliceDoc(from, to))
  })
  return parts
}

function classesOf(decorations: DecorationSet) {
  const classes: string[] = []
  decorations.between(0, Number.MAX_SAFE_INTEGER, (_from, _to, value) => {
    if (value.spec.class) classes.push(value.spec.class)
  })
  return classes
}

const all = (state: EditorState) => [{ from: 0, to: state.doc.length }]

describe('live preview decorations', () => {
  it('hides markdown syntax on lines without the cursor', () => {
    const doc = '# Title\n\nSome **bold** and *em* and `code`.\n\ncursor'
    const state = stateOf(doc)
    const decorations = buildLivePreviewDecorations(state, all(state), true)
    expect(hiddenText(state, decorations)).toEqual(['# ', '**', '**', '*', '*', '`', '`'])
    expect(classesOf(decorations)).toEqual(expect.arrayContaining(['cm-lp-heading cm-lp-h1', 'cm-lp-strong', 'cm-lp-em', 'cm-lp-code']))
  })

  it('shows raw syntax on the line with the cursor', () => {
    const doc = '# Title\nSome **bold**'
    const state = stateOf(doc, 3)
    const hidden = hiddenText(state, buildLivePreviewDecorations(state, all(state), true))
    expect(hidden).not.toContain('# ')
    expect(hidden).toEqual(['**', '**'])
  })

  it('renders every line when the editor is not focused', () => {
    const state = stateOf('# Title', 3)
    expect(activeLineNumbers(state, false).size).toBe(0)
    expect(hiddenText(state, buildLivePreviewDecorations(state, all(state), false))).toEqual(['# '])
  })

  it('collapses inline links to their text', () => {
    const doc = 'See [the docs](https://example.com "Docs") now\n\nx'
    const state = stateOf(doc)
    const decorations = buildLivePreviewDecorations(state, all(state), true)
    expect(hiddenText(state, decorations)).toEqual(['[', '](https://example.com "Docs")'])
    expect(classesOf(decorations)).toContain('cm-lp-link')
  })

  it('collapses wikilinks and keeps the alias', () => {
    const doc = 'Go to [[Project Notes]] or [[Target|alias]]\n\nx'
    const state = stateOf(doc)
    expect(hiddenText(state, buildLivePreviewDecorations(state, all(state), true)))
      .toEqual(['[[', ']]', '[[Target|', ']]'])
  })

  it('replaces task markers and bullets with widgets', () => {
    const doc = '- [ ] todo\n- item\n\nx'
    const state = stateOf(doc)
    const widgets: string[] = []
    buildLivePreviewDecorations(state, all(state), true).between(0, state.doc.length, (from, to, value) => {
      if (value.spec.widget) widgets.push(`${value.spec.widget.constructor.name}:${state.sliceDoc(from, to)}`)
    })
    expect(widgets).toEqual(['CheckboxWidget:[ ]', 'BulletWidget:-'])
    expect(hiddenText(state, buildLivePreviewDecorations(state, all(state), true))).toContain('- ')
  })

  it('styles strikethrough without GFM in the base language', () => {
    const doc = 'a ~~gone~~ b\n\nx'
    const state = stateOf(doc)
    const decorations = buildLivePreviewDecorations(state, all(state), true)
    expect(hiddenText(state, decorations)).toEqual(['~~', '~~'])
    expect(classesOf(decorations)).toContain('cm-lp-strike')
  })
})

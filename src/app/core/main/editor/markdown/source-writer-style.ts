// Fork（almanac）：V3 原始碼模式的 iA Writer 風格。只用在 Markdown 檔（程式碼檔仍是一般程式編輯器樣式）。
// - 字型 iA Writer Duo S（public/fonts，OFL），中文落到系統黑體
// - 標題同字級只加粗；# 與 > 懸在左邊界外，內文左緣永遠對齊
// - Markdown 符號一律淡灰，不上顏色
// - 行號淡、無底色無分隔線，游標所在行加深；目前行不加底色
// - 內容寬度跟著「編輯區寬度」設定（窄／較寬／最寬），置中；最寬時兩邊留 20px
// - frontmatter 不套 Markdown 樣式（CommonMark 會把它誤認成 Setext 標題）
// Live Preview 疊在這上面：它把游標不在的行的符號藏起來，懸掛的符號也就跟著消失。
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

import type { EditorContentWidth } from '@/lib/editor-layout-styles'

export const WRITER_FONT_FAMILY = '"iA Writer Duo S", "PingFang TC", "Noto Sans TC", ui-monospace, monospace'
/** 懸掛區寬度：放得下「#### 」；更深的標題不懸掛 */
export const WRITER_HANG_WIDTH = '3em'
const MAX_HANG_LEVEL = 4
/** 內容（含懸掛區）的最大寬度，跟視覺編輯器的編輯區寬度同一套；最寬＝兩邊留 20px */
const WRITER_CONTENT_WIDTHS: Record<EditorContentWidth, string | null> = {
  narrow: '42rem',
  standard: '48rem',
  wide: '64rem',
  full: null,
}
export const WRITER_EDGE_GAP = '20px'
/** 行號欄的大約寬度，用來讓「行號＋內容」整體置中 */
const WRITER_GUTTER_ALLOWANCE = '3em'

const MARK_COLOR = 'var(--faint, hsl(var(--muted-foreground)))'
const LINE_NUMBER_COLOR = 'color-mix(in oklab, var(--faint, hsl(var(--muted-foreground))) 60%, transparent)'
const ACTIVE_LINE_NUMBER_COLOR = 'var(--muted-ink, hsl(var(--muted-foreground)))'
const CARET_COLOR = 'var(--caret, hsl(var(--foreground)))'

export const writerHighlightStyle = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.quote, fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.url, t.labelName, t.string, t.contentSeparator, t.comment, t.meta], color: MARK_COLOR },
])

const hangMark = Decoration.mark({ class: 'cm-writer-hang' })
const frontmatterLine = Decoration.line({ class: 'cm-writer-frontmatter' })
const FRONTMATTER_SCAN_LINES = 500

/**
 * 開頭的 YAML frontmatter（--- … --- 或 ...）結束的位置；沒有就回傳 -1。
 * CommonMark 不認得 frontmatter，會把結尾的 --- 當成 Setext 標題底線、把整段變粗體，所以要另外排除。
 */
export function frontmatterEnd(state: EditorState): number {
  const doc = state.doc
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== '---') return -1
  const last = Math.min(doc.lines, FRONTMATTER_SCAN_LINES)
  for (let number = 2; number <= last; number++) {
    const text = doc.line(number).text.trimEnd()
    if (text === '---' || text === '...') return doc.line(number).to
  }
  return -1
}

/** 行首的 #…# 與 > （連同後面的空白）包成懸掛區；frontmatter 的每一行標成 cm-writer-frontmatter。 */
export function buildWriterHangDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const fmEnd = frontmatterEnd(state)
  if (fmEnd >= 0) {
    for (let number = 1; number <= state.doc.lineAt(fmEnd).number; number++) {
      decorations.push(frontmatterLine.range(state.doc.line(number).from))
    }
  }
  const hangFrom = (from: number, to: number) => {
    const line = state.doc.lineAt(from)
    if (from !== line.from || from <= fmEnd) return
    const after = state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to
    decorations.push(hangMark.range(from, after))
  }
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'HeaderMark') {
          const level = /^ATXHeading([1-6])$/.exec(node.node.parent?.name ?? '')
          if (level && Number(level[1]) <= MAX_HANG_LEVEL) hangFrom(node.from, node.to)
          return
        }
        // 只懸掛最外層引言的第一個 >
        if (node.name === 'QuoteMark' && node.node.parent?.parent?.name !== 'Blockquote') {
          hangFrom(node.from, node.to)
        }
      },
    })
  }
  return Decoration.set(decorations, true)
}

const writerHangPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildWriterHangDecorations(view.state, view.visibleRanges)
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
      this.decorations = buildWriterHangDecorations(update.state, update.view.visibleRanges)
    }
  }
}, {
  decorations: plugin => plugin.decorations,
})

function writerTheme(contentWidth: EditorContentWidth) {
  const maxWidth = WRITER_CONTENT_WIDTHS[contentWidth]
  return EditorView.theme({
    '.cm-scroller': {
      fontFamily: WRITER_FONT_FAMILY,
      // 行號＋內容整體置中；窄的時候、或「最寬」時，貼齊左邊並留 20px
      paddingLeft: maxWidth
        ? `max(${WRITER_EDGE_GAP}, calc((100% - ${maxWidth} - ${WRITER_GUTTER_ALLOWANCE}) / 2))`
        : WRITER_EDGE_GAP,
    },
    '.cm-content': {
      maxWidth: maxWidth ?? 'none',
      padding: `32px ${WRITER_EDGE_GAP} 40vh 0`,
      caretColor: CARET_COLOR,
    },
    '.cm-line': {
      paddingLeft: WRITER_HANG_WIDTH,
    },
    // inline-flex 靠右：WebKit 的 inline-block 靠右對齊會吃掉結尾空白，# 會黏住標題文字
    '.cm-writer-hang': {
      display: 'inline-flex',
      justifyContent: 'flex-end',
      width: WRITER_HANG_WIDTH,
      marginLeft: `calc(-1 * ${WRITER_HANG_WIDTH})`,
      whiteSpace: 'pre',
      fontWeight: '400',
      fontStyle: 'normal',
      color: MARK_COLOR,
    },
    '.cm-writer-frontmatter, .cm-writer-frontmatter *': {
      fontWeight: '400 !important',
      fontStyle: 'normal !important',
      textDecoration: 'none !important',
      color: `${MARK_COLOR} !important`,
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      borderRight: 'none',
      color: LINE_NUMBER_COLOR,
    },
    '.cm-gutterElement': {
      paddingLeft: '0',
      paddingRight: '0.25em',
      fontSize: '0.8em',
      fontVariantNumeric: 'tabular-nums',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: ACTIVE_LINE_NUMBER_COLOR,
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: CARET_COLOR,
      borderLeftWidth: '2px',
    },
  })
}

/** 只給 V3 的 Markdown 原始碼編輯器（Markup、Live Preview、Split 左側）。 */
export function writerStyleExtension(contentWidth: EditorContentWidth = 'narrow'): Extension {
  return [
    writerTheme(contentWidth),
    syntaxHighlighting(writerHighlightStyle),
    writerHangPlugin,
    EditorView.editorAttributes.of({ class: 'cm-writer' }),
  ]
}

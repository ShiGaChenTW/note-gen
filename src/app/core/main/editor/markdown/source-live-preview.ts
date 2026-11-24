// Fork（almanac ALMNC-63）：Live Preview——CodeMirror 原始碼編輯，但游標不在的行
// 會藏起 Markdown 符號並直接套用樣式；游標移進那一行才露出原始符號。
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'

import { frontmatterEnd } from './source-writer-style'

const hidden = Decoration.replace({})
const strongMark = Decoration.mark({ class: 'cm-lp-strong' })
const emphasisMark = Decoration.mark({ class: 'cm-lp-em' })
const strikeMark = Decoration.mark({ class: 'cm-lp-strike' })
const inlineCodeMark = Decoration.mark({ class: 'cm-lp-code' })
const linkMark = Decoration.mark({ class: 'cm-lp-link' })
const syntaxMark = Decoration.mark({ class: 'cm-lp-syntax' })
const quoteLine = Decoration.line({ class: 'cm-lp-quote' })
const codeBlockLine = Decoration.line({ class: 'cm-lp-codeblock' })
const hrLine = Decoration.line({ class: 'cm-lp-hr' })
const headingLines = [1, 2, 3, 4, 5, 6].map(level => Decoration.line({ class: `cm-lp-heading cm-lp-h${level}` }))

const WIKILINK_PATTERN = /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g
// 原始碼編輯器的語言是 CommonMark（沒有 GFM），任務清單與刪除線自己辨識
const STRIKETHROUGH_PATTERN = /~~(?=\S)([^~\n]*?\S)~~/g
const TASK_AFTER_LIST_MARK = /^ \[([ xX])\]/
const REMOTE_IMAGE_PATTERN = /^(?:https?:|data:image\/)/i

class BulletWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-lp-bullet'
    span.textContent = '•'
    return span
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) { super() }
  eq(other: CheckboxWidget) { return other.checked === this.checked }
  toDOM(view: EditorView) {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'cm-lp-checkbox'
    input.checked = this.checked
    input.tabIndex = -1
    input.addEventListener('mousedown', (event) => {
      event.preventDefault()
      if (view.state.readOnly) return
      const pos = view.posAtDOM(input)
      const marker = view.state.sliceDoc(pos, pos + 3)
      if (!/^\[[ xX]\]$/.test(marker)) return
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' } })
    })
    return input
  }
  ignoreEvent() { return false }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) { super() }
  eq(other: ImageWidget) { return other.src === this.src && other.alt === this.alt }
  toDOM() {
    const image = document.createElement('img')
    image.className = 'cm-lp-image'
    image.src = this.src
    image.alt = this.alt
    image.loading = 'lazy'
    return image
  }
}

class RuleWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-lp-rule'
    return span
  }
}

const bulletWidget = Decoration.replace({ widget: new BulletWidget() })
const ruleWidget = Decoration.replace({ widget: new RuleWidget() })

/** 游標或選取範圍碰到的行號；編輯器沒有焦點時整份都渲染。 */
export function activeLineNumbers(state: EditorState, hasFocus: boolean): Set<number> {
  const lines = new Set<number>()
  if (!hasFocus) return lines
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let line = first; line <= last; line++) lines.add(line)
  }
  return lines
}

export function buildLivePreviewDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  hasFocus: boolean,
): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const active = activeLineNumbers(state, hasFocus)
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number)
  const hide = (from: number, to: number) => {
    if (to > from) decorations.push(hidden.range(from, to))
  }
  const eachLine = (from: number, to: number, decoration: Decoration) => {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)
      decorations.push(decoration.range(line.from))
      pos = line.to + 1
    }
  }

  // frontmatter 原樣顯示（開頭的 --- 不畫成分隔線、結尾的 --- 不當標題底線）
  const fmEnd = frontmatterEnd(state)
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.from <= fmEnd) return node.to > fmEnd
        const name = node.name
        const heading = /^ATXHeading([1-6])$/.exec(name)
        if (heading) {
          decorations.push(headingLines[Number(heading[1]) - 1].range(state.doc.lineAt(node.from).from))
          return
        }
        switch (name) {
          case 'HeaderMark': {
            if (node.node.parent?.name.startsWith('ATXHeading') && !isActive(node.from)) {
              const after = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
              hide(node.from, after)
            }
            return
          }
          case 'StrongEmphasis': decorations.push(strongMark.range(node.from, node.to)); return
          case 'Emphasis': decorations.push(emphasisMark.range(node.from, node.to)); return
          case 'InlineCode': decorations.push(inlineCodeMark.range(node.from, node.to)); return
          case 'EmphasisMark':
            if (!isActive(node.from)) hide(node.from, node.to)
            return
          case 'CodeMark':
            if (node.node.parent?.name === 'InlineCode') {
              if (!isActive(node.from)) hide(node.from, node.to)
            } else {
              decorations.push(syntaxMark.range(node.from, node.to))
            }
            return
          case 'CodeInfo':
            decorations.push(syntaxMark.range(node.from, node.to))
            return
          case 'FencedCode':
          case 'CodeBlock':
            eachLine(node.from, node.to, codeBlockLine)
            return
          case 'Blockquote':
            eachLine(node.from, node.to, quoteLine)
            return
          case 'QuoteMark':
            if (!isActive(node.from)) {
              const after = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
              hide(node.from, after)
            }
            return
          case 'HorizontalRule':
            decorations.push(hrLine.range(state.doc.lineAt(node.from).from))
            if (!isActive(node.from)) decorations.push(ruleWidget.range(node.from, node.to))
            return
          case 'ListMark': {
            if (isActive(node.from)) return
            const marker = state.sliceDoc(node.from, node.to)
            const after = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
            if (node.node.nextSibling?.name === 'Task') {
              hide(node.from, after)
              return
            }
            const task = TASK_AFTER_LIST_MARK.exec(state.sliceDoc(node.to, node.to + 4))
            if (task) {
              hide(node.from, after)
              decorations.push(Decoration.replace({ widget: new CheckboxWidget(task[1] !== ' ') }).range(node.to + 1, node.to + 4))
            } else if (/^[-*+]$/.test(marker)) {
              decorations.push(bulletWidget.range(node.from, node.to))
            }
            return
          }
          case 'TaskMarker': {
            if (isActive(node.from)) return
            const checked = /x/i.test(state.sliceDoc(node.from, node.to))
            decorations.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to))
            return
          }
          case 'Image': {
            if (isActive(node.from)) return
            const url = node.node.getChild('URL')
            const src = url ? state.sliceDoc(url.from, url.to) : ''
            if (!REMOTE_IMAGE_PATTERN.test(src)) return
            const altMatch = /^!\[([^\]]*)\]/.exec(state.sliceDoc(node.from, node.to))
            decorations.push(Decoration.replace({ widget: new ImageWidget(src, altMatch?.[1] ?? '') }).range(node.from, node.to))
            return false
          }
          case 'Link': {
            if (isActive(node.from)) return
            const marks = node.node.getChildren('LinkMark')
            const textEnd = marks[1]?.from
            // 只處理 [text](url) 與 [text][ref]；單獨的 [text]（含 [[wikilink]] 內層）交給下面的 wikilink 處理
            if (marks.length < 3 || textEnd === undefined) return
            decorations.push(linkMark.range(marks[0].to, textEnd))
            hide(marks[0].from, marks[0].to)
            // 「](url "title")」整段藏起來；參照式連結 [text][ref] 也一樣
            hide(textEnd, node.to)
            return false
          }
          default:
            return
        }
      },
    })

    // Wikilink 不在 lezer 語法樹裡，用正規表示式處理可見的文字
    const text = state.sliceDoc(from, to)
    for (const match of text.matchAll(WIKILINK_PATTERN)) {
      const start = from + (match.index ?? 0)
      const end = start + match[0].length
      if (start <= fmEnd || isActive(start)) continue
      if (match[2]) {
        hide(start, start + 2 + match[1].length + 1)
        decorations.push(linkMark.range(end - 2 - match[2].length, end - 2))
      } else {
        hide(start, start + 2)
        decorations.push(linkMark.range(start + 2, end - 2))
      }
      hide(end - 2, end)
    }
    for (const match of text.matchAll(STRIKETHROUGH_PATTERN)) {
      const start = from + (match.index ?? 0)
      const end = start + match[0].length
      if (start <= fmEnd) continue
      decorations.push(strikeMark.range(start, end))
      if (isActive(start)) continue
      hide(start, start + 2)
      hide(end - 2, end)
    }
  }

  return Decoration.set(decorations, true)
}

const livePreviewPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildLivePreviewDecorations(view.state, view.visibleRanges, view.hasFocus)
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged
      || syntaxTree(update.state) !== syntaxTree(update.startState)) {
      this.decorations = buildLivePreviewDecorations(update.state, update.view.visibleRanges, update.view.hasFocus)
    }
  }
}, {
  decorations: plugin => plugin.decorations,
})

// 字型、標題字級、符號顏色都沿用原始碼模式（V3 的 iA Writer 風格，source-writer-style.ts），
// 切換 Markup ↔ Live Preview 時版面不跳；這裡只負責「藏起符號後」需要的樣式。
const livePreviewTheme = EditorView.baseTheme({
  '.cm-lp-heading': { fontWeight: '700' },
  '.cm-lp-strong': { fontWeight: '700' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-strike': { textDecoration: 'line-through' },
  '.cm-lp-code': {
    backgroundColor: 'var(--hover, rgba(127,127,127,0.12))',
    borderRadius: '3px',
    padding: '0 2px',
  },
  '.cm-lp-link': { color: 'var(--brand-accent, var(--color-primary))', textDecoration: 'underline', textUnderlineOffset: '2px' },
  '.cm-lp-syntax': { opacity: '0.55' },
  // 引言色條畫在懸掛區裡（> 的右邊），內文左緣不動
  '.cm-lp-quote': {
    backgroundImage: 'linear-gradient(var(--brand-accent, currentColor), var(--brand-accent, currentColor))',
    backgroundSize: '2px 100%',
    backgroundPosition: 'calc(3em - 0.6em) 0',
    backgroundRepeat: 'no-repeat',
    color: 'var(--muted-ink, inherit)',
  },
  '.cm-lp-codeblock': {
    backgroundColor: 'var(--hover, rgba(127,127,127,0.08))',
  },
  '.cm-lp-bullet': { display: 'inline-block', width: '0.8em', color: 'var(--faint, inherit)' },
  '.cm-lp-checkbox': { margin: '0 0.4em 0 0', verticalAlign: 'middle', cursor: 'pointer' },
  '.cm-lp-image': { display: 'block', maxWidth: '100%', maxHeight: '24em', margin: '4px 0', borderRadius: '4px' },
  '.cm-lp-rule': { display: 'inline-block', width: '100%', borderTop: '1px solid var(--color-border, currentColor)', verticalAlign: 'middle' },
})

export function livePreviewExtension(): Extension {
  return [livePreviewPlugin, livePreviewTheme, EditorView.editorAttributes.of({ class: 'cm-lp' })]
}

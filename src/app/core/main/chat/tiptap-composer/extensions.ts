// Spike（almanac ALMNC-77）：對話輸入框的 TipTap 擴充。
// 專案沒有裝 @tiptap/extension-mention，這裡用 Node + @tiptap/suggestion 自己寫一個最小版本；
// 正式實作建議改裝同版本（3.35）的 extension-mention，少維護一份節點定義。
import { Extension, Node, mergeAttributes, type Editor, type Range } from '@tiptap/core'
import { NodeSelection, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Suggestion, exitSuggestion, findSuggestionMatch } from '@tiptap/suggestion'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  COMPOSER_MENTION_NODE,
  formatMentionToken,
  readMentionAttrs,
} from './serialize'

export type ComposerTrigger = 'resource' | 'command'

export interface ComposerSuggestionChange {
  trigger: ComposerTrigger
  query: string
  range: Range
}

export const composerSuggestionKeys: Record<ComposerTrigger, PluginKey> = {
  resource: new PluginKey('chatComposerResourceSuggestion'),
  command: new PluginKey('chatComposerCommandSuggestion'),
}

const TRIGGER_CHARS: Record<ComposerTrigger, string> = {
  resource: '@',
  command: '/',
}

// 舊輸入框只在空白（或開頭）後面的 @、/ 才開選單；contenteditable 可能把空白存成 nbsp，全形空白也算。
const ALLOWED_PREFIXES = [' ', ' ', '　', '\t']

export function getActiveComposerTrigger(state: EditorState): ComposerTrigger | null {
  for (const trigger of ['resource', 'command'] as const) {
    const pluginState = composerSuggestionKeys[trigger].getState(state) as { active?: boolean } | undefined
    if (pluginState?.active) return trigger
  }
  return null
}

export function exitComposerSuggestions(editor: Editor) {
  const trigger = getActiveComposerTrigger(editor.state)
  if (trigger) exitSuggestion(editor.view, composerSuggestionKeys[trigger])
}

export const ComposerMention = Node.create({
  name: COMPOSER_MENTION_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  // 比 TipTap 內建 Keymap 早處理 Backspace。
  priority: 200,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: element => element.getAttribute('data-id') ?? '',
        renderHTML: attributes => ({ 'data-id': attributes.id }),
      },
      kind: {
        default: 'file',
        parseHTML: element => element.getAttribute('data-kind') ?? 'file',
        renderHTML: attributes => ({ 'data-kind': attributes.kind }),
      },
      label: {
        default: '',
        parseHTML: element => element.getAttribute('data-label') ?? '',
        renderHTML: attributes => ({ 'data-label': attributes.label }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-composer-mention]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = readMentionAttrs(node.attrs)
    return [
      'span',
      mergeAttributes(
        {
          'data-composer-mention': '',
          // 外觀沿用上下文標籤（ChatContextStrip v3）的色票；最終樣式待設計決定。
          class: 'composer-mention rounded-full border border-line bg-sunken px-1.5 text-muted-ink',
        },
        HTMLAttributes,
      ),
      attrs ? formatMentionToken(attrs) : '',
    ]
  },

  renderText({ node }) {
    const attrs = readMentionAttrs(node.attrs)
    return attrs ? formatMentionToken(attrs) : ''
  },

  addKeyboardShortcuts() {
    return {
      // 第一下 Backspace 選取游標前的膠囊，第二下（選取狀態）交給內建 deleteSelection 刪除。
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        if (!selection.empty) return false
        const nodeBefore = selection.$from.nodeBefore
        if (nodeBefore?.type.name !== COMPOSER_MENTION_NODE) return false
        const pos = selection.from - nodeBefore.nodeSize
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
        return true
      },
    }
  },
})

export interface ComposerSuggestionsOptions {
  onChange: (change: ComposerSuggestionChange | null, trigger: ComposerTrigger) => void
}

export const ComposerSuggestions = Extension.create<ComposerSuggestionsOptions>({
  name: 'chatComposerSuggestions',

  addOptions() {
    return {
      onChange: () => undefined,
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return (['resource', 'command'] as const).map(trigger => Suggestion({
      editor: this.editor,
      pluginKey: composerSuggestionKeys[trigger],
      char: TRIGGER_CHARS[trigger],
      // 與舊輸入框相同：查詢字可以含空白（多個關鍵字），直到出現新的 @ 或 /。
      allowSpaces: true,
      allowedPrefixes: ALLOWED_PREFIXES,
      findSuggestionMatch: config => {
        const match = findSuggestionMatch(config)
        if (!match) return null
        // 查詢字裡又打了「空白 + @／/」：交給新的觸發字，舊的這個收起。
        return /\s[@/]/.test(match.text) ? null : match
      },
      // 組字中出現的 @、/ 不開選單；已經開著的選單在組字中保持開啟，讓查詢字跟著更新。
      allow: ({ editor, isActive }) => Boolean(isActive) || !editor.view.composing,
      render: () => ({
        onStart: props => options.onChange({ trigger, query: props.query, range: props.range }, trigger),
        onUpdate: props => options.onChange({ trigger, query: props.query, range: props.range }, trigger),
        onExit: () => options.onChange(null, trigger),
      }),
    }))
  },
})

export interface ComposerExtensionsOptions {
  placeholder: () => string
  onSuggestionChange: ComposerSuggestionsOptions['onChange']
}

/** 輸入框只留段落、文字、Shift+Enter 換行、復原；不開放粗體、清單等格式（送出的是純文字）。 */
export function createComposerExtensions(options: ComposerExtensionsOptions) {
  return [
    StarterKit.configure({
      blockquote: false,
      bold: false,
      bulletList: false,
      code: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      heading: false,
      horizontalRule: false,
      italic: false,
      listItem: false,
      listKeymap: false,
      link: false,
      orderedList: false,
      strike: false,
      underline: false,
      trailingNode: false,
    }),
    Placeholder.configure({
      placeholder: () => options.placeholder(),
      showOnlyWhenEditable: false,
    }),
    ComposerMention,
    ComposerSuggestions.configure({ onChange: options.onSuggestionChange }),
  ]
}

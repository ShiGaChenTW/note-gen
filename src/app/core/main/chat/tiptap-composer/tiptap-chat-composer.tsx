"use client"
// Spike（almanac ALMNC-77）：用 TipTap 取代 Textarea 的對話輸入框。@ 選到的檔案、紀錄、畫布變成句中的膠囊，
// / 叫出原本的指令選單（ChatComposerMenu 不變，由 suggestion 外掛驅動）。
import * as React from 'react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { Range } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { cn } from '@/lib/utils'
import type { ComposerMenuMode } from '../chat-composer-menu'
import {
  createComposerExtensions,
  exitComposerSuggestions,
  getActiveComposerTrigger,
  type ComposerSuggestionChange,
  type ComposerTrigger,
} from './extensions'
import { resolveComposerKeyAction } from './keys'
import { pasteComposerPlainText } from './paste'
import {
  COMPOSER_MENTION_NODE,
  serializeComposerDoc,
  textToComposerDoc,
  textToComposerInlineContent,
  type ComposerMentionAttrs,
  type SerializedComposer,
} from './serialize'
import './tiptap-chat-composer.css'

export interface TiptapComposerMenuState {
  mode: ComposerMenuMode
  start: number
  query: string
}

export interface TiptapChatComposerHandle {
  focus: () => void
  hasFocus: () => boolean
  /** 整份換成純文字（清空、歷史紀錄、外掛草稿、新手引導都走這裡）。 */
  setText: (text: string) => void
  /** 在游標處插入純文字（提示詞庫）。 */
  insertText: (text: string) => void
  /** 用膠囊取代目前的「@查詢字」。 */
  insertMention: (attrs: ComposerMentionAttrs) => void
  /** 用文字取代目前的「@查詢字」或「/查詢字」；空字串等於刪掉。 */
  replaceMenuToken: (text: string) => void
  /** 加號選單的「引用」「技能」：在游標處補上觸發字並開選單。 */
  openMenu: (mode: 'resource' | 'skill') => void
  closeMenu: () => void
  moveCaretToStart: () => void
}

export interface TiptapComposerCaret {
  atStart: boolean
  atEnd: boolean
}

interface TiptapChatComposerProps {
  className?: string
  placeholder: string
  disabled: boolean
  onChange: (value: SerializedComposer) => void
  onMenuChange: (menu: TiptapComposerMenuState | null) => void
  onMenuKey: (action: 'up' | 'down' | 'select' | 'close') => void
  onSubmit: () => void
  /** 父元件的其他快捷鍵（Tab 切模式、歷史紀錄、開頭 Backspace）；回傳 true 表示已處理。 */
  onKeyDown?: (event: KeyboardEvent, caret: TiptapComposerCaret) => boolean
  /** 回傳 true 表示父元件已處理（圖片）；否則照純文字貼上。 */
  onPaste?: (event: ClipboardEvent) => boolean
  onBlur?: () => void
}

function getCaret(view: EditorView): TiptapComposerCaret {
  const { selection, doc } = view.state
  return {
    atStart: selection.empty && selection.from <= Selection.atStart(doc).from,
    atEnd: selection.empty && selection.to >= Selection.atEnd(doc).to,
  }
}

function emitChange(editor: Editor, onChange: TiptapChatComposerProps['onChange']) {
  onChange(serializeComposerDoc(editor.getJSON()))
}

export const TiptapChatComposer = forwardRef<TiptapChatComposerHandle, TiptapChatComposerProps>(
  function TiptapChatComposer(props, ref) {
    const propsRef = useRef(props)
    propsRef.current = props
    const menuRef = useRef<{ trigger: ComposerTrigger; range: Range } | null>(null)
    const modeOverrideRef = useRef<ComposerMenuMode | null>(null)
    const compositionJustEndedRef = useRef(false)

    const handleSuggestionChange = (change: ComposerSuggestionChange | null, trigger: ComposerTrigger) => {
      if (change) {
        menuRef.current = { trigger, range: change.range }
        const mode: ComposerMenuMode = trigger === 'resource' ? 'resource' : modeOverrideRef.current ?? 'command'
        propsRef.current.onMenuChange({ mode, start: change.range.from, query: change.query })
        return
      }
      if (menuRef.current?.trigger !== trigger) return
      menuRef.current = null
      modeOverrideRef.current = null
      propsRef.current.onMenuChange(null)
    }
    const handleSuggestionChangeRef = useRef(handleSuggestionChange)
    handleSuggestionChangeRef.current = handleSuggestionChange

    // 擴充只建一次：useEditor 每次 render 都會 setOptions，但建立後不會重新套用擴充。
    const [extensions] = useState(() => createComposerExtensions({
      placeholder: () => propsRef.current.placeholder,
      onSuggestionChange: (change, trigger) => handleSuggestionChangeRef.current(change, trigger),
    }))

    const editor = useEditor({
      immediatelyRender: false,
      editable: !props.disabled,
      extensions,
      editorProps: {
        attributes: {
          class: 'chat-composer-tiptap-content',
          role: 'textbox',
          'aria-multiline': 'true',
        },
        handleKeyDown: (view, event) => {
          const action = resolveComposerKeyAction(event, {
            menuOpen: getActiveComposerTrigger(view.state) !== null,
            composing: view.composing,
            compositionJustEnded: compositionJustEndedRef.current,
          })
          switch (action) {
            case 'menu-up':
              propsRef.current.onMenuKey('up')
              return true
            case 'menu-down':
              propsRef.current.onMenuKey('down')
              return true
            case 'menu-select':
              propsRef.current.onMenuKey('select')
              return true
            case 'menu-close':
              propsRef.current.onMenuKey('close')
              return true
            case 'submit':
              propsRef.current.onSubmit()
              return true
            case 'swallow':
              return true
            case 'pass':
              break
          }
          if (view.composing || event.isComposing || event.keyCode === 229) return false
          return propsRef.current.onKeyDown?.(event, getCaret(view)) ?? false
        },
        handlePaste: (view, event) => {
          if (propsRef.current.onPaste?.(event)) return true
          return pasteComposerPlainText(view, event.clipboardData)
        },
        handleDOMEvents: {
          compositionend: () => {
            compositionJustEndedRef.current = true
            window.setTimeout(() => {
              compositionJustEndedRef.current = false
            }, 0)
            return false
          },
        },
      },
      onCreate: ({ editor: created }) => emitChange(created, propsRef.current.onChange),
      onUpdate: ({ editor: updated }) => emitChange(updated, propsRef.current.onChange),
      onBlur: () => propsRef.current.onBlur?.(),
    })

    useEffect(() => {
      if (!editor || editor.isDestroyed) return
      editor.setEditable(!props.disabled, false)
    }, [editor, props.disabled])

    // placeholder 由裝飾產生，換文字時補一筆空交易讓它重畫。
    useEffect(() => {
      if (!editor || editor.isDestroyed) return
      editor.view.dispatch(editor.state.tr.setMeta('chatComposerPlaceholder', props.placeholder))
    }, [editor, props.placeholder])

    useImperativeHandle(ref, () => ({
      focus: () => {
        editor?.commands.focus()
      },
      hasFocus: () => {
        if (!editor || editor.isDestroyed) return false
        try {
          return editor.view.hasFocus()
        } catch {
          // 編輯器還沒掛上 DOM。
          return false
        }
      },
      setText: text => {
        if (!editor || editor.isDestroyed) return
        if (serializeComposerDoc(editor.getJSON()).text === text) return
        editor.chain()
          .setContent(textToComposerDoc(text), { emitUpdate: true })
          .command(({ tr }) => {
            tr.setSelection(Selection.atEnd(tr.doc))
            tr.setMeta('addToHistory', false)
            return true
          })
          .run()
      },
      insertText: text => {
        if (!editor || editor.isDestroyed || !text) return
        editor.chain().focus().insertContent(textToComposerInlineContent(text)).run()
      },
      insertMention: attrs => {
        if (!editor || editor.isDestroyed) return
        const { from, to } = editor.state.selection
        const range = menuRef.current?.range ?? { from, to }
        editor.chain()
          .focus()
          .insertContentAt(range, [
            { type: COMPOSER_MENTION_NODE, attrs },
            { type: 'text', text: ' ' },
          ])
          .run()
      },
      replaceMenuToken: text => {
        if (!editor || editor.isDestroyed) return
        const range = menuRef.current?.range
        if (!range) {
          if (text) editor.chain().focus().insertContent(textToComposerInlineContent(text)).run()
          return
        }
        const chain = editor.chain().focus()
        if (text) chain.insertContentAt(range, textToComposerInlineContent(text)).run()
        else chain.deleteRange(range).run()
      },
      openMenu: mode => {
        if (!editor || editor.isDestroyed) return
        modeOverrideRef.current = mode === 'skill' ? 'skill' : null
        const { from } = editor.state.selection
        const before = editor.state.doc.textBetween(Math.max(0, from - 1), from, ' ', ' ')
        const prefix = before && !/\s/.test(before) ? ' ' : ''
        editor.chain().focus().insertContent(`${prefix}${mode === 'resource' ? '@' : '/'}`).run()
      },
      closeMenu: () => {
        modeOverrideRef.current = null
        if (editor && !editor.isDestroyed) exitComposerSuggestions(editor)
      },
      moveCaretToStart: () => {
        editor?.commands.setTextSelection(Selection.atStart(editor.state.doc).from)
      },
    }), [editor])

    return (
      <EditorContent
        editor={editor}
        className={cn('chat-composer-tiptap', props.disabled && 'cursor-not-allowed opacity-50', props.className)}
      />
    )
  },
)

TiptapChatComposer.displayName = 'TiptapChatComposer'

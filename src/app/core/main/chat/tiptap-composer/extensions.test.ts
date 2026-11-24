// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import type { MarkdownFile } from '@/lib/files'
import type { CanvasSelectionContext } from '@/types/canvas'
import type { MentionedRecord } from '../chat-context-strip'
import {
  createComposerExtensions,
  getActiveComposerTrigger,
  type ComposerSuggestionChange,
  type ComposerTrigger,
} from './extensions'
import { mentionAttrsFromContext } from './mention-context'
import { pasteComposerPlainText } from './paste'
import { COMPOSER_MENTION_NODE, serializeComposerDoc, type ComposerMentionAttrs } from './serialize'

const editors: Editor[] = []

function setup() {
  const changes: (ComposerSuggestionChange | null)[] = []
  const events: { trigger: ComposerTrigger; change: ComposerSuggestionChange | null }[] = []
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: createComposerExtensions({
      placeholder: () => '',
      onSuggestionChange: (change, trigger) => {
        changes.push(change)
        events.push({ trigger, change })
      },
    }),
  })
  editors.push(editor)
  const lastFor = (trigger: ComposerTrigger) => events.filter(event => event.trigger === trigger).at(-1)?.change
  return { editor, changes, lastFor }
}

function type(editor: Editor, value: string) {
  editor.view.dispatch(editor.state.tr.insertText(value))
}

function setComposing(editor: Editor, composing: boolean) {
  // 測試用：直接切換 ProseMirror 的組字狀態（實機由 compositionstart／compositionend 觸發）。
  (editor.view as unknown as { input: { composing: boolean } }).input.composing = composing
}

function insertMentionAtMenu(editor: Editor, change: ComposerSuggestionChange, attrs: ComposerMentionAttrs) {
  editor.chain().insertContentAt(change.range, [
    { type: COMPOSER_MENTION_NODE, attrs },
    { type: 'text', text: ' ' },
  ]).run()
}

function pressBackspace(editor: Editor) {
  const event = new KeyboardEvent('keydown', { key: 'Backspace' })
  return editor.view.someProp('handleKeyDown', handler => handler(editor.view, event))
}

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  document.body.innerHTML = ''
})

describe('@ 與 / 觸發選單', () => {
  it('空白後的 @ 開資源選單，查詢字跟著輸入更新', () => {
    const { editor, changes } = setup()
    type(editor, '比較 @')
    expect(changes.at(-1)).toMatchObject({ trigger: 'resource', query: '' })
    type(editor, '會議')
    expect(changes.at(-1)).toMatchObject({ trigger: 'resource', query: '會議' })
  })

  it('選了項目後膠囊取代「@查詢字」，選單收起，句子保留位置', () => {
    const { editor, changes } = setup()
    type(editor, '比較 @會議')
    insertMentionAtMenu(editor, changes.at(-1)!, { id: 'record:record:1', kind: 'record', label: '會議紀錄' })
    expect(changes.at(-1)).toBeNull()
    type(editor, '和 @週')
    insertMentionAtMenu(editor, changes.at(-1)!, { id: 'file:/v/週報.md', kind: 'file', label: '週報' })
    type(editor, '的差異')

    expect(serializeComposerDoc(editor.getJSON())).toEqual({
      text: '比較 @會議紀錄 和 @週報 的差異',
      mentions: [
        { id: 'record:record:1', kind: 'record', label: '會議紀錄' },
        { id: 'file:/v/週報.md', kind: 'file', label: '週報' },
      ],
    })
    expect(getActiveComposerTrigger(editor.state)).toBeNull()
  })

  it('/ 開指令選單；查詢字裡再打「空白 + @」換成新的觸發字', () => {
    const { editor, changes, lastFor } = setup()
    type(editor, '/sum')
    expect(changes.at(-1)).toMatchObject({ trigger: 'command', query: 'sum' })
    type(editor, ' @週')
    expect(getActiveComposerTrigger(editor.state)).toBe('resource')
    // 同一筆交易裡 @ 先開、/ 後收；元件只理會「目前選單那個觸發字」的收起，所以選單停在 @。
    expect(lastFor('resource')).toMatchObject({ trigger: 'resource', query: '週' })
    expect(lastFor('command')).toBeNull()
  })

  it('反過來：@ 查詢中打「空白 + /」換成指令選單', () => {
    const { editor, lastFor } = setup()
    type(editor, '@週報 /sum')
    expect(getActiveComposerTrigger(editor.state)).toBe('command')
    expect(lastFor('command')).toMatchObject({ trigger: 'command', query: 'sum' })
  })

  it('查詢字可以含空白（多個關鍵字），與舊輸入框相同', () => {
    const { editor, changes } = setup()
    type(editor, '@工作 會議')
    expect(changes.at(-1)).toMatchObject({ trigger: 'resource', query: '工作 會議' })
  })

  it('前面不是空白或開頭的 @、/ 不開選單（email、網址）', () => {
    const { editor } = setup()
    type(editor, 'a@b.com')
    expect(getActiveComposerTrigger(editor.state)).toBeNull()
    type(editor, ' http://x')
    expect(getActiveComposerTrigger(editor.state)).toBeNull()
  })

  it('全形空白後的 @ 也開選單', () => {
    const { editor } = setup()
    type(editor, '比較　@')
    expect(getActiveComposerTrigger(editor.state)).toBe('resource')
  })
})

describe('中文輸入法：組字中', () => {
  it('組字中出現的 @ 不開選單；組字結束後的下一筆交易才開', () => {
    const { editor } = setup()
    type(editor, '比較 ')
    setComposing(editor, true)
    type(editor, '@')
    expect(getActiveComposerTrigger(editor.state)).toBeNull()
    setComposing(editor, false)
    editor.view.dispatch(editor.state.tr.setMeta('composition-flushed', true))
    expect(getActiveComposerTrigger(editor.state)).toBe('resource')
  })

  it('組字中出現的 / 不開選單', () => {
    const { editor } = setup()
    setComposing(editor, true)
    type(editor, '/')
    expect(getActiveComposerTrigger(editor.state)).toBeNull()
  })

  it('已開的選單在組字中保持開啟，查詢字跟著組字更新', () => {
    const { editor, changes } = setup()
    type(editor, '@')
    setComposing(editor, true)
    type(editor, 'ㄏㄨㄟ')
    expect(getActiveComposerTrigger(editor.state)).toBe('resource')
    expect(changes.at(-1)).toMatchObject({ trigger: 'resource', query: 'ㄏㄨㄟ' })
  })
})

describe('Backspace 刪除膠囊', () => {
  it('第一下選取膠囊，第二下刪除', () => {
    const { editor } = setup()
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: '看 ' },
          { type: COMPOSER_MENTION_NODE, attrs: { id: 'canvas:c1', kind: 'canvas', label: '產品地圖' } },
        ],
      }],
    })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)

    expect(pressBackspace(editor)).toBe(true)
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect((editor.state.selection as NodeSelection).node.type.name).toBe(COMPOSER_MENTION_NODE)
    expect(serializeComposerDoc(editor.getJSON()).text).toBe('看 @產品地圖')

    expect(pressBackspace(editor)).toBe(true)
    expect(serializeComposerDoc(editor.getJSON())).toEqual({ text: '看 ', mentions: [] })
  })
})

describe('貼上', () => {
  it('純文字照原樣貼上，換行保留', () => {
    const { editor } = setup()
    type(editor, '前綴：')
    const handled = pasteComposerPlainText(editor.view, {
      getData: (format: string) => format === 'text/plain' ? '第一行\n\n第三行' : '<h1>第一行</h1>',
    })
    expect(handled).toBe(true)
    expect(serializeComposerDoc(editor.getJSON()).text).toBe('前綴：第一行\n\n第三行')
  })

  it('從輸入框自己複製的膠囊交給預設流程（保留膠囊）', () => {
    const { editor } = setup()
    const handled = pasteComposerPlainText(editor.view, {
      getData: (format: string) => format === 'text/html'
        ? '<span data-composer-mention="" data-id="file:/a.md" data-kind="file" data-label="a">@a</span>'
        : '@a',
    })
    expect(handled).toBe(false)
  })

  it('含膠囊的 HTML 解析回膠囊節點', () => {
    const { editor } = setup()
    editor.commands.setContent('<p>看 <span data-composer-mention="" data-id="file:/a.md" data-kind="file" data-label="a">@a</span></p>')
    expect(serializeComposerDoc(editor.getJSON())).toEqual({
      text: '看 @a',
      mentions: [{ id: 'file:/a.md', kind: 'file', label: 'a' }],
    })
  })
})

describe('mentionAttrsFromContext', () => {
  it('檔案、紀錄、畫布各自的名稱與 id（id 與 getMentionedContextKey 相同）', () => {
    const file: MarkdownFile = { name: '週報.md', path: '/vault/工作/週報.md', relativePath: '工作/週報.md' }
    expect(mentionAttrsFromContext({ kind: 'file', file })).toEqual({
      id: 'file:/vault/工作/週報.md',
      kind: 'file',
      label: '週報',
    })

    const record = {
      quote: '', fullContent: '內容', fileName: '會議紀錄',
      startLine: -1, endLine: -1, from: -1, to: -1,
      articlePath: 'record:7', markType: 'text',
    } as MentionedRecord
    expect(mentionAttrsFromContext({ kind: 'record', record })).toEqual({
      id: 'record:record:7',
      kind: 'record',
      label: '會議紀錄',
    })

    const canvas: CanvasSelectionContext = { canvasId: 'c1', canvasTitle: '產品地圖', scope: 'canvas', nodes: [], edges: [] }
    expect(mentionAttrsFromContext({ kind: 'canvas', canvas })).toEqual({
      id: 'canvas:c1',
      kind: 'canvas',
      label: '產品地圖',
    })
  })
})

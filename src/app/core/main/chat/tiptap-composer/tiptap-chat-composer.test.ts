// @vitest-environment jsdom
// 用真的 DOM 事件（keydown、compositionstart／compositionend）驅動 ProseMirror，驗證輸入框的按鍵處理。
// 無法模擬真正的輸入法選字畫面，實機結果仍待 Scott 在 macOS 注音／拼音確認。
import { act, createElement as h, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TiptapChatComposer,
  type TiptapChatComposerHandle,
  type TiptapComposerCaret,
  type TiptapComposerMenuState,
} from './tiptap-chat-composer'
import type { SerializedComposer } from './serialize'

let container: HTMLDivElement
let root: Root
let handle: React.RefObject<TiptapChatComposerHandle | null>
let calls: {
  submit: number
  values: SerializedComposer[]
  menus: (TiptapComposerMenuState | null)[]
  menuKeys: string[]
  keyDowns: { key: string; caret: TiptapComposerCaret }[]
}

async function flush() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function editorDom() {
  const dom = container.querySelector('.ProseMirror')
  if (!(dom instanceof HTMLElement)) throw new Error('editor not mounted')
  return dom
}

function keydown(init: { key: string; keyCode?: number; isComposing?: boolean; shiftKey?: boolean }) {
  const event = new KeyboardEvent('keydown', {
    key: init.key,
    isComposing: init.isComposing ?? false,
    shiftKey: init.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  })
  const keyCode = init.keyCode ?? (init.key === 'Enter' ? 13 : init.key === 'Backspace' ? 8 : 0)
  Object.defineProperty(event, 'keyCode', { get: () => keyCode })
  act(() => {
    editorDom().dispatchEvent(event)
  })
  return event
}

function composition(type: 'compositionstart' | 'compositionend') {
  act(() => {
    editorDom().dispatchEvent(new CompositionEvent(type, { bubbles: true, data: '' }))
  })
}

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  handle = createRef<TiptapChatComposerHandle>()
  calls = { submit: 0, values: [], menus: [], menuKeys: [], keyDowns: [] }
  await act(async () => {
    root.render(h(TiptapChatComposer, {
      ref: handle,
      placeholder: '輸入訊息',
      disabled: false,
      onChange: value => calls.values.push(value),
      onMenuChange: menu => calls.menus.push(menu),
      onMenuKey: action => {
        calls.menuKeys.push(action)
        if (action === 'close') handle.current?.closeMenu()
      },
      onSubmit: () => {
        calls.submit += 1
      },
      onKeyDown: (event, caret) => {
        calls.keyDowns.push({ key: event.key, caret })
        return false
      },
    }))
  })
  await flush()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('TiptapChatComposer 按鍵', () => {
  it('Enter 送出；Shift+Enter 換行不送出', () => {
    act(() => handle.current?.setText('你好'))
    keydown({ key: 'Enter', shiftKey: true })
    expect(calls.submit).toBe(0)
    expect(calls.values.at(-1)?.text).toBe('你好\n')
    keydown({ key: 'Enter' })
    expect(calls.submit).toBe(1)
  })

  it('組字中按 Enter 不送出；Safari 順序（compositionend 後緊接 Enter）也不送出', async () => {
    act(() => handle.current?.setText('你好'))
    composition('compositionstart')
    keydown({ key: 'Enter', keyCode: 229, isComposing: true })
    expect(calls.submit).toBe(0)

    composition('compositionend')
    keydown({ key: 'Enter', keyCode: 229 })
    expect(calls.submit).toBe(0)
    keydown({ key: 'Enter' })
    expect(calls.submit).toBe(0)
    expect(calls.values.at(-1)?.text).toBe('你好')

    await flush()
    keydown({ key: 'Enter' })
    expect(calls.submit).toBe(1)
  })

  it('@ 選單：上下鍵與 Enter 交給選單，選完插入膠囊、選單收起，再按 Enter 才送出', () => {
    act(() => handle.current?.setText('比較'))
    act(() => handle.current?.openMenu('resource'))
    expect(calls.menus.at(-1)).toMatchObject({ mode: 'resource', query: '' })
    expect(calls.values.at(-1)?.text).toBe('比較 @')

    keydown({ key: 'ArrowDown' })
    keydown({ key: 'ArrowUp' })
    keydown({ key: 'Enter' })
    expect(calls.menuKeys).toEqual(['down', 'up', 'select'])
    expect(calls.submit).toBe(0)

    act(() => handle.current?.insertMention({ id: 'record:record:1', kind: 'record', label: '會議紀錄' }))
    expect(calls.menus.at(-1)).toBeNull()
    expect(calls.values.at(-1)).toEqual({
      text: '比較 @會議紀錄 ',
      mentions: [{ id: 'record:record:1', kind: 'record', label: '會議紀錄' }],
    })

    keydown({ key: 'Enter' })
    expect(calls.submit).toBe(1)
  })

  it('選單開著時在組字中按 Enter 不會選取', () => {
    act(() => handle.current?.openMenu('resource'))
    composition('compositionstart')
    keydown({ key: 'Enter', keyCode: 229, isComposing: true })
    composition('compositionend')
    keydown({ key: 'Enter', keyCode: 229 })
    expect(calls.menuKeys).toEqual([])
    expect(calls.submit).toBe(0)
  })

  it('加號選單的「技能」用 / 觸發但顯示技能選單；Esc 關閉', () => {
    act(() => handle.current?.openMenu('skill'))
    expect(calls.menus.at(-1)).toMatchObject({ mode: 'skill', query: '' })
    keydown({ key: 'Escape' })
    expect(calls.menuKeys).toEqual(['close'])
    expect(calls.menus.at(-1)).toBeNull()
  })

  it('/ 指令：選到的提示詞取代「/查詢字」', () => {
    act(() => handle.current?.setText('請'))
    act(() => handle.current?.openMenu('resource'))
    act(() => handle.current?.replaceMenuToken(''))
    expect(calls.values.at(-1)?.text).toBe('請 ')
    act(() => handle.current?.setText('/sum'))
    // setText 不經過輸入事件，這裡直接把選單打開來測取代
    act(() => handle.current?.openMenu('skill'))
    act(() => handle.current?.replaceMenuToken('幫我摘要'))
    expect(calls.values.at(-1)?.text).toBe('/sum 幫我摘要')
  })

  it('其他按鍵交給父元件，並帶游標是否在開頭／結尾', () => {
    keydown({ key: 'Backspace' })
    expect(calls.keyDowns.at(-1)).toEqual({ key: 'Backspace', caret: { atStart: true, atEnd: true } })
    act(() => handle.current?.setText('abc'))
    keydown({ key: 'ArrowUp' })
    expect(calls.keyDowns.at(-1)).toEqual({ key: 'ArrowUp', caret: { atStart: false, atEnd: true } })
    act(() => handle.current?.moveCaretToStart())
    keydown({ key: 'Tab' })
    expect(calls.keyDowns.at(-1)).toEqual({ key: 'Tab', caret: { atStart: true, atEnd: false } })
  })

  it('setText 清空時，膠囊與提及一起清掉', () => {
    act(() => handle.current?.openMenu('resource'))
    act(() => handle.current?.insertMention({ id: 'canvas:c1', kind: 'canvas', label: '產品地圖' }))
    expect(calls.values.at(-1)?.mentions).toHaveLength(1)
    act(() => handle.current?.setText(''))
    expect(calls.values.at(-1)).toEqual({ text: '', mentions: [] })
  })
})

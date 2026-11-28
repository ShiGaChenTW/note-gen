// @vitest-environment jsdom
// almanac ALMNC-97.5 AC#4：文件切換器的鍵盤處理（useSwitchInput，掛在 window capture）只攔 ⌃Tab／⌃⇧Tab／選卡中的 Esc，
// ⇧⌘7/8/9（TipTap 清單：Mod-Shift-7 編號、Mod-Shift-8 項目、Mod-Shift-9 待辦，定義在 @tiptap/extension-list）
// 與 ⌘1–⌘9 要原封不動傳下去：不 preventDefault、不 stopPropagation、不切換，編輯器自己的 handler 照常收到並執行。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocSwitcherStore } from '@/stores/doc-switcher'
import type { TabInfo } from '../tab-bar'
import { MarkdownListItem, MarkdownTaskItem } from '../markdown/markdown-list-item'
import { MarkdownOrderedList } from '../markdown/markdown-ordered-list'
import { useSwitchInput } from './use-switch-input'

const tab = (id: string): TabInfo => ({ id, path: `${id}.md`, name: id, isFolder: false, kind: 'file' })
const TABS = ['a', 'b', 'c', 'd'].map(tab)

let host: HTMLDivElement
let root: Root

function Harness({ onSwitch }: { onSwitch: (id: string) => void }) {
  useSwitchInput({ tabs: TABS, activeTabId: 'a', onSwitch })
  return null
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useDocSwitcherStore.setState({ recency: ['a', 'c', 'b', 'd'], style: 'folder', expanded: false, cycleTargetId: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function mountSwitcher() {
  const onSwitch = vi.fn()
  await act(async () => root.render(<Harness onSwitch={onSwitch} />))
  return onSwitch
}

// macOS 實體鍵盤：⇧⌘7 的 key 是「&」、code 是 Digit7、keyCode 55（⇧⌘8 → *、⇧⌘9 → (）。
const SHIFT_CMD = [
  { digit: 7, key: '&', keyCode: 55 },
  { digit: 8, key: '*', keyCode: 56 },
  { digit: 9, key: '(', keyCode: 57 },
] as const

function keydown(target: EventTarget, init: KeyboardEventInit & { keyCode?: number }) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  target.dispatchEvent(event)
  return event
}

describe('文件切換器不攔 ⇧⌘7/8/9 與 ⌘1–⌘9', () => {
  it('⇧⌘7/8/9：事件傳到目標、沒被 preventDefault、沒有開始選卡或切換', async () => {
    const onSwitch = await mountSwitcher()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const received = vi.fn()
    target.addEventListener('keydown', received)

    for (const { digit, key, keyCode } of SHIFT_CMD) {
      const event = await act(async () => keydown(target, { key, code: `Digit${digit}`, keyCode, metaKey: true, shiftKey: true }))
      expect(event.defaultPrevented, `⇧⌘${digit}`).toBe(false)
    }
    expect(received).toHaveBeenCalledTimes(3)
    expect(onSwitch).not.toHaveBeenCalled()
    expect(useDocSwitcherStore.getState().cycleTargetId).toBeNull()
    target.remove()
  })

  it('⌘1–⌘9：事件傳到目標、沒被 preventDefault、不切到對應位置的分頁', async () => {
    const onSwitch = await mountSwitcher()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const received = vi.fn()
    target.addEventListener('keydown', received)

    for (let digit = 1; digit <= 9; digit++) {
      const event = await act(async () => keydown(target, { key: String(digit), code: `Digit${digit}`, keyCode: 48 + digit, metaKey: true }))
      expect(event.defaultPrevented, `⌘${digit}`).toBe(false)
    }
    expect(received).toHaveBeenCalledTimes(9)
    expect(onSwitch).not.toHaveBeenCalled()
    expect(useDocSwitcherStore.getState().cycleTargetId).toBeNull()
    target.remove()
  })

  it('對照：⌃Tab 確實被切換器攔下（證明上面兩支量得到攔截）', async () => {
    await mountSwitcher()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const received = vi.fn()
    target.addEventListener('keydown', received)
    const event = await act(async () => keydown(target, { key: 'Tab', code: 'Tab', ctrlKey: true }))
    expect(event.defaultPrevented).toBe(true)
    expect(received).not.toHaveBeenCalled()
    expect(useDocSwitcherStore.getState().cycleTargetId).toBe('c')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    target.remove()
  })

  it('切換器掛著時，TipTap 編輯器的 ⇧Mod7/8/9 照常切換編號／項目／待辦清單', async () => {
    await mountSwitcher()
    const element = document.createElement('div')
    document.body.appendChild(element)
    // 編輯器的清單擴充與正式版相同（tiptap-editor.tsx：StarterKit 關掉 listItem／orderedList，換成 Markdown 版本＋TaskList）。
    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ listItem: false, orderedList: false, link: false, underline: false }),
        MarkdownListItem,
        MarkdownOrderedList,
        TaskList,
        MarkdownTaskItem.configure({ nested: true }),
      ],
      content: '<p>卡片盒的內容。</p>',
    })
    // 不用 focus()：它會 scrollIntoView，jsdom 沒有 getClientRects。keymap 只看 keydown，不需要真的取得焦點。
    editor.commands.setTextSelection(3)
    // prosemirror-keymap 在 jsdom（navigator.platform 不是 Mac）把 Mod 當 Ctrl；macOS 上就是 ⌘。
    const isMac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
    const mod = isMac ? { metaKey: true } : { ctrlKey: true }

    const expected = { 7: 'orderedList', 8: 'bulletList', 9: 'taskList' } as const
    for (const { digit, key, keyCode } of SHIFT_CMD) {
      const event = await act(async () => keydown(editor.view.dom, { key, code: `Digit${digit}`, keyCode, shiftKey: true, ...mod }))
      expect(event.defaultPrevented, `⇧Mod${digit} 由編輯器處理`).toBe(true)
      expect(editor.state.doc.firstChild?.type.name, `⇧Mod${digit}`).toBe(expected[digit])
      // 再按一次切回段落
      await act(async () => keydown(editor.view.dom, { key, code: `Digit${digit}`, keyCode, shiftKey: true, ...mod }))
      expect(editor.state.doc.firstChild?.type.name).toBe('paragraph')
    }
    expect(useDocSwitcherStore.getState().cycleTargetId).toBeNull()
    editor.destroy()
    element.remove()
  })
})

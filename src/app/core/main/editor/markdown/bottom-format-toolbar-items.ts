// Fork（almanac ALMNC-54.17）：V3 編輯器底部浮動格式列的項目定義與「哪些項目亮起」的對應。
// 純資料與純函式，不碰 React，方便測試。畫面在 bottom-format-toolbar.tsx。
import type { EditorShortcutCommandId } from '@/config/editor-shortcuts'

export type BottomToolbarItemId =
  | 'bold' | 'italic' | 'underline' | 'strike' | 'code'
  | 'heading1' | 'heading2' | 'heading3'
  | 'highlight' | 'textColor' | 'bulletList'
  | 'table' | 'image' | 'link'
  | 'attachment'
  | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock' | 'horizontalRule' | 'clearFormatting'

export interface BottomToolbarItem {
  id: BottomToolbarItemId
  /** 有對應的編輯器快捷鍵時，名稱用設定頁同一份翻譯、提示裡附上目前的快捷鍵 */
  shortcut?: EditorShortcutCommandId
  /** 給 editor.isActive 的參數；沒有就是不會亮的動作（插入類） */
  active?: { name: string, attrs?: Record<string, unknown> }
}

/** 底部列：依參考圖分五組，組與組之間有細分隔線；最後是「⋯ 更多」。 */
export const BOTTOM_TOOLBAR_GROUPS: BottomToolbarItem[][] = [
  [
    { id: 'bold', shortcut: 'toggleBold', active: { name: 'bold' } },
    { id: 'italic', shortcut: 'toggleItalic', active: { name: 'italic' } },
    { id: 'underline', shortcut: 'toggleUnderline', active: { name: 'underline' } },
    { id: 'strike', shortcut: 'toggleStrike', active: { name: 'strike' } },
    { id: 'code', shortcut: 'toggleInlineCode', active: { name: 'code' } },
  ],
  [
    { id: 'heading1', shortcut: 'toggleHeading1', active: { name: 'heading', attrs: { level: 1 } } },
    { id: 'heading2', shortcut: 'toggleHeading2', active: { name: 'heading', attrs: { level: 2 } } },
    { id: 'heading3', shortcut: 'toggleHeading3', active: { name: 'heading', attrs: { level: 3 } } },
  ],
  [
    { id: 'highlight', shortcut: 'toggleHighlight', active: { name: 'highlight' } },
    { id: 'textColor', active: { name: 'textColor' } },
    { id: 'bulletList', shortcut: 'toggleBulletList', active: { name: 'bulletList' } },
  ],
  [
    { id: 'table', shortcut: 'insertTable' },
    { id: 'image', shortcut: 'insertImage' },
    { id: 'link', shortcut: 'openLinkInput', active: { name: 'link' } },
  ],
  [
    { id: 'attachment' },
  ],
]

/** 「⋯ 更多」選單裡的項目。 */
export const BOTTOM_TOOLBAR_MORE: BottomToolbarItem[] = [
  { id: 'orderedList', shortcut: 'toggleOrderedList', active: { name: 'orderedList' } },
  { id: 'taskList', shortcut: 'toggleTaskList', active: { name: 'taskList' } },
  { id: 'blockquote', shortcut: 'toggleBlockquote', active: { name: 'blockquote' } },
  { id: 'codeBlock', shortcut: 'toggleCodeBlock', active: { name: 'codeBlock' } },
  { id: 'horizontalRule', shortcut: 'insertHorizontalRule' },
  { id: 'clearFormatting' },
]

export type IsActive = (name: string, attrs?: Record<string, unknown>) => boolean

/** 目前游標／選取範圍下亮起的項目（含「更多」裡的）。 */
export function activeToolbarItems(isActive: IsActive): Set<BottomToolbarItemId> {
  const active = new Set<BottomToolbarItemId>()
  for (const item of [...BOTTOM_TOOLBAR_GROUPS.flat(), ...BOTTOM_TOOLBAR_MORE]) {
    if (item.active && isActive(item.active.name, item.active.attrs)) active.add(item.id)
  }
  return active
}

/** 快捷鍵顯示成 macOS 的符號（⌘⇧⌥⌃），其他平台用 Ctrl+／Shift+／Alt+。空字串代表沒有快捷鍵。 */
export function formatShortcutLabel(shortcut: string, mac: boolean): string {
  if (!shortcut) return ''
  const parts = shortcut.split('+').filter(Boolean)
  const key = parts.pop() ?? ''
  const keyLabel = key.length === 1 ? key.toUpperCase() : key
  if (mac) {
    const symbols: Record<string, string> = { Shift: '⇧', Mod: '⌘', Meta: '⌘', Ctrl: '⌃', Alt: '⌥' }
    const order = ['Ctrl', 'Alt', 'Shift', 'Mod', 'Meta']
    const mods = order.filter(mod => parts.includes(mod)).map(mod => symbols[mod])
    return `${mods.join('')}${keyLabel}`
  }
  const names: Record<string, string> = { Shift: 'Shift', Mod: 'Ctrl', Meta: 'Win', Ctrl: 'Ctrl', Alt: 'Alt' }
  const order = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta']
  const mods = [...new Set(order.filter(mod => parts.includes(mod)).map(mod => names[mod]))]
  return [...mods, keyLabel].join('+')
}

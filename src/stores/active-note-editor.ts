// Fork（almanac）：V3 編輯區右上角的筆記工具列（editor-note-toolbar.tsx）在編輯器外面，
// 由使用中的 Markdown 編輯器（md-editor-wrapper.tsx）把自己的編輯器實例與大綱開關登記到這裡。
// 只存在記憶體；舊編輯器的清理不會蓋掉新登記的那一個（同 editor-outline store 的做法）。
import type { Editor } from '@tiptap/react'
import { create } from 'zustand'

export interface ActiveNoteEditor {
  editor: Editor
  path: string
  outlineOpen: boolean
  toggleOutline: () => void
}

interface ActiveNoteEditorState {
  active: ActiveNoteEditor | null
  register: (entry: ActiveNoteEditor) => () => void
}

export const useActiveNoteEditorStore = create<ActiveNoteEditorState>((set, get) => ({
  active: null,
  register: (entry) => {
    set({ active: entry })
    return () => {
      if (get().active === entry) set({ active: null })
    }
  },
}))

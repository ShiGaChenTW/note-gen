// Fork（almanac ALMNC-54.16）：新增文件後要把游標放進哪一篇的標題欄位。標題欄位掛上時取走這個請求，只用一次。
import { create } from 'zustand'

interface TitleFocusState {
  pendingPath: string | null
  request: (path: string) => void
  /** 是這一篇的請求就取走並回傳 true。 */
  consume: (path: string) => boolean
}

export const useTitleFocusStore = create<TitleFocusState>((set, get) => ({
  pendingPath: null,
  request: path => set({ pendingPath: path }),
  consume: path => {
    if (get().pendingPath !== path) return false
    set({ pendingPath: null })
    return true
  },
}))

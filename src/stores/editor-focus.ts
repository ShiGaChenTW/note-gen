import { create } from 'zustand'

// Fork（almanac ALMNC-63）：專注模式只在這次啟動有效。故意不放進設定 store，
// 因為設定 store 的每個欄位都會自動存檔並同步到其他裝置。
interface EditorFocusState {
  focusMode: boolean
  setFocusMode: (enabled: boolean) => void
  toggleFocusMode: () => void
}

export const useEditorFocusStore = create<EditorFocusState>((set) => ({
  focusMode: false,
  setFocusMode: (focusMode) => set({ focusMode }),
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
}))

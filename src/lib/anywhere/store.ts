// Fork（almanac ALMNC-9）：⌘K／⌘⇧P 命令面板與隨處對話面板的開關狀態。
import { create } from 'zustand'

interface AnywhereState {
  paletteOpen: boolean
  chatOpen: boolean
  /** Fork（almanac ALMNC-54.18）：V3 的 AnywhereService 掛著時為 true；這時 ⌘⇧P 交給它，上游的外掛命令面板不接。 */
  paletteHosted: boolean
  setPaletteOpen: (open: boolean) => void
  togglePalette: () => void
  setChatOpen: (open: boolean) => void
  toggleChat: () => void
}

export const useAnywhereStore = create<AnywhereState>((set) => ({
  paletteOpen: false,
  chatOpen: false,
  paletteHosted: false,
  // 兩個面板不同時開：開一個就收另一個
  setPaletteOpen: (paletteOpen) => set(paletteOpen ? { paletteOpen, chatOpen: false } : { paletteOpen }),
  togglePalette: () => set(state => (state.paletteOpen ? { paletteOpen: false } : { paletteOpen: true, chatOpen: false })),
  setChatOpen: (chatOpen) => set(chatOpen ? { chatOpen, paletteOpen: false } : { chatOpen }),
  toggleChat: () => set(state => (state.chatOpen ? { chatOpen: false } : { chatOpen: true, paletteOpen: false })),
}))

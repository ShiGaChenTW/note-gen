import { create } from 'zustand'

import {
  FOCUS_BLUR_LEVELS,
  FOCUS_CARD_WIDTHS,
  type FocusBlurLevel,
  type FocusCardWidth,
} from '@/lib/focus-transition'

// Fork（almanac ALMNC-63）：專注模式只在這次啟動有效。故意不放進設定 store，
// 因為設定 store 的每個欄位都會自動存檔並同步到其他裝置。
// 背景模糊程度與閱讀卡片寬度是這台電腦的偏好，存在 localStorage（讀寫失敗就用預設值）。
interface EditorFocusState {
  focusMode: boolean
  blurLevel: FocusBlurLevel
  cardWidth: FocusCardWidth
  setFocusMode: (enabled: boolean) => void
  toggleFocusMode: () => void
  setBlurLevel: (level: FocusBlurLevel) => void
  setCardWidth: (width: FocusCardWidth) => void
}

const BLUR_KEY = 'almanac:focus-blur'
const WIDTH_KEY = 'almanac:focus-card-width'

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = globalThis.localStorage?.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // 私密模式或被擋：只在這次啟動有效
  }
}

export const useEditorFocusStore = create<EditorFocusState>((set) => ({
  focusMode: false,
  blurLevel: read(BLUR_KEY, FOCUS_BLUR_LEVELS, 'medium'),
  cardWidth: read(WIDTH_KEY, FOCUS_CARD_WIDTHS, 'narrow'),
  setFocusMode: (focusMode) => set({ focusMode }),
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
  setBlurLevel: (blurLevel) => {
    write(BLUR_KEY, blurLevel)
    set({ blurLevel })
  },
  setCardWidth: (cardWidth) => {
    write(WIDTH_KEY, cardWidth)
    set({ cardWidth })
  },
}))

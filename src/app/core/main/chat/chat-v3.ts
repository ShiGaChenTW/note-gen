import { createContext, useContext, type KeyboardEvent } from 'react'

export const ChatV3Context = createContext(false)
export const useChatV3 = () => useContext(ChatV3Context)

export function isChatModeShortcut(
  event: KeyboardEvent<HTMLTextAreaElement>,
  menuOpen: boolean,
  composing: boolean,
) {
  return event.key === 'Tab' && !event.repeat
    && !menuOpen && !composing && !event.nativeEvent.isComposing && event.keyCode !== 229
    && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.defaultPrevented
}

// Spike（almanac ALMNC-77）：TipTap 輸入框拿到的是原生 KeyboardEvent，條件與上面相同。
export function isChatModeShortcutKey(
  event: globalThis.KeyboardEvent,
  menuOpen: boolean,
  composing: boolean,
) {
  return event.key === 'Tab' && !event.repeat
    && !menuOpen && !composing && !event.isComposing && event.keyCode !== 229
    && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.defaultPrevented
}

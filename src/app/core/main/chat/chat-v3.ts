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

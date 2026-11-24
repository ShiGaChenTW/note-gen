// Spike（almanac ALMNC-77）：輸入框按鍵判斷，獨立成純函式好測。
// ProseMirror 在組字中（view.composing）本來就不會呼叫 handleKeyDown；這裡補的是
// Safari／WKWebView 先發 compositionend、再發 keyCode 229 的 Enter，以及其他輸入法殘留的按鍵。

export interface ComposerKeyEvent {
  key: string
  keyCode: number
  isComposing: boolean
  shiftKey: boolean
}

export interface ComposerKeyState {
  menuOpen: boolean
  /** ProseMirror 的 view.composing。 */
  composing: boolean
  /** compositionend 之後、同一輪事件迴圈內（沿用舊輸入框 setTimeout 0 的做法）。 */
  compositionJustEnded: boolean
}

export type ComposerKeyAction =
  | 'menu-up'
  | 'menu-down'
  | 'menu-select'
  | 'menu-close'
  | 'submit'
  /** 輸入法確認字用的 Enter：吞掉，不送出、不換行、不選選單。 */
  | 'swallow'
  /** 交給下一層（父元件的 Tab／歷史紀錄／Backspace，再來是 TipTap 預設鍵盤）。 */
  | 'pass'

export function isImeKeyEvent(event: ComposerKeyEvent, state: Pick<ComposerKeyState, 'composing' | 'compositionJustEnded'>) {
  return state.composing || state.compositionJustEnded || event.isComposing || event.keyCode === 229
}

export function resolveComposerKeyAction(event: ComposerKeyEvent, state: ComposerKeyState): ComposerKeyAction {
  const ime = isImeKeyEvent(event, state)

  if (state.menuOpen) {
    if (ime) return event.key === 'Enter' ? 'swallow' : 'pass'
    if (event.key === 'ArrowDown') return 'menu-down'
    if (event.key === 'ArrowUp') return 'menu-up'
    // 與舊輸入框相同：選單開著時 Enter（含 Shift+Enter）都是選取。
    if (event.key === 'Enter') return 'menu-select'
    if (event.key === 'Escape' || event.key === 'Esc') return 'menu-close'
    return 'pass'
  }

  if (event.key !== 'Enter') return 'pass'
  if (ime) return 'swallow'
  // Shift+Enter 交給 TipTap 的 HardBreak（插入換行）。
  if (event.shiftKey) return 'pass'
  // 與舊輸入框相同：只有 keyCode 13 的 Enter 才送出。
  return event.keyCode === 13 ? 'submit' : 'swallow'
}

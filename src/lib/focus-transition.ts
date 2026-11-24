// Fork（almanac ALMNC-63）：專注模式的轉場，分兩段（和示範稿一樣）：
//  進入：① 視窗平順放大到整個螢幕，同時四周淡入模糊背景；筆記這時還釘在原本的欄位裡跟著長大
//        ② 筆記從欄位平順移到正中間、縮成閱讀卡片
//  退出：倒過來——卡片飛回欄位、模糊淡出，然後視窗縮回原本大小
// 卡片動畫直接改 left／top／width／height（文字跟著重排），不用 scale，字不會被拉扁。

export type FocusBlurLevel = 'light' | 'medium' | 'strong'
export type FocusCardWidth = 'narrow' | 'wide' | 'full'

export const FOCUS_BLUR_LEVELS: readonly FocusBlurLevel[] = ['light', 'medium', 'strong']
export const FOCUS_CARD_WIDTHS: readonly FocusCardWidth[] = ['narrow', 'wide', 'full']

export const FOCUS_BLUR_STYLE: Record<FocusBlurLevel, { blur: number; dim: number }> = {
  light: { blur: 4, dim: 0.12 },
  medium: { blur: 9, dim: 0.26 },
  strong: { blur: 18, dim: 0.42 },
}

/** 視窗放大／縮小 */
export const FOCUS_WINDOW_MS = 450
/** 卡片移動 */
export const FOCUS_CARD_MS = 480
export const FOCUS_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'

export interface Box { left: number; top: number; width: number; height: number }

/** 卡片與欄位兩種樣子；動畫在兩者之間補間 */
export interface BoxStyle extends Box { radius: number; shadow: boolean; paddingTop: number }

function reducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

export function motionMs(ms: number) {
  return reducedMotion() ? 0 : ms
}

export function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

const CARD_SHADOW = 'var(--sh-dialog)'
const NO_SHADOW = '0 0 0 0 transparent'

export function boxKeyframe(style: BoxStyle): Keyframe {
  return {
    left: `${style.left}px`,
    top: `${style.top}px`,
    width: `${style.width}px`,
    height: `${style.height}px`,
    borderRadius: `${style.radius}px`,
    boxShadow: style.shadow ? CARD_SHADOW : NO_SHADOW,
    paddingTop: `${style.paddingTop}px`,
  }
}

const PINNED_PROPERTIES = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'margin', 'border-radius', 'box-shadow', 'padding-top', 'z-index', 'background-color', 'overflow'] as const

/** 用 inline style 把元素固定在某個位置與樣子（蓋過 CSS 的卡片位置）。 */
export function pinBox(element: HTMLElement, style: BoxStyle, zIndex = 40) {
  const s = element.style
  s.setProperty('position', 'fixed')
  s.setProperty('left', `${style.left}px`)
  s.setProperty('top', `${style.top}px`)
  s.setProperty('right', 'auto')
  s.setProperty('bottom', 'auto')
  s.setProperty('width', `${style.width}px`)
  s.setProperty('height', `${style.height}px`)
  s.setProperty('margin', '0')
  s.setProperty('border-radius', `${style.radius}px`)
  s.setProperty('box-shadow', style.shadow ? CARD_SHADOW : NO_SHADOW)
  s.setProperty('padding-top', `${style.paddingTop}px`)
  s.setProperty('z-index', String(zIndex))
  s.setProperty('background-color', 'var(--bg)')
  s.setProperty('overflow', 'hidden')
}

export function unpinBox(element: HTMLElement) {
  for (const property of PINNED_PROPERTIES) element.style.removeProperty(property)
}

/** 從 from 補間到 to；結束時保持在 to（呼叫端再決定要不要 unpin）。 */
export function animateBox(element: HTMLElement, from: BoxStyle, to: BoxStyle, duration: number): Promise<void> {
  pinBox(element, to, Number(element.style.zIndex) || 40)
  if (!duration || typeof element.animate !== 'function') return Promise.resolve()
  const animation = element.animate([boxKeyframe(from), boxKeyframe(to)], { duration, easing: FOCUS_EASING })
  return new Promise(resolve => {
    animation.addEventListener('finish', () => resolve(), { once: true })
    animation.addEventListener('cancel', () => resolve(), { once: true })
  })
}

export function applyBackdropLevel(backdrop: HTMLElement, level: FocusBlurLevel) {
  const { blur, dim } = FOCUS_BLUR_STYLE[level]
  const filter = `blur(${blur}px) saturate(0.9)`
  backdrop.style.backdropFilter = filter
  backdrop.style.setProperty('-webkit-backdrop-filter', filter)
  backdrop.style.backgroundColor = `rgba(0, 0, 0, ${dim})`
}

/** 蓋在 app 上、閱讀卡片下面的模糊背景；建立時是透明的。 */
export function createFocusBackdrop(level: FocusBlurLevel): HTMLElement {
  const backdrop = document.createElement('div')
  backdrop.className = 'editor-focus-backdrop'
  backdrop.setAttribute('aria-hidden', 'true')
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '39',
    opacity: '0',
    transition: 'backdrop-filter 200ms ease-out, background-color 200ms ease-out',
  })
  applyBackdropLevel(backdrop, level)
  return backdrop
}

export function fadeBackdrop(backdrop: HTMLElement, visible: boolean, duration: number): Promise<void> {
  backdrop.style.opacity = visible ? '1' : '0'
  if (!duration || typeof backdrop.animate !== 'function') return Promise.resolve()
  const animation = backdrop.animate([{ opacity: visible ? 0 : 1 }, { opacity: visible ? 1 : 0 }], { duration, easing: FOCUS_EASING })
  return new Promise(resolve => {
    animation.addEventListener('finish', () => resolve(), { once: true })
    animation.addEventListener('cancel', () => resolve(), { once: true })
  })
}

/** 在 duration 期間每一格都執行 step（用來讓釘住的筆記跟著放大中的視窗長大）。 */
export function followEachFrame(duration: number, step: () => void): Promise<void> {
  return new Promise(resolve => {
    const end = performance.now() + duration
    const tick = () => {
      step()
      if (performance.now() >= end) resolve()
      else requestAnimationFrame(tick)
    }
    tick()
  })
}

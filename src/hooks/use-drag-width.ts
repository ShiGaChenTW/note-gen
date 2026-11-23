// Fork（almanac ALMNC-62）：可拖曳的欄寬（像素），存在 localStorage，重開 App 後保留。
// 用在不屬於 react-resizable-panels 的欄（V3 筆記清單）與 V3 左側欄的預設寬度。
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export function clampWidth(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)))
}

export function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) ? clampWidth(value, min, max) : fallback
  } catch {
    return fallback
  }
}

export function storeWidth(key: string, value: number) {
  try { localStorage.setItem(key, String(Math.round(value))) } catch { /* 隱私模式等情況存不了就算了 */ }
}

/** 回傳目前寬度與分隔線要掛的事件。分隔線在欄的右緣，往右拖變寬。 */
export function useDragWidth(key: string, fallback: number, min: number, max: number) {
  const [width, setWidth] = useState(() => readStoredWidth(key, fallback, min, max))
  const drag = useRef<{ x: number; width: number } | null>(null)

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width }
  }, [width])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = drag.current
    if (!start) return
    setWidth(clampWidth(start.width + event.clientX - start.x, min, max))
  }, [min, max])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return
    drag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setWidth(current => { storeWidth(key, current); return current })
  }, [key])

  // 鍵盤：焦點在分隔線上時左右鍵每次 16px，Home／End 到最窄／最寬
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 48 : 16
    const next = event.key === 'ArrowLeft' ? width - step : event.key === 'ArrowRight' ? width + step
      : event.key === 'Home' ? min : event.key === 'End' ? max : null
    if (next === null) return
    event.preventDefault()
    const value = clampWidth(next, min, max)
    setWidth(value)
    storeWidth(key, value)
  }, [key, width, min, max])

  return { width, handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown } }
}

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

if (typeof window !== 'undefined') {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  afterEach(() => {
    cleanup()
  })

  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }

  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }

  if (typeof Element !== 'undefined') {
    if (typeof Element.prototype.scrollIntoView !== 'function') {
      Element.prototype.scrollIntoView = () => {}
    }
    if (typeof Element.prototype.hasPointerCapture !== 'function') {
      Element.prototype.hasPointerCapture = () => false
    }
    if (typeof Element.prototype.setPointerCapture !== 'function') {
      Element.prototype.setPointerCapture = () => {}
    }
    if (typeof Element.prototype.releasePointerCapture !== 'function') {
      Element.prototype.releasePointerCapture = () => {}
    }
  }

  if (typeof window.PointerEvent === 'undefined') {
    class JsdomPointerEvent extends MouseEvent {
      pointerId: number
      width: number
      height: number
      pressure: number
      tangentialPressure: number
      tiltX: number
      tiltY: number
      twist: number
      pointerType: string
      isPrimary: boolean

      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params)
        this.pointerId = params.pointerId ?? 0
        this.width = params.width ?? 1
        this.height = params.height ?? 1
        this.pressure = params.pressure ?? 0
        this.tangentialPressure = params.tangentialPressure ?? 0
        this.tiltX = params.tiltX ?? 0
        this.tiltY = params.tiltY ?? 0
        this.twist = params.twist ?? 0
        this.pointerType = params.pointerType ?? 'mouse'
        this.isPrimary = params.isPrimary ?? true
      }
    }
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: JsdomPointerEvent,
    })
    Object.defineProperty(globalThis, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: JsdomPointerEvent,
    })
  }

  if (typeof DOMRect !== 'undefined' && typeof DOMRect.fromRect !== 'function') {
    DOMRect.fromRect = (rect?: DOMRectInit) => {
      const x = rect?.x ?? 0
      const y = rect?.y ?? 0
      const width = rect?.width ?? 0
      const height = rect?.height ?? 0
      return new DOMRect(x, y, width, height)
    }
  }

  let storageUsable = false
  try {
    storageUsable = typeof window.localStorage?.getItem === 'function'
    if (storageUsable) {
      window.localStorage.getItem('__vitest_probe__')
    }
  } catch {
    storageUsable = false
  }
  if (!storageUsable) {
    const store = new Map<string, string>()
    const memoryStorage: Storage = {
      get length() {
        return store.size
      },
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key)
      },
      setItem: (key: string, value: string) => {
        store.set(key, String(value))
      },
    }
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage })
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage })
  }
}

import { describe, expect, it } from 'vitest'
import { resolveComposerKeyAction, type ComposerKeyEvent, type ComposerKeyState } from './keys'

const key = (overrides: Partial<ComposerKeyEvent> & { key: string }): ComposerKeyEvent => ({
  keyCode: overrides.key === 'Enter' ? 13 : 0,
  isComposing: false,
  shiftKey: false,
  ...overrides,
})

const idle: ComposerKeyState = { menuOpen: false, composing: false, compositionJustEnded: false }
const menu: ComposerKeyState = { ...idle, menuOpen: true }

describe('resolveComposerKeyAction', () => {
  it('Enter 送出，Shift+Enter 交給換行', () => {
    expect(resolveComposerKeyAction(key({ key: 'Enter' }), idle)).toBe('submit')
    expect(resolveComposerKeyAction(key({ key: 'Enter', shiftKey: true }), idle)).toBe('pass')
  })

  it.each([
    ['組字中的 Enter（isComposing）', key({ key: 'Enter', isComposing: true }), idle],
    ['輸入法處理中的 Enter（keyCode 229）', key({ key: 'Enter', keyCode: 229 }), idle],
    ['Safari：compositionend 後緊接的 Enter', key({ key: 'Enter' }), { ...idle, compositionJustEnded: true }],
    ['view.composing 仍為 true', key({ key: 'Enter' }), { ...idle, composing: true }],
  ] as const)('%s：不送出也不換行', (_label, event, state) => {
    expect(resolveComposerKeyAction(event, state)).toBe('swallow')
  })

  it('不是 keyCode 13 的 Enter 不送出（沿用舊輸入框條件）', () => {
    expect(resolveComposerKeyAction(key({ key: 'Enter', keyCode: 0 }), idle)).toBe('swallow')
  })

  it('選單開著：上下鍵移動、Enter 選取、Esc 關閉', () => {
    expect(resolveComposerKeyAction(key({ key: 'ArrowDown' }), menu)).toBe('menu-down')
    expect(resolveComposerKeyAction(key({ key: 'ArrowUp' }), menu)).toBe('menu-up')
    expect(resolveComposerKeyAction(key({ key: 'Enter' }), menu)).toBe('menu-select')
    expect(resolveComposerKeyAction(key({ key: 'Enter', shiftKey: true }), menu)).toBe('menu-select')
    expect(resolveComposerKeyAction(key({ key: 'Escape' }), menu)).toBe('menu-close')
    expect(resolveComposerKeyAction(key({ key: 'a' }), menu)).toBe('pass')
  })

  it('選單開著但在組字：Enter 不選取，上下鍵留給輸入法選字', () => {
    expect(resolveComposerKeyAction(key({ key: 'Enter', keyCode: 229 }), menu)).toBe('swallow')
    expect(resolveComposerKeyAction(key({ key: 'Enter' }), { ...menu, compositionJustEnded: true })).toBe('swallow')
    expect(resolveComposerKeyAction(key({ key: 'ArrowDown', isComposing: true }), menu)).toBe('pass')
    expect(resolveComposerKeyAction(key({ key: 'ArrowUp', keyCode: 229 }), menu)).toBe('pass')
  })

  it('其他按鍵交給下一層', () => {
    expect(resolveComposerKeyAction(key({ key: 'Tab' }), idle)).toBe('pass')
    expect(resolveComposerKeyAction(key({ key: 'Backspace' }), idle)).toBe('pass')
    expect(resolveComposerKeyAction(key({ key: 'ArrowUp' }), idle)).toBe('pass')
  })
})

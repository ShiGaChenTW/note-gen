// Fork（almanac ALMNC-56.7，RPT-2026-009 P08）：分隔線把手的放大效果只用 transform（scale、translate）做動畫，
// 不再以 width、height、margin 做動畫（滑過時不會每幀重算版面）。
import { describe, expect, it } from 'vitest'
import { collapsedPillClassName } from './resizable'

const cases = [
  ['right', true], ['right', false], ['left', true], ['left', false], [undefined, true], [undefined, false],
] as const

describe('collapsedPillClassName', () => {
  it.each(cases)('expand %s, hint %s: animates transform only', (direction, hint) => {
    const classes = collapsedPillClassName(direction, hint).split(/\s+/)
    const transition = classes.find(name => name.startsWith('transition-'))!
    expect(transition).toBe('transition-[translate,scale,background-color,box-shadow]')
    expect(transition).not.toMatch(/width|height|margin/)
    // 尺寸固定；任何狀態（hover、focus）都不再換 width／height／margin
    expect(classes.filter(name => /(^|:)-?(h|w|m[lrxy]?)-/.test(name))).toEqual(['h-20', 'w-7'])
    expect(classes).toContain('scale-x-[0.43]')
    expect(classes).toContain('scale-y-50')
    expect(classes).toContain('group-hover/resize-handle:scale-100')
    expect(classes).toContain('group-focus-visible/resize-handle:scale-100')
  })

  it('slides the pill out with translate the same distance the old margins did', () => {
    expect(collapsedPillClassName('right', true)).toContain('translate-x-[calc(-50%_+_1.5rem)]')
    expect(collapsedPillClassName('right', false)).toContain('translate-x-[calc(-50%_-_1rem)]')
    expect(collapsedPillClassName('right', false)).toContain('group-hover/resize-handle:translate-x-[calc(-50%_+_1.5rem)]')
    expect(collapsedPillClassName('left', true)).toContain('translate-x-[calc(-50%_-_1.5rem)]')
    expect(collapsedPillClassName('left', false)).toContain('translate-x-[calc(-50%_+_1rem)]')
    expect(collapsedPillClassName('left', false)).toContain('group-hover/resize-handle:translate-x-[calc(-50%_-_1.5rem)]')
    expect(collapsedPillClassName(undefined, false)).toContain('-translate-x-1/2')
  })

  it('keeps the resting size of the old pill (12 × 40 px) via scale', () => {
    // w-7 = 28 px × 0.43 ≈ 12 px；h-20 = 80 px × 0.5 = 40 px
    expect(Math.round(28 * 0.43)).toBe(12)
    expect(80 * 0.5).toBe(40)
  })
})

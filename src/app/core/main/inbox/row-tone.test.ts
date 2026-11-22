// almanac ALMNC-56.5（RPT-2026-009 V04）：Inbox 選中列用 bg-active、滑過用 bg-hover，選中一定比滑過深；classic 不變。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PLAIN_ROW, recordRowTone, ROW } from './row-tone'

const classes = (value: string) => value.split(/\s+/).filter(Boolean)

describe('recordRowTone', () => {
  it('V3: hovering an unselected row uses bg-hover', () => {
    expect(classes(recordRowTone(false, false))).toContain('v3:hover:bg-hover')
    expect(classes(PLAIN_ROW)).toContain('v3:hover:bg-hover')
  })

  it('V3: a selected row uses bg-active and keeps it on hover (never the lighter hover tone)', () => {
    const tone = classes(recordRowTone(true, false))
    expect(tone).toEqual(expect.arrayContaining(['v3:bg-active', 'v3:hover:bg-active']))
    expect(tone).not.toContain('v3:hover:bg-hover')
  })

  it('classic keeps its original accent tones', () => {
    expect(ROW).toBe('transition-colors duration-100 hover:bg-accent/70')
    const strip = (value: string) => classes(value).filter(name => !name.startsWith('v3:'))
    expect(strip(recordRowTone(false, false))).toEqual(classes(ROW))
    expect(strip(recordRowTone(true, false))).toEqual([...classes(ROW), 'bg-accent/40'])
    expect(strip(recordRowTone(false, true))).toEqual([...classes(ROW), 'bg-hover', 'hover:bg-active'])
  })

  it('the V3 active tone is darker than the hover tone in both light and dark', () => {
    const theme = readFileSync(new URL('../../../fork-theme.css', import.meta.url), 'utf8')
    for (const block of [':root:where([data-ui="v3"]) {', '.dark:where([data-ui="v3"]) {']) {
      const body = theme.slice(theme.indexOf(block), theme.indexOf('}', theme.indexOf(block)))
      const alpha = (name: string) => Number(new RegExp(`--${name}: rgba\\([^)]*,\\s*([0-9.]+)\\)`).exec(body)![1])
      expect(alpha('active')).toBeGreaterThan(alpha('hover'))
    }
  })
})

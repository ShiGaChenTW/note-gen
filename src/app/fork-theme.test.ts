// almanac P0-a：v5 token 數值與 accent 對比度的防回退測試。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(__dirname, 'fork-theme.css'), 'utf8')
const tokensCss = readFileSync(path.resolve(__dirname, 'fork-tokens.css'), 'utf8')

// ALMNC-7：v5 數值放在新介面開關的區塊內
const V3_SELECTOR = { ':root': ':root:where([data-ui="v3"])', '.dark': '.dark:where([data-ui="v3"])' } as const

function block(selector: ':root' | '.dark'): string {
  const head = `${V3_SELECTOR[selector]} {`
  const start = css.indexOf(`\n${head}`) + 1
  expect(start).toBeGreaterThan(0)
  return css.slice(start, css.indexOf('\n}', start))
}

function token(selector: ':root' | '.dark', name: string): string {
  const match = block(selector).match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'))
  if (!match) throw new Error(`missing --${name} in ${selector}`)
  return match[1].trim()
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ALMNC-33：faint 更新為在 bg、panel 上至少 3.5:1。
// 簡報 §3.1（almanac/2026-11-18_handoff_ornata-style-brief.md）；muted → muted-ink、accent → brand-accent、success → success-ink
const BRIEF = {
  ':root': {
    bg: '#fcfcfd', panel: '#f9f9fa', sunken: '#e9e9e6', statusbar: '#f7f7f8', menu: '#f7f7f8',
    ink: '#191919', 'note-ink': '#191919', 'muted-ink': '#6e6e6a', faint: '#85857f',
    line: '#e3e3e0', 'line-soft': '#ececea',
    hover: 'rgba(25, 25, 25, 0.05)', active: 'rgba(25, 25, 25, 0.09)',
    invert: '#1c1c1c', 'invert-ink': '#fbfbfa',
    danger: '#b3261e', 'success-ink': '#4d8660',
    'brand-accent': '#167a6e', 'brand-accent-ink': '#ffffff',
  },
  '.dark': {
    bg: '#121417', panel: '#17191d', sunken: '#0d0f11', statusbar: '#1a1c20', menu: '#121417',
    ink: '#ebebe8', 'note-ink': '#cbd0d2', 'muted-ink': '#8f8f8a', faint: '#7a7a74',
    line: '#292927', 'line-soft': '#202020',
    hover: 'rgba(235, 235, 232, 0.06)', active: 'rgba(235, 235, 232, 0.1)',
    invert: '#ebebe8', 'invert-ink': '#131313',
    danger: '#e5484d', 'success-ink': '#72b588',
    'brand-accent': '#4cc3b0', 'brand-accent-ink': '#131313',
  },
} as const

describe('fork-theme v5 tokens', () => {
  for (const selector of [':root', '.dark'] as const) {
    it(`${selector} matches brief §3.1`, () => {
      for (const [name, value] of Object.entries(BRIEF[selector])) {
        expect(token(selector, name), `--${name}`).toBe(value)
      }
    })

    it(`${selector} accent and ink keep >= 4.5:1 on --bg`, () => {
      const bg = token(selector, 'bg')
      expect(contrast(token(selector, 'brand-accent'), bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(token(selector, 'ink'), bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(token(selector, 'muted-ink'), bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(token(selector, 'invert-ink'), token(selector, 'invert'))).toBeGreaterThanOrEqual(4.5)
    })

    it(`${selector} faint keeps >= 3.5:1 on both surfaces and stays softer than muted ink`, () => {
      for (const surface of ['bg', 'panel']) {
        const background = token(selector, surface)
        const faint = contrast(token(selector, 'faint'), background)
        expect(faint, surface).toBeGreaterThanOrEqual(3.5)
        expect(faint, surface).toBeLessThan(contrast(token(selector, 'muted-ink'), background))
      }
    })

    it(`${selector} shadcn primary is the monochrome invert, not a hue`, () => {
      // HSL 三元組的飽和度要很低（反白），彩色只能走 --brand-accent
      const saturation = Number(token(selector, 'primary').split(/\s+/)[1].replace('%', ''))
      expect(saturation).toBeLessThan(10)
      expect(token(selector, 'ring')).toBe(token(selector, 'foreground'))
    })
  }

  it('maps v5 tokens into Tailwind and neutralises named hues', () => {
    for (const name of ['bg', 'panel', 'ink', 'faint', 'line', 'brand']) {
      expect(tokensCss).toMatch(new RegExp(`--color-${name}:`))
    }
    expect(tokensCss).toMatch(/--color-blue-500: var\(--hue-blue-500\)/)
    const v3Hues = tokensCss.slice(tokensCss.indexOf(':root:where([data-ui="v3"])'))
    expect(v3Hues).toMatch(/--hue-blue-500: oklch\(55\.3% 0\.013 58\.071\)/)
    expect(tokensCss).not.toMatch(/--color-red-/)
    expect(tokensCss).not.toMatch(/--color-green-/)
  })

  it('keeps the global focus ring overridable by Tailwind utilities', () => {
    expect(css).toMatch(/@layer base \{\s*:where\(\[data-ui="v3"\]\) :where\(button, a, input, textarea, select, \[tabindex\]\):focus-visible/)
  })

  it('keeps the classic palette when the new interface is off', () => {
    const classicRoot = css.slice(css.indexOf('\n:root {') + 1, css.indexOf('\n}', css.indexOf('\n:root {')))
    expect(classicRoot).toMatch(/--primary: 31 92% 35%/)
    const classicHues = tokensCss.slice(tokensCss.indexOf('\n:root {'), tokensCss.indexOf(':root:where([data-ui="v3"])'))
    expect(classicHues).toMatch(/--hue-blue-500: oklch\(62\.3% 0\.214 259\.815\)/)
    expect(tokensCss).toMatch(/@custom-variant v3 /)
  })

  it('respects prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })

  // ALMNC-79.1：圓角收斂（控制項 4px、列 5px、卡片／浮層 6px），classic 維持 0.5rem
  it('uses the tightened v3 radius scale', () => {
    for (const selector of [':root', '.dark'] as const) expect(token(selector, 'radius')).toBe('0.25rem')
    expect(token(':root', 'r-kbd')).toBe('3px')
    expect(token(':root', 'r')).toBe('4px')
    expect(token(':root', 'r-row')).toBe('5px')
    expect(token(':root', 'r-md')).toBe('6px')
    expect(css).toMatch(/:root \{[^}]*--radius: 0\.5rem;/)
  })

  // ALMNC-79.1：介面上的引言不再用色條；青綠的引用色條只留給筆記內文（和 Obsidian 一致）
  it('limits the quote bar in the accent allow-list to note content', () => {
    expect(css).not.toContain('caret、引言色條')
    expect(css).toContain('筆記內文的引用色條')
  })
})

// almanac ALMNC-56.5（RPT-2026-009 V01、V02）：V3 編輯器回到單色規範。
// 讀 style.css 檔尾的 V3 區塊與 fork-theme.css 的色票，確認：
// - 連結、已勾選任務、引言色條用 --brand-accent，classic 的規則原封不動；
// - 程式碼上色只用 token，深淺色模式在程式碼底上都至少 4.5:1；
// - GitHub 提示框只用灰階，Warning、Caution 用 danger。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const style = readFileSync(new URL('./style.css', import.meta.url), 'utf8')
const theme = readFileSync(new URL('../../../../fork-theme.css', import.meta.url), 'utf8')
const v3Start = style.lastIndexOf('/*', style.indexOf('Fork（almanac ALMNC-56.5'))
const v3Block = style.slice(v3Start)
const classicBlock = style.slice(0, v3Start)

interface Rule { selectors: string[], body: string }

/** 依最外層的逗號切開選擇器（:is(.a, .b) 裡的逗號不切）。 */
function splitSelectors(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of list) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  return [...parts, current]
}

function rules(css: string): Rule[] {
  const out: Rule[] = []
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selectors: splitSelectors(match[1]).map(part => part.trim().replace(/\s+/g, ' ')), body: match[2] })
  }
  return out
}

const v3Rules = rules(v3Block)
function v3Declaration(selector: string, property: string): string | undefined {
  const rule = v3Rules.find(item => item.selectors.includes(selector) && new RegExp(`(^|;|\\s)${property}\\s*:`).test(item.body))
  return rule && new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`).exec(rule.body)?.[1].trim()
}

const V3 = ':where([data-ui="v3"]) .tiptap-editor .ProseMirror'

describe('V01: the single accent colour for links, checked tasks and the quote bar', () => {
  it('links and wikilinks use --brand-accent under V3', () => {
    expect(v3Declaration(`${V3} a`, 'color')).toBe('var(--brand-accent)')
    expect(v3Declaration(`${V3} a.notegen-wikilink`, 'color')).toBe('var(--brand-accent)')
    expect(v3Declaration(`${V3} .notegen-embed-body a.notegen-wikilink`, 'color')).toBe('var(--brand-accent)')
  })

  it('checked task boxes are filled with --brand-accent', () => {
    const checked = `${V3} ul[data-type="taskList"] li > label input[type="checkbox"]:checked`
    expect(v3Declaration(checked, 'background-color')).toBe('var(--brand-accent) !important')
    expect(v3Declaration(checked, 'border-color')).toBe('var(--brand-accent) !important')
  })

  it('the plain quote bar uses --brand-accent', () => {
    expect(v3Declaration(`${V3} blockquote`, 'border-left-color')).toBe('var(--brand-accent)')
  })

  it('classic rules are untouched (still the classic primary colour)', () => {
    expect(classicBlock).toMatch(/\.tiptap-editor \.ProseMirror a \{\s*color: hsl\(var\(--primary\)\);/)
    expect(classicBlock).not.toContain('data-ui="v3"] .tiptap-editor .ProseMirror a')
    for (const rule of v3Rules) {
      for (const selector of rule.selectors) expect(selector).toMatch(/^:(where|is)\(\[data-ui="v3"\]\)/)
    }
  })
})

/** fork-theme.css 某個區塊裡的 token。 */
function tokens(blockStart: string): Record<string, string> {
  const start = theme.indexOf(blockStart)
  const body = theme.slice(start, theme.indexOf('\n}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]))
}

type Rgb = [number, number, number]
const hex = (value: string): Rgb => {
  const digits = value.replace('#', '')
  return [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16)) as Rgb
}
function hsl(triple: string): Rgb {
  const [h, s, l] = triple.split(/\s+/).map(part => parseFloat(part))
  const sat = s / 100
  const light = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)].map(channel => Math.round(channel * 255)) as Rgb
}
const mix = (a: Rgb, b: Rgb, weightA: number): Rgb => a.map((channel, index) => channel * weightA + b[index] * (1 - weightA)) as Rgb
function luminance([r, g, b]: Rgb) {
  const linear = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}
function contrast(a: Rgb, b: Rgb) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** 解析語法色：var(--x) 或 color-mix(in srgb, var(--a) N%, var(--b))。 */
function resolve(value: string, palette: Record<string, string>): Rgb {
  const mixed = /color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, var\(--([\w-]+)\)\)/.exec(value)
  if (mixed) return mix(resolve(`var(--${mixed[1]})`, palette), resolve(`var(--${mixed[3]})`, palette), Number(mixed[2]) / 100)
  const name = /var\(--([\w-]+)\)/.exec(value)![1]
  return hex(palette[name])
}

describe('V02: code highlighting and GitHub alerts', () => {
  const syntaxRule = v3Rules.find(rule => rule.selectors.includes(':where([data-ui="v3"]) .tiptap-editor') && rule.body.includes('--syntax-'))!
  const syntax = Object.fromEntries([...syntaxRule.body.matchAll(/--(syntax-[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]))

  it('the V3 block has no hard-coded colours', () => {
    expect(v3Block.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsl\(/i)
  })

  it('every highlight.js class coloured in classic is recoloured with a syntax token under V3', () => {
    const classes = new Set([...classicBlock.matchAll(/\.hljs-[\w-]+/g)].map(match => match[0]))
    expect(classes.size).toBeGreaterThan(20)
    for (const name of classes) {
      expect(v3Declaration(`${V3} pre code ${name}`, 'color'), name).toMatch(/^var\(--syntax-[\w-]+\)$/)
    }
  })

  it('syntax colours reach 4.5:1 on the code background in light and dark', () => {
    const modes = [
      { name: 'light', palette: tokens(':root:where([data-ui="v3"]) {'), alpha: 0.5 },
      { name: 'dark', palette: tokens('.dark:where([data-ui="v3"]) {'), alpha: 0.3 },
    ]
    for (const { name, palette, alpha } of modes) {
      // .tiptap-editor .ProseMirror pre：淺色 hsl(var(--muted) / 0.5)、深色 / 0.3，疊在 --card 上
      const background = mix(hsl(palette.muted), hsl(palette.card), alpha)
      for (const [token, value] of Object.entries(syntax)) {
        expect(contrast(resolve(value, palette), background), `${name} ${token}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('alerts are greyscale; Warning and Caution use danger', () => {
    expect(v3Declaration(`${V3} blockquote.markdown-alert`, 'border-left-color')).toBe('var(--line)')
    expect(v3Declaration(`${V3} blockquote.markdown-alert .markdown-alert-title`, 'color')).toBe('var(--muted-ink)')
    const danger = `${V3} blockquote.markdown-alert:is(.markdown-alert-warning, .markdown-alert-caution)`
    expect(v3Declaration(danger, 'border-left-color')).toBe('var(--danger)')
    expect(v3Declaration(`${danger} .markdown-alert-title`, 'color')).toBe('var(--danger)')
  })
})

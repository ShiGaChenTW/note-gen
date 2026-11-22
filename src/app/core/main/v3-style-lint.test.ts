// Fork（almanac ALMNC-56.6，RPT-2026-009 V08、V09、V13、V14、V15）：V3 元件的樣式「lint」。
// 掃 V3 元件的原始碼，擋下繞過 token 的寫法：
// - V08：任意字級 text-[11px]、text-[12.5px]…（11／13／15 px 用 text-ui-numeric／text-ui-compact／text-ui-emphasis，12／14 px 用 text-xs／text-sm）
// - V09：字重只用 500（font-medium）與 600（font-semibold）；font-normal 只用來把繼承來的粗體還原成內文字重。
//   字距：標籤字距只有一種（tracking-[0.08em]，SectionLabel 的拉丁字標籤），大標題用 tracking-tight，其他不設。
// - V13：唯一彩色（text-brand、bg-brand…）只出現在白名單用途：連結、已勾選任務、caret、引言色條。
// - V14：圓角只用 --r-kbd、--r、--r-md（rounded-(--r-kbd) 等），圓形用 rounded-full。
// - V15：鍵盤提示用 components/ui/kbd.tsx（不直接寫 <kbd>）；閱讀寬度用 max-w-ui-reading（不寫 max-w-[720px]）。
// classic 專用與行動版的檔案不在掃描範圍。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../../..')

/** V3 元件：側欄、工作台、對話、收集、今天、筆記清單、components/v3、編輯區上下兩條工具列。 */
const TARGETS = [
  'app/core/main/sidebar-v3',
  'app/core/main/decide',
  'app/core/main/threads',
  'app/core/main/collect',
  'app/core/main/today-v3',
  'app/core/main/note-list',
  'components/v3',
  'components/ui/kbd.tsx',
  'app/core/main/sidebar-row.ts',
  'app/core/main/editor/editor-note-toolbar.tsx',
  'app/core/main/editor/markdown/bottom-format-toolbar.tsx',
]

function sourceFiles(path: string): string[] {
  const absolute = join(SRC, path)
  if (statSync(absolute).isFile()) return [absolute]
  return readdirSync(absolute).flatMap(name => sourceFiles(join(path, name)))
}

const FILES = TARGETS.flatMap(sourceFiles).filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))

/** 新舊介面共用的元件：只檢查 v3: 變體（classic 的類別維持原樣）。 */
const DUAL_MODE = new Set(['components/ui/kbd.tsx', 'app/core/main/sidebar-row.ts', 'components/v3/toolbar.tsx'])

interface Hit { file: string, line: number, match: string, text: string }

/** 類別前面可以有任意變體（v3:、hover:、md:…）。 */
const VARIANTS = String.raw`(?<![\w-])(?:[\w-]+(?:-\[[^\]]*\])?:)*`

function scan(pattern: RegExp, allowed: (hit: Hit) => boolean = () => false): Hit[] {
  const hits: Hit[] = []
  for (const file of FILES) {
    readFileSync(file, 'utf8').split('\n').forEach((text, index) => {
      for (const match of text.matchAll(pattern)) {
        const hit = { file: relative(SRC, file), line: index + 1, match: match[0], text: text.trim() }
        if (DUAL_MODE.has(hit.file) && !/^v3:/.test(hit.match) && !hit.match.startsWith('<')) continue
        if (!allowed(hit)) hits.push(hit)
      }
    })
  }
  return hits
}

const show = (hits: Hit[]) => hits.map(hit => `${hit.file}:${hit.line}  ${hit.match}`)

/**
 * V13 白名單：唯一彩色只給連結、已勾選任務、caret、引言色條。
 * 每一筆都寫明用途；新的用法要先確認屬於這四種，再加進來。
 */
const BRAND_ALLOWLIST: Array<{ file: string, contains: string, purpose: 'link' | 'checked-task' | 'caret' | 'quote-bar' }> = [
  // 今天頁：日誌「打開／建立」與「全部」是文字連結；待辦已勾選的勾選框
  { file: 'app/core/main/today-v3/today-v3-screen.tsx', contains: 'text-brand outline-none hover:underline', purpose: 'link' },
  { file: 'app/core/main/today-v3/today-v3-screen.tsx', contains: "item.done ? 'border-brand bg-brand text-brand-ink'", purpose: 'checked-task' },
  // 工作台需處理清單：「查看全部 N 件」文字連結
  { file: 'app/core/main/decide/decide-needs.tsx', contains: 'text-brand outline-none hover:underline', purpose: 'link' },
]

describe('V3 style lint (RPT-2026-009)', () => {
  it('scans the V3 component sources', () => {
    expect(FILES.length).toBeGreaterThan(30)
  })

  it('V08: no arbitrary font sizes such as text-[10.5px] or text-[13px]', () => {
    expect(show(scan(new RegExp(`${VARIANTS}text-\\[\\d+(?:\\.\\d+)?(?:px|rem|em)\\]`, 'g')))).toEqual([])
  })

  it('V09: font weights are only 500 and 600 (font-normal only resets inherited bold)', () => {
    expect(show(scan(new RegExp(`${VARIANTS}font-(?:\\[\\d+\\]|thin|extralight|light|bold|extrabold|black)(?![\\w-])`, 'g')))).toEqual([])
    expect(show(scan(/fontWeight\s*:/g))).toEqual([])
  })

  it('V09: one label tracking (tracking-[0.08em]); headings may use tracking-tight', () => {
    const allowed = new Set(['tracking-normal', 'tracking-tight', 'tracking-[0.08em]'])
    expect(show(scan(new RegExp(`${VARIANTS}tracking-(?:\\[[^\\]]+\\]|[a-z]+)`, 'g'), hit => allowed.has(hit.match.replace(/^.*:/, ''))))).toEqual([])
  })

  it('V13: the accent colour appears only in allow-listed uses (links, checked tasks, caret, quote bar)', () => {
    const pattern = new RegExp(`${VARIANTS}(?:text|bg|border|ring|fill|stroke|decoration|outline|caret|accent|from|to|via)-brand(?:-ink)?(?:\\/\\d+)?(?![\\w-])`, 'g')
    const hits = scan(pattern, hit => BRAND_ALLOWLIST.some(entry => hit.file === entry.file && hit.text.includes(entry.contains)))
    expect(show(hits)).toEqual([])
    // 白名單每一筆都還對得到程式碼（程式改了就要回來檢查）
    for (const entry of BRAND_ALLOWLIST) {
      expect(scan(pattern).some(hit => hit.file === entry.file && hit.text.includes(entry.contains)), entry.contains).toBe(true)
    }
  })

  it('V14: radii only use --r-kbd, --r, --r-md (rounded-full for circles)', () => {
    const ok = /^rounded(?:-[trblse]{1,2})?-(?:\((?:--r-kbd|--r|--r-md)\)|full|none)$/
    const pattern = new RegExp(`${VARIANTS}rounded(?:-[trblse]{1,2})?(?:-\\[[^\\]]+\\]|-\\([^)]+\\)|-[a-z0-9]+)?(?![\\w-])`, 'g')
    expect(show(scan(pattern, hit => ok.test(hit.match.replace(/^.*:/, ''))))).toEqual([])
  })

  it('V06: primary buttons in 對話, 收集, 工作台 share V3_BUTTON_SHAPE and the Button colours (no manual bg-invert)', () => {
    const read = (file: string) => readFileSync(join(SRC, file), 'utf8')
    expect(read('components/v3/button-shape.ts')).toContain("export const V3_BUTTON_SHAPE = 'h-8 rounded-(--r)'")
    for (const file of [
      'app/core/main/threads/threads-screen.tsx',
      'app/core/main/collect/collect-screen.tsx',
      'app/core/main/decide/review-card.tsx',
      'app/core/main/decide/desk.tsx',
    ]) {
      const text = read(file)
      expect(text, file).toContain('V3_BUTTON_SHAPE')
      expect(text, file).not.toMatch(/<Button\b[^>]*bg-invert/)
    }
    expect(read('app/core/main/decide/review-card.tsx')).toMatch(/BTN_PRIMARY = 'border-transparent bg-primary text-primary-foreground hover:bg-primary\/80'/)
  })

  it('V11: no hand-rolled section headings (faint h2／h3) — use SectionLabel', () => {
    expect(show(scan(/<h[2-4]\b[^>]*text-faint/g))).toEqual([])
  })

  it('V15: keyboard hints use components/ui/kbd.tsx; reading width uses max-w-ui-reading', () => {
    expect(show(scan(/<kbd\b/g, hit => hit.file === 'components/ui/kbd.tsx'))).toEqual([])
    expect(show(scan(new RegExp(`${VARIANTS}max-w-\\[\\d+px\\]`, 'g')))).toEqual([])
  })
})

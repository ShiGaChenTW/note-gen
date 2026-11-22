// almanac ALMNC-49：休眠畫面。vitest 的 node 環境沒有 canvas，所以：
//   排版（layout.ts）→ 快照＋規則檢查（AC #2–#5）
//   BMP（bmp.ts）     → 用合成的像素驗檔頭、大小、位元排列
//   繪圖（render.ts） → 用假的 2D context 驗呼叫（字型、maxWidth）與轉灰階
// ALMNC-58：實機確認 8-bit 灰階（256 色盤，約 385 KB）可下載、細緻度同 24-bit；檔案必須小於外掛 1 MB 上限。
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Briefing } from '@/lib/eink/briefing/types'
import { SLEEP_TEXTS, UPDATED_AT, busyDay, emptyDay, normalDay, privateDay, unavailableDay } from './__fixtures__/days'
import { bmpFileSize, bmpRowBytes, decodeBmpGray, encodeBmp, readBmpHeader, SLEEP_BMP_MAX_BYTES } from './bmp'
import { buildSleepBmp } from './index'
import { briefingHint, duration, layoutSleepScreen, textWidth, truncate, wrap, type DrawOp, type SleepLayout } from './layout'
import { SLEEP_BMP_BIT_DEPTH, SLEEP_BMP_PALETTE_SIZE, SLEEP_HEIGHT, SLEEP_MAX_EVENTS, SLEEP_WIDTH } from './params'
import { cssFont, drawSleepLayout, grayToRgba, rgbaToGray, type Context2D } from './render'

type TextOp = Extract<DrawOp, { op: 'text' }>

const layout = (briefing: Briefing, pages = 24) => layoutSleepScreen(briefing, { updatedAt: UPDATED_AT, texts: SLEEP_TEXTS, briefingPages: pages })
const texts = (l: SleepLayout) => l.ops.filter((op): op is TextOp => op.op === 'text')
const allText = (l: SleepLayout) => texts(l).map(op => op.text).join('\n')
const dots = (l: SleepLayout) => l.ops.filter(op => op.op === 'dot')

/** 快照用的文字格式：一行一個繪圖指令，看 diff 就知道哪裡跑位。 */
function serialize(l: SleepLayout): string {
  return l.ops.map(op => {
    switch (op.op) {
      case 'text': return `text ${op.x},${op.y}${op.align === 'right' ? ' right' : ''} ${op.font.family}${op.font.size}${op.font.weight === 600 ? 'b' : ''} g${op.gray} w${op.maxWidth} ${JSON.stringify(op.text)}`
      case 'rect': return `rect ${op.x},${op.y} ${op.w}x${op.h} g${op.gray}`
      case 'frame': return `frame ${op.x},${op.y} ${op.w}x${op.h} g${op.gray}`
      case 'dot': return `dot ${op.cx},${op.cy} r${op.r} g${op.gray}`
    }
    return ''
  }).join('\n')
}

/** 所有文字都在畫面內、左右邊界 20px 以內（估算字寬，跟 canvas 的 maxWidth 一起保證不超出）。 */
function expectInsideMargins(l: SleepLayout) {
  for (const op of texts(l)) {
    const width = textWidth(op.text, op.font)
    expect(width, op.text).toBeLessThanOrEqual(op.maxWidth)
    const left = op.align === 'right' ? op.x - width : op.x
    expect(left, op.text).toBeGreaterThanOrEqual(20)
    expect(left + width, op.text).toBeLessThanOrEqual(SLEEP_WIDTH - 20)
    expect(op.y, op.text).toBeGreaterThan(op.font.size)
    expect(op.y, op.text).toBeLessThanOrEqual(SLEEP_HEIGHT)
  }
}

const SCENARIOS: Record<string, () => Briefing> = { normal: normalDay, busy: busyDay, private: privateDay, empty: emptyDay, unavailable: unavailableDay }

describe('排版快照（AC #5：上述情況都有快照）', () => {
  for (const [name, build] of Object.entries(SCENARIOS)) {
    it(name, () => {
      const l = layout(build())
      expect(l.width).toBe(480)
      expect(l.height).toBe(800)
      expectInsideMargins(l)
      expect(serialize(l)).toMatchSnapshot()
    })
  }

  it('同一份簡報＋同一個更新時間 ⇒ 同一份繪圖指令', () => {
    expect(layout(normalDay())).toEqual(layout(normalDay()))
  })
})

describe('內容', () => {
  it('日期星期、角落「更新於 HH:MM」、四格天氣（溫度＋降雨）＋最高最低、底部簡報提示', () => {
    const l = layout(normalDay())
    const t = allText(l)
    expect(t).toContain('2026-11-21')
    expect(t).toContain('星期六')
    expect(texts(l).find(op => op.text === '更新於 06:42')?.align).toBe('right')
    expect(t).toContain('高 22° 低 10° · 降雨 80%')
    for (const part of ['早', '午', '晚', '夜', '14°', '21°', '17°', '12°', '降雨 10%', '降雨 60%']) expect(t).toContain(part)
    expect(t).toContain('今日簡報 約 24 頁 · 新：釘選 1 · 文章 3 · 回顧 1 · 報告')
  })

  it('天氣四格在行程上方', () => {
    const l = layout(normalDay())
    const weatherY = texts(l).find(op => op.text === '14°')?.y ?? Infinity
    const firstEventY = Math.min(...dots(l).map(op => (op.op === 'dot' ? op.cy : Infinity)))
    expect(weatherY).toBeLessThan(firstEventY)
  })

  it('行程：時間、標題、地點；時間欄用等寬字、靠左對齊在同一個 x', () => {
    const l = layout(normalDay())
    const t = allText(l)
    expect(t).toContain('牙醫回診')
    expect(t).toContain('14:00–15:00 · 1h · 信義路診所')
    const times = texts(l).filter(op => /^\d\d:\d\d$/.test(op.text))
    expect(times.map(op => op.text)).toEqual(['09:30', '11:00', '14:00', '15:00', '19:30'])
    expect(new Set(times.map(op => op.x))).toEqual(new Set([20]))
    expect(times.every(op => op.font.family === 'mono')).toBe(true)
    // 一列一列往下排，不重疊
    const ys = times.map(op => op.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
  })

  it('長標題最多兩行，超過的加「…」', () => {
    const t = allText(layout(normalDay()))
    expect(t).toContain('V3 驗收：對話頁與開工卡，順便確認')
    expect(t).toMatch(/…/)
  })
})

describe('行程超過 8 件（AC #2）', () => {
  it('只畫前 8 件，最後一行「另有 N 件 · 見簡報第 1 章」；全天行程在最上面一條、不佔 8 件', () => {
    const l = layout(busyDay())
    expect(SLEEP_MAX_EVENTS).toBe(8)
    expect(dots(l)).toHaveLength(8)
    const t = allText(l)
    expect(t).toContain('第 8 件行程')
    expect(t).not.toContain('第 9 件行程')
    expect(t).toContain('另有 3 件 · 見簡報第 1 章')
    const allDay = texts(l).find(op => op.text === '員工旅遊報名截止')
    const first = texts(l).find(op => op.text === '第 1 件行程')
    expect(allDay && first && allDay.y < first.y).toBe(true)
    const more = texts(l).find(op => op.text.startsWith('另有'))
    const last = texts(l).find(op => op.text === '第 8 件行程')
    expect(more && last && more.y > last.y).toBe(true)
  })

  it('剛好 8 件不顯示「另有」', () => {
    const briefing = busyDay()
    const schedule = briefing.chapters.find(c => c.kind === 'schedule')
    if (schedule?.kind === 'schedule') schedule.items = schedule.items.slice(0, 9)
    const l = layout(briefing)
    expect(dots(l)).toHaveLength(8)
    expect(allText(l)).not.toContain('另有')
  })
})

describe('私人行程與沒有行程的日子（AC #3）', () => {
  it('私人行程只顯示「私人行程」和時間（不顯示標題、地點）；全天的也一樣', () => {
    const t = allText(layout(privateDay()))
    expect(t).not.toContain('心理諮商')
    expect(t).not.toContain('某某診所')
    expect(t).not.toContain('家人生日')
    expect(t).toContain('私人行程')
    expect(t).toContain('13:00–14:00 · 1h')
    expect(t).toContain('產品週會')
    expect(t).toContain('大會議室')
  })

  it('沒有行程：說明一行，時間軸位置改放一張每日回顧卡', () => {
    const l = layout(emptyDay())
    const t = allText(l)
    expect(dots(l)).toHaveLength(0)
    expect(t).toContain('今天沒有行程。')
    expect(t).toContain('每日回顧卡')
    expect(t).toContain('間隔重複')
    expect(t).toContain('間隔重複是把複習排在快要忘記的時候')
    expect(t).toContain('知識/間隔重複.md')
  })

  it('天氣抓不到、行事曆沒授權：照樣產生，顯示說明', () => {
    const t = allText(layout(unavailableDay()))
    expect(t).toContain('天氣暫無資料')
    expect(t).toContain('行事曆沒有授權，讀不到今天的行程。')
  })
})

describe('不出現的東西（AC #4）', () => {
  for (const [name, build] of Object.entries(SCENARIOS)) {
    it(`${name}：沒有「下一個」、現在位置、工作台內容`, () => {
      const l = layout(build())
      const t = allText(l)
      for (const banned of ['下一個', 'NEXT', '現在', '工作台', '工作台要決定的事', '工作台要完成的事', '等你定', '待辦']) expect(t).not.toContain(banned)
      // 現在位置的標記：時間軸上沒有實心圓或橫跨時間軸的線，只有空心圓（dot）
      expect(l.ops.filter(op => op.op === 'rect' && op.h === 2)).toHaveLength(0)
    })
  }

  it('排版不讀現在時間：只用傳入的更新時間', () => {
    const a = layoutSleepScreen(normalDay(), { updatedAt: UPDATED_AT, texts: SLEEP_TEXTS })
    const b = layoutSleepScreen(normalDay(), { updatedAt: UPDATED_AT + 3 * 3600_000, texts: SLEEP_TEXTS })
    expect(serialize(a).replace('更新於 06:42', '')).toBe(serialize(b).replace('更新於 09:42', ''))
  })
})

describe('字寬與斷行（AC #5：中文和時間不跑位）', () => {
  const sans = { family: 'sans' as const, size: 15, weight: 400 as const }
  const mono = { family: 'mono' as const, size: 15, weight: 400 as const }

  it('中文 1em、等寬 0.6em', () => {
    expect(textWidth('中文', sans)).toBe(30)
    expect(textWidth('09:30', mono)).toBe(45)
  })

  it('中文隨處可斷，英文斷在空白，超過行數加「…」', () => {
    expect(wrap('一二三四五六七八九十', 75, sans, 3)).toEqual(['一二三四五', '六七八九十'])
    expect(wrap('hello world again', 99, sans, 3)).toEqual(['hello world', 'again'])
    expect(wrap('一二三四五六七八九十一二三', 75, sans, 2)).toEqual(['一二三四五', '六七八九…'])
    expect(truncate('一二三四五六', 60, sans)).toBe('一二三…')
  })

  it('時長格式', () => {
    expect([duration(30 * 60_000), duration(3600_000), duration(90 * 60_000)]).toEqual(['30m', '1h', '1h30'])
  })

  it('提示行：沒有頁數時只說簡報已備好', () => {
    expect(briefingHint(emptyDay(), SLEEP_TEXTS)).toMatch(/^今日簡報已備好/)
  })
})

describe('BMP（ALMNC-58：8-bit 灰階）', () => {
  const W = SLEEP_WIDTH
  const H = SLEEP_HEIGHT
  /** 合成的像素：0–255 的水平漸層＋左上角一個白點。 */
  function synthetic(): Uint8Array {
    const gray = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) gray[y * W + x] = Math.floor((x * 256) / W)
    gray[0] = 255
    return gray
  }

  it('預設 8-bit、256 色調色盤', () => {
    expect(SLEEP_BMP_BIT_DEPTH).toBe(8)
    expect(SLEEP_BMP_PALETTE_SIZE).toBe(256)
  })

  it('檔頭：bpp 8、256 色、資料從 1,078 開始、大小 385,078 bytes（約 376 KB，小於 1 MB）', () => {
    const bytes = encodeBmp(synthetic(), W, H)
    expect(bytes.length).toBe(385_078)
    expect(bmpFileSize(W, H)).toBe(385_078)
    expect(bytes.length).toBeLessThan(SLEEP_BMP_MAX_BYTES)
    expect(SLEEP_BMP_MAX_BYTES).toBe(1024 * 1024)
    const header = readBmpHeader(bytes)
    expect(header).toMatchObject({
      signature: 'BM', fileSize: 385_078, dataOffset: 1078, width: 480, height: 800, bitDepth: 8, compression: 0, imageSize: 384_000, colors: 256,
    })
    expect(header.palette).toEqual(Array.from({ length: 256 }, (_, v) => v))
  })

  it('調色盤每格是 BGRA = v,v,v,0', () => {
    const bytes = encodeBmp(synthetic(), W, H)
    for (const v of [0, 1, 85, 128, 170, 254, 255]) expect([...bytes.subarray(54 + v * 4, 58 + v * 4)]).toEqual([v, v, v, 0])
  })

  it('由下往上存列、每像素 1 byte（值就是灰階）', () => {
    const gray = synthetic()
    const bytes = encodeBmp(gray, W, H)
    expect(bmpRowBytes(W)).toBe(480)
    // 第一列（畫面最上面）存在檔案最後一列；左上角像素是 255（白），接著是漸層
    const lastRow = 1078 + (H - 1) * 480
    expect(bytes[lastRow]).toBe(255)
    expect(bytes[lastRow + 1]).toBe(0)
    expect(bytes[lastRow + 479]).toBe(255)
    expect(decodeBmpGray(bytes)).toEqual(gray)
  })

  it('寬度不是 4 的倍數時每列補 0 到 4 bytes', () => {
    const gray = Uint8Array.from([10, 20, 30, 40, 50, 60]) // 3×2
    const bytes = encodeBmp(gray, 3, 2)
    expect(bmpRowBytes(3)).toBe(4)
    expect(bytes.length).toBe(1078 + 8)
    expect([...bytes.subarray(1078)]).toEqual([40, 50, 60, 0, 10, 20, 30, 0])
    expect(readBmpHeader(bytes).imageSize).toBe(8)
    expect(decodeBmpGray(bytes)).toEqual(gray)
  })

  it('像素數不對就丟錯', () => {
    expect(() => encodeBmp(new Uint8Array(10), W, H)).toThrow()
  })

  it('大小保護：達到 1 MB 外掛下載上限就丟錯，不產生外掛下載不了的檔', () => {
    const w = 1400 // 1,078 + 1,400×800 = 1,121,078 bytes
    expect(() => encodeBmp(new Uint8Array(w * H), w, H)).toThrow(/under 1048576/)
  })
})

describe('buildSleepBmp：產生的休眠圖（假 canvas）', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('480×800、8-bit、385,078 bytes（< 1 MB），反鋸齒的中間灰原樣寫進 BMP', async () => {
    const W = SLEEP_WIDTH
    const H = SLEEP_HEIGHT
    // 假 canvas：每列一種灰（含不在 4 階上的中間灰），模擬反鋸齒後的像素
    const pixels = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pixels.set([y % 256, y % 256, y % 256, 255], (y * W + x) * 4)
    const ctx = {
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic',
      fillRect: () => {}, strokeRect: () => {}, fillText: () => {}, beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {},
      getImageData: () => ({ data: pixels }),
    }
    vi.stubGlobal('OffscreenCanvas', class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h } getContext() { return ctx } })
    const bmp = await buildSleepBmp(normalDay(), { updatedAt: UPDATED_AT, texts: SLEEP_TEXTS, briefingPages: 24 })
    expect(bmp.bytes.length).toBe(385_078)
    expect(bmp.bytes.length).toBeLessThan(1024 * 1024)
    expect(readBmpHeader(bmp.bytes)).toMatchObject({ width: 480, height: 800, bitDepth: 8, colors: 256 })
    const decoded = decodeBmpGray(bmp.bytes)
    expect(decoded).toEqual(bmp.gray)
    expect([decoded[37 * W], decoded[200 * W], decoded[300 * W]]).toEqual([37, 200, 44])
  })
})

describe('繪圖與轉灰階', () => {
  it('用排版指令畫到 2D context：文字帶 maxWidth、字型用系統字型堆疊', () => {
    const calls: string[] = []
    const ctx: Context2D = {
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic',
      fillRect: (x, y, w, h) => calls.push(`fillRect ${x},${y},${w},${h} ${ctx.fillStyle}`),
      strokeRect: () => calls.push('strokeRect'),
      fillText: (text, x, y, maxWidth) => calls.push(`fillText ${text} ${x},${y} max=${maxWidth} ${ctx.font} ${ctx.fillStyle}`),
      beginPath: () => {}, arc: () => calls.push('arc'), fill: () => {}, stroke: () => {},
    }
    drawSleepLayout(ctx, layout(normalDay()))
    expect(calls[0]).toBe('fillRect 0,0,480,800 #ffffff')
    const update = calls.find(call => call.startsWith('fillText 更新於'))
    expect(update).toContain('max=')
    expect(update).toContain('"PingFang TC"')
    expect(calls.filter(call => call === 'arc')).toHaveLength(dots(layout(normalDay())).length)
    expect(cssFont({ family: 'mono', size: 15, weight: 600 })).toBe('600 15px "SF Mono", Menlo, "IBM Plex Mono", Consolas, monospace')
  })

  it('轉灰階不量化：中間灰原樣保留（反鋸齒的字邊緣才平滑）；grayToRgba 是反過來', () => {
    const rgba = Uint8ClampedArray.from([0, 0, 0, 255, 60, 60, 60, 255, 100, 100, 100, 255, 180, 180, 180, 255, 230, 230, 230, 255, 255, 255, 255, 255])
    expect([...rgbaToGray(rgba)]).toEqual([0, 60, 100, 180, 230, 255])
    // 彩色用亮度：純紅、純綠、純藍
    expect([...rgbaToGray(Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]))]).toEqual([76, 149, 28])
    expect([...grayToRgba(Uint8Array.from([0, 37, 170, 255]))].filter((_, i) => i % 4 === 0)).toEqual([0, 37, 170, 255])
  })
})
